import json
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, Iterable, List

import requests
from dotenv import load_dotenv

from core.reasoning import AntigravityEngine


DEFAULT_WORKFLOW_NAME = "Aetna lumbar MRI policy readiness check"
DEFAULT_WORKFLOW_URL = "https://www.aetna.com/cpb/medical/data/200_299/0236.html"
DEFAULT_WORKFLOW_GOAL = (
    "Read this medical policy page and return compact JSON with keys: "
    "policy_name, mentions_conservative_management, evidence_requirements, page_url."
)

DEFAULT_CONTACT_WORKFLOW_NAME = "Aetna precertification contact lookup"
DEFAULT_CONTACT_WORKFLOW_URL = "https://www.aetna.com/about-us/contact-aetna.html"
DEFAULT_CONTACT_WORKFLOW_GOAL = (
    "For providers seeking prior authorization help, return compact JSON with keys: "
    "provider_precert_phone, provider_precert_notes, source_page_url."
)


def now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def emit(payload: dict) -> None:
    print(json.dumps(payload), flush=True)


def tinyfish_sse_call(url: str, goal: str, api_key: str, base_url: str) -> Iterable[Dict[str, Any]]:
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    body = {"url": url, "goal": goal}

    with requests.post(
        f"{base_url}/v1/automation/run-sse",
        json=body,
        headers=headers,
        stream=True,
        timeout=120,
    ) as response:
        response.raise_for_status()
        for raw in response.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            data = raw[len("data:") :].strip()
            try:
                yield json.loads(data)
            except json.JSONDecodeError:
                continue


def compact_json(data: Dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=True, separators=(",", ":"))


def normalize_text(value: Any) -> str:
    return str(value or "").lower()


def flatten_requirements(value: Any) -> List[str]:
    if isinstance(value, str):
        parts = re.split(r"[\n;\u2022]+", value)
        return [part.strip(" -") for part in parts if part.strip(" -")]

    if isinstance(value, list):
        flattened: List[str] = []
        for item in value:
            flattened.extend(flatten_requirements(item))
        return flattened

    if isinstance(value, dict):
        flattened = []
        for key, item in value.items():
            if isinstance(item, (list, dict)):
                flattened.extend(flatten_requirements(item))
            elif item:
                flattened.append(f"{key}: {item}")
        return flattened

    return []


def get_workflow_config() -> Dict[str, str]:
    return {
        "name": os.getenv("TINYFISH_WORKFLOW_NAME", DEFAULT_WORKFLOW_NAME),
        "url": os.getenv("TINYFISH_WORKFLOW_URL", DEFAULT_WORKFLOW_URL),
        "goal": os.getenv("TINYFISH_WORKFLOW_GOAL", DEFAULT_WORKFLOW_GOAL),
    }


def get_contact_workflow_config() -> Dict[str, str]:
    return {
        "name": os.getenv("TINYFISH_CONTACT_WORKFLOW_NAME", DEFAULT_CONTACT_WORKFLOW_NAME),
        "url": os.getenv("TINYFISH_CONTACT_WORKFLOW_URL", DEFAULT_CONTACT_WORKFLOW_URL),
        "goal": os.getenv("TINYFISH_CONTACT_WORKFLOW_GOAL", DEFAULT_CONTACT_WORKFLOW_GOAL),
    }


def evaluate_submission_readiness(
    chart: Dict[str, Any], policy_result: Dict[str, Any], reasoner: AntigravityEngine
) -> Dict[str, Any]:
    supporting_evidence: List[str] = []
    missing_evidence: List[str] = []

    requirements = flatten_requirements(policy_result.get("evidence_requirements"))
    if policy_result.get("mentions_conservative_management") and not any(
        "conservative" in normalize_text(requirement) for requirement in requirements
    ):
        requirements.append("Conservative therapy history is required.")

    if not requirements:
        requirements = flatten_requirements(policy_result)

    unique_requirements: List[str] = []
    seen = set()
    for requirement in requirements:
        normalized = normalize_text(requirement)
        if normalized and normalized not in seen:
            unique_requirements.append(requirement)
            seen.add(normalized)

    matched_count = 0
    scored_matches: List[float] = []
    for requirement in unique_requirements[:6]:
        match = reasoner.match_requirement_text(requirement, chart)
        if match["matched"]:
            matched_count += 1
            scored_matches.append(match["score"])
            supporting_evidence.append(match["explanation"])
        else:
            missing_evidence.append(requirement)

    if not unique_requirements:
        signals = reasoner.summarize_chart_signals(chart)
        supporting_evidence.append(
            "TinyFish returned limited structured requirements, so readiness was inferred from chart completeness."
        )
        confidence = min(84, 52 + signals["signal_count"] * 6 + signals["evidence_count"] * 4)
        ready = signals["signal_count"] >= 3
    else:
        match_ratio = matched_count / len(unique_requirements)
        avg_match_score = sum(scored_matches) / len(scored_matches) if scored_matches else 0
        confidence = int(45 + (match_ratio * 35) + (avg_match_score * 15))
        confidence = max(28, min(94, confidence))
        ready = match_ratio >= 0.6 and len(missing_evidence) <= 1

    if not supporting_evidence:
        supporting_evidence.append("No strong requirement match was detected from the policy extraction.")

    supporting_evidence = list(dict.fromkeys(supporting_evidence))
    missing_evidence = list(dict.fromkeys(missing_evidence))

    return {
        "ready": ready,
        "confidence": confidence,
        "policy_name": policy_result.get("policy_name", "Unknown policy"),
        "page_url": policy_result.get("page_url", ""),
        "supporting_evidence": supporting_evidence,
        "missing_evidence": missing_evidence,
        "recommended_action": "submit_to_portal" if ready else "collect_missing_evidence",
        "summary": (
            "Chart appears submission-ready for this policy based on the extracted payer requirements."
            if ready
            else "Chart is not submission-ready yet against the extracted payer requirements. Missing evidence should be collected before portal work."
        ),
    }


def build_mock_policy_result(workflow: Dict[str, str]) -> Dict[str, Any]:
    return {
        "policy_name": "Magnetic Resonance Imaging (MRI) and Computed Tomography (CT) of the Spine",
        "mentions_conservative_management": True,
        "evidence_requirements": (
            "Persistent pain with radiculopathy unresponsive to 6 weeks of conservative therapy."
        ),
        "page_url": workflow["url"],
    }


def build_mock_contact_result(workflow: Dict[str, str]) -> Dict[str, Any]:
    return {
        "provider_precert_phone": "1-888-632-3862 (Non-Medicare); 1-800-624-0756 (Medicare)",
        "provider_precert_notes": "Choose precertification from the provider menu.",
        "source_page_url": workflow["url"],
    }


def run_tinyfish_workflow(
    workflow: Dict[str, str],
    api_key: str,
    base_url: str,
    log,
    proof,
    workflow_kind: str,
    start_message: str,
    session_message: str,
    success_message: str,
) -> Dict[str, Any]:
    result = None
    for evt in tinyfish_sse_call(
        url=workflow["url"],
        goal=workflow["goal"],
        api_key=api_key,
        base_url=base_url,
    ):
        evt_type = evt.get("type", "")
        if evt_type == "STARTED":
            proof(
                workflow_kind,
                "started",
                {
                    "runId": evt.get("run_id", "unknown run"),
                    "workflowName": workflow["name"],
                    "sourceUrl": workflow["url"],
                },
            )
            log("execution", "info", f"{start_message}: {evt.get('run_id', 'unknown run')}")
        elif evt_type == "STREAMING_URL":
            proof(
                workflow_kind,
                "session_connected",
                {
                    "streamUrl": evt.get("streaming_url") or evt.get("url") or "",
                },
            )
            log("execution", "info", session_message)
        elif evt_type == "PROGRESS":
            log("execution", "info", evt.get("purpose", "TinyFish progress event"))
        elif evt_type == "HEARTBEAT":
            continue
        elif evt_type == "COMPLETE":
            status = str(evt.get("status", "COMPLETED")).upper()
            result = evt.get("result", {}) or {}
            if status in {"COMPLETED", "COMPLETE", "SUCCEEDED", "SUCCESS"} and result:
                proof(
                    workflow_kind,
                    "completed",
                    {
                        "resultKeys": list(result.keys())[:6],
                    },
                )
                log("execution", "success", success_message)
                break

            error_text = evt.get("error") or f"TinyFish run ended with status {status}."
            proof(
                workflow_kind,
                "failed",
                {
                    "runId": evt.get("run_id", ""),
                    "error": error_text,
                    "tinyfishStatus": status,
                },
            )
            raise RuntimeError(error_text)
        else:
            log("execution", "info", f"TinyFish event: {evt_type}")
    return result or {}


def run():
    load_dotenv()

    api_key = os.getenv("TINYFISH_API_KEY", "")
    base_url = os.getenv("TINYFISH_API_BASE_URL", "https://agent.tinyfish.ai")
    mode = os.getenv("TINYFISH_MODE", "mock").strip().lower()
    workflow = get_workflow_config()
    contact_workflow = get_contact_workflow_config()

    with open("data/synthetic_patients.json", "r", encoding="utf-8") as f:
        patients = json.load(f)

    patient = patients[0]
    reasoner = AntigravityEngine()
    probability, reason = reasoner.calculate_approval_probability(patient)
    economic = reasoner.economic_decision(probability)

    total_steps = 20
    step = 0

    def log(channel: str, level: str, text: str, confidence=None):
        nonlocal step
        step += 1
        payload = {
            "type": "log",
            "id": f"{step}-{int(time.time() * 1000)}",
            "index": step,
            "totalSteps": total_steps,
            "time": now(),
            "channel": channel,
            "level": level,
            "text": text,
        }
        if confidence is not None:
            payload["confidence"] = confidence
        emit(payload)

    def proof(workflow_kind: str, status: str, extra: Dict[str, Any] | None = None):
        payload = {
            "type": "proof",
            "workflowKind": workflow_kind,
            "status": status,
        }
        if extra:
            payload.update(extra)
        emit(payload)

    emit(
        {
            "type": "config",
            "workflowName": workflow["name"],
            "workflowUrl": workflow["url"],
            "workflowGoal": workflow["goal"],
            "contactWorkflowName": contact_workflow["name"],
            "contactWorkflowUrl": contact_workflow["url"],
            "mode": mode,
            "caseId": patient["id"],
            "patientName": patient["name"],
            "procedure": patient["requested_procedure"],
        }
    )

    log("execution", "info", "Initializing autonomous agent...", confidence=probability)
    time.sleep(0.35)
    log("execution", "info", "Connecting to TinyFish browser infrastructure...", confidence=probability)
    time.sleep(0.35)
    log("thinking", "info", "Loading reasoning engine...", confidence=probability)
    time.sleep(0.35)
    log("thinking", "info", f"Loaded synthetic case {patient['id']} for {patient['requested_procedure']}.", confidence=probability)
    time.sleep(0.4)
    log("thinking", "info", f"Initial chart assessment: {reason}", confidence=probability)
    time.sleep(0.4)
    log(
        "thinking",
        "info",
        (
            f"Expected-value decision: {economic['action'].upper()} "
            f"(recovery ${economic['expected_recovery_usd']} vs labor ${economic['labor_cost_usd']})."
        ),
        confidence=probability,
    )
    time.sleep(0.4)
    log("execution", "info", f"Using TinyFish workflow: {workflow['name']}")
    time.sleep(0.4)
    log("execution", "info", f"Using TinyFish follow-up workflow: {contact_workflow['name']}")

    if mode != "live":
        proof("policy", "mock", {"workflowName": workflow["name"], "sourceUrl": workflow["url"]})
        proof("contact", "mock", {"workflowName": contact_workflow["name"], "sourceUrl": contact_workflow["url"]})
        log("execution", "retry", "Running in mock mode. Returning deterministic workflow outputs.")
        policy_result = build_mock_policy_result(workflow)
        contact_result = build_mock_contact_result(contact_workflow)
    else:
        if not api_key:
            proof("policy", "failed", {"error": "Missing TinyFish API key"})
            log("execution", "error", "TinyFish API key missing. Set TINYFISH_API_KEY in .env.")
            emit({"type": "complete"})
            return

        try:
            policy_result = run_tinyfish_workflow(
                workflow=workflow,
                api_key=api_key,
                base_url=base_url,
                log=log,
                proof=proof,
                workflow_kind="policy",
                start_message="TinyFish policy run started",
                session_message="Live browser session established for policy extraction.",
                success_message="TinyFish completed live policy extraction.",
            )
        except Exception as exc:
            proof("policy", "failed", {"error": str(exc)})
            log("execution", "error", f"TinyFish policy run failed: {exc}")
            emit({"type": "complete"})
            return

        if not policy_result:
            proof("policy", "failed", {"error": "TinyFish returned no policy result payload."})
            log("execution", "error", "TinyFish returned no policy result payload.")
            emit({"type": "complete"})
            return

        try:
            contact_result = run_tinyfish_workflow(
                workflow=contact_workflow,
                api_key=api_key,
                base_url=base_url,
                log=log,
                proof=proof,
                workflow_kind="contact",
                start_message="TinyFish contact run started",
                session_message="Live browser session established for provider contact lookup.",
                success_message="TinyFish completed live contact lookup.",
            )
        except Exception as exc:
            proof("contact", "failed", {"error": str(exc)})
            log("execution", "error", f"TinyFish contact lookup failed: {exc}")
            emit({"type": "complete"})
            return

        if not contact_result:
            proof("contact", "failed", {"error": "TinyFish returned no contact result payload."})
            log("execution", "error", "TinyFish returned no contact result payload.")
            emit({"type": "complete"})
            return

    emit(
        {
            "type": "artifact",
            "policyResult": policy_result,
            "contactResult": contact_result,
            "rawResult": compact_json({"policy": policy_result, "contact": contact_result}),
        }
    )

    readiness = evaluate_submission_readiness(patient, policy_result, reasoner)
    level = "success" if readiness["ready"] else "retry"
    log("thinking", level, readiness["summary"], confidence=readiness["confidence"])

    if readiness["supporting_evidence"]:
        log("thinking", "info", f"Matched evidence: {readiness['supporting_evidence'][0]}", confidence=readiness["confidence"])

    if readiness["missing_evidence"]:
        log("thinking", "retry", f"Missing evidence: {readiness['missing_evidence'][0]}", confidence=readiness["confidence"])

    log(
        "execution",
        level,
        f"Recommended next step: {readiness['recommended_action']}",
        confidence=readiness["confidence"],
    )

    operator_packet = {
        "case_id": patient["id"],
        "procedure": patient["requested_procedure"],
        "policy_name": readiness["policy_name"],
        "submission_ready": readiness["ready"],
        "recommended_action": readiness["recommended_action"],
        "supporting_evidence": readiness["supporting_evidence"],
        "missing_evidence": readiness["missing_evidence"],
        "provider_precert_phone": contact_result.get("provider_precert_phone", ""),
        "provider_precert_notes": contact_result.get("provider_precert_notes", ""),
        "policy_url": readiness["page_url"],
        "contact_url": contact_result.get("source_page_url", ""),
    }

    emit(
        {
            "type": "packet",
            "operatorPacket": operator_packet,
        }
    )

    emit(
        {
            "type": "result",
            "readiness": readiness,
            "contactResult": contact_result,
        }
    )
    emit({"type": "complete"})


if __name__ == "__main__":
    try:
        run()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
