import warnings
warnings.filterwarnings("ignore")

import json
import os
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

import requests
from dotenv import load_dotenv

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.reasoning import AntigravityEngine

DEFAULT_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1"
DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/llama-v3p3-70b-instruct"


# ---------------------------------------------------------------------------
# Fireworks AI – LLM clinical reasoning summarization
# ---------------------------------------------------------------------------
def get_fireworks_chat_endpoint() -> str:
    """
    Fireworks docs use OpenAI-compatible base URL:
    https://api.fireworks.ai/inference/v1
    and chat path:
    /chat/completions
    """
    base_url = os.getenv("FIREWORKS_BASE_URL", DEFAULT_FIREWORKS_BASE_URL).strip()
    if not base_url:
        base_url = DEFAULT_FIREWORKS_BASE_URL
    base_url = base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def get_fireworks_model() -> str:
    model = os.getenv("FIREWORKS_MODEL", "").strip()
    return model or DEFAULT_FIREWORKS_MODEL


def is_fireworks_enabled() -> bool:
    raw = os.getenv("FIREWORKS_ENABLED", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def fireworks_clinical_summary(readiness: Dict, patient: Dict, policy_result: Dict) -> Optional[str]:
    """Call Fireworks Llama 3.3 70B to generate a clinical verdict."""
    api_key = os.getenv("FIREWORKS_API_KEY", "").strip()
    if not api_key:
        return None
    endpoint = get_fireworks_chat_endpoint()
    model = get_fireworks_model()
    try:
        messages = [
            {"role": "system", "content": "You are a prior-authorization clinical analyst. Write a concise 2-3 sentence verdict."},
            {"role": "user", "content": (
                f"Case {patient.get('id', 'N/A')}: {patient.get('requested_procedure', 'N/A')}\n"
                f"Diagnosis: {patient.get('diagnosis', 'N/A')}\n"
                f"Payer: {patient.get('payer_name', 'Unknown')}\n"
                f"Policy: {readiness.get('policy_name', 'N/A')}\n"
                f"Ready: {readiness.get('ready', False)}\n"
                f"Supporting: {readiness.get('supporting_evidence', [])}\n"
                f"Missing: {readiness.get('missing_evidence', [])}\n"
                f"Action: {readiness.get('recommended_action', 'N/A')}\n\n"
                f"Write a 2-3 sentence clinical verdict."
            )}
        ]
        resp = requests.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 200,
                "temperature": 0.3,
            },
            timeout=15,
        )
        try:
            data = resp.json()
        except ValueError:
            data = {"error": {"message": resp.text[:300] or "Non-JSON Fireworks response"}}
        if resp.status_code == 200:
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "").strip()
        else:
            # Return error detail so it shows in the logs
            err = data.get("error", {}).get("message", f"HTTP {resp.status_code}")
            return f"[Fireworks API error {resp.status_code}: {err}]"
    except Exception as exc:
        return f"[Fireworks connection error: {exc}]"
    return None


# ---------------------------------------------------------------------------
# AgentOps – lightweight session tracking
# ---------------------------------------------------------------------------
def agentops_start_session(case_id: str, workflow_name: str) -> Optional[str]:
    """Emit a session start event to AgentOps for audit tracking."""
    api_key = os.getenv("AGENTOPS_API_KEY", "").strip()
    if not api_key:
        return None
    session_id = str(uuid.uuid4())
    try:
        requests.post(
            "https://api.agentops.ai/v2/create_events",
            headers={"X-Agentops-Api-Key": api_key, "Content-Type": "application/json"},
            json={
                "events": [{
                    "event_type": "session",
                    "params": {
                        "session_id": session_id,
                        "tags": ["authpilot", "prior-auth", case_id],
                        "host_env": {"OS": "macOS", "runtime": "python"},
                    },
                    "init_timestamp": datetime.utcnow().isoformat() + "Z",
                }]
            },
            timeout=5,
        )
    except Exception:
        pass
    return session_id


def agentops_end_session(session_id: Optional[str], status: str = "Success"):
    """Emit a session end event to AgentOps."""
    api_key = os.getenv("AGENTOPS_API_KEY", "").strip()
    if not api_key or not session_id:
        return
    try:
        requests.post(
            "https://api.agentops.ai/v2/update_session",
            headers={"X-Agentops-Api-Key": api_key, "Content-Type": "application/json"},
            json={
                "session_id": session_id,
                "end_state": status,
                "end_timestamp": datetime.utcnow().isoformat() + "Z",
            },
            timeout=5,
        )
    except Exception:
        pass


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

DEFAULT_TINYFISH_MAX_ATTEMPTS = 2
DEFAULT_TINYFISH_RETRY_BACKOFF_SECONDS = 1.5


def split_chart_summary(summary: str) -> List[str]:
    raw = str(summary or "").strip()
    if not raw:
        return []

    chunks = re.split(r"(?:\r?\n)+|(?<=[.!?])\s+", raw)
    return [chunk.strip(" -") for chunk in chunks if chunk.strip(" -")]


def split_evidence_files(raw_value: str) -> List[str]:
    raw = str(raw_value or "").strip()
    if not raw:
        return []

    parts = re.split(r"[\n,;]+", raw)
    return [part.strip() for part in parts if part.strip()]


def build_patient_context(base_patient: Dict[str, Any]) -> Dict[str, Any]:
    diagnosis = os.getenv("TINYFISH_CASE_DIAGNOSIS", "").strip()
    procedure = os.getenv("TINYFISH_CASE_PROCEDURE", "").strip()
    chart_summary = os.getenv("TINYFISH_CASE_CHART_SUMMARY", "").strip()
    evidence_files_raw = os.getenv("TINYFISH_CASE_EVIDENCE_FILES", "").strip()
    case_label = os.getenv("TINYFISH_CASE_LABEL", "").strip()
    payer_name = os.getenv("TINYFISH_PAYER_NAME", "").strip()
    line_of_business = os.getenv("TINYFISH_LINE_OF_BUSINESS", "").strip()
    member_state = os.getenv("TINYFISH_MEMBER_STATE", "").strip().upper()
    specialty = os.getenv("TINYFISH_SPECIALTY", "").strip()

    if not any(
        [
            diagnosis,
            procedure,
            chart_summary,
            evidence_files_raw,
            case_label,
            payer_name,
            line_of_business,
            member_state,
            specialty,
        ]
    ):
        patient = dict(base_patient)
        patient["input_mode"] = "synthetic_demo"
        patient["payer_name"] = payer_name or base_patient.get("payer_name", "")
        patient["line_of_business"] = line_of_business or base_patient.get("line_of_business", "")
        patient["member_state"] = member_state or base_patient.get("member_state", "")
        patient["specialty"] = specialty or base_patient.get("specialty", "")
        return patient

    patient = dict(base_patient)
    patient["id"] = case_label or "CUSTOM-INPUT"
    patient["name"] = "Custom Intake"
    patient["diagnosis"] = diagnosis or base_patient.get("diagnosis", "")
    patient["requested_procedure"] = procedure or base_patient.get("requested_procedure", "")
    patient["clinical_notes"] = split_chart_summary(chart_summary) or list(base_patient.get("clinical_notes", []))
    patient["evidence_files"] = split_evidence_files(evidence_files_raw) or list(base_patient.get("evidence_files", []))
    patient["payer_name"] = payer_name
    patient["line_of_business"] = line_of_business
    patient["member_state"] = member_state
    patient["specialty"] = specialty
    patient["input_mode"] = "custom_intake"
    return patient


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


def parse_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, value)


def parse_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(0.2, value)


def validate_live_config(
    api_key: str, workflow: Dict[str, str], contact_workflow: Dict[str, str]
) -> List[str]:
    missing = []
    if not api_key:
        missing.append("TINYFISH_API_KEY")

    required_fields = {
        "TINYFISH_WORKFLOW_NAME": workflow.get("name", ""),
        "TINYFISH_WORKFLOW_URL": workflow.get("url", ""),
        "TINYFISH_WORKFLOW_GOAL": workflow.get("goal", ""),
        "TINYFISH_CONTACT_WORKFLOW_NAME": contact_workflow.get("name", ""),
        "TINYFISH_CONTACT_WORKFLOW_URL": contact_workflow.get("url", ""),
        "TINYFISH_CONTACT_WORKFLOW_GOAL": contact_workflow.get("goal", ""),
    }
    for key, value in required_fields.items():
        if not str(value or "").strip():
            missing.append(key)
    return missing


class TinyFishWorkflowError(RuntimeError):
    def __init__(
        self,
        message: str,
        run_id: str = "",
        tinyfish_status: str = "",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.run_id = run_id
        self.tinyfish_status = tinyfish_status
        self.retryable = retryable


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


def build_submission_checklist(
    chart: Dict[str, Any], readiness: Dict[str, Any], contact_result: Dict[str, Any]
) -> List[str]:
    evidence_files = list(dict.fromkeys(chart.get("evidence_files", []) or []))
    checklist: List[str] = []
    route_note = str(contact_result.get("provider_precert_notes", "") or "").strip()
    route_url = contact_result.get("source_page_url") or readiness.get("page_url") or "the saved payer route"

    if readiness["ready"]:
        context_bits = [chart.get("member_state", ""), chart.get("line_of_business", "")]
        context_label = " ".join([bit for bit in context_bits if bit]).strip()
        if context_label:
            checklist.append(
                f"Confirm member eligibility and the {context_label} routing path before entering the payer workflow."
            )
        else:
            checklist.append("Confirm member eligibility and line-of-business routing before entering the payer workflow.")
        checklist.append(f"Open the payer submission route from {route_url}.")
        checklist.append(
            f"Enter diagnosis and procedure exactly as documented: {chart.get('diagnosis', 'Diagnosis not provided')} / {chart.get('requested_procedure', 'Procedure not provided')}."
        )
        if evidence_files:
            checklist.append(f"Attach available supporting files: {', '.join(evidence_files)}.")
        checklist.append("Map the clinical note to the matched payer evidence requirements before final submission.")
        checklist.append("Keep the provider precertification contact route available in case the portal flow stalls or reroutes.")
        if route_note:
            checklist.append(f"Follow the payer routing note exactly: {route_note}")
    else:
        if readiness["missing_evidence"]:
            checklist.append(
                f"Collect or document the missing payer evidence first: {', '.join(readiness['missing_evidence'][:3])}."
            )
        if evidence_files:
            checklist.append(f"Verify the current attachment set before resubmission: {', '.join(evidence_files)}.")
        checklist.append("Update the chart summary so it explicitly addresses the payer's required evidence language.")
        checklist.append("Re-run readiness after the missing evidence is added before opening the payer portal.")
        checklist.append("Stage the provider precertification route so staff can move immediately once the chart is ready.")
        if route_note:
            checklist.append(f"Keep this payer route note staged for the next attempt: {route_note}")

    return checklist


def format_blocker_title(requirement: str) -> str:
    text = normalize_text(requirement)
    if not text:
        return "Missing payer evidence"

    if "therapy" in text or "conservative" in text:
        return "Conservative care evidence missing"
    if "radicul" in text or "neurolog" in text or "myelopathy" in text:
        return "Neurological support missing"
    if "image" in text or "x-ray" in text or "mri" in text or "ct" in text:
        return "Supporting imaging documentation missing"
    if "week" in text or "duration" in text:
        return "Duration requirement missing"

    return "Payer requirement not yet documented"


def build_submission_blockers(
    chart: Dict[str, Any], readiness: Dict[str, Any], evidence_files: List[str]
) -> List[Dict[str, str]]:
    blockers: List[Dict[str, str]] = []
    available_files_text = ", ".join(evidence_files) if evidence_files else "No staged evidence files yet"

    for requirement in readiness.get("missing_evidence", [])[:6]:
        blockers.append(
            {
                "title": format_blocker_title(requirement),
                "severity": "blocking",
                "detail": requirement,
                "resolution": (
                    f"Update the chart note or staged evidence so it explicitly addresses: {requirement}. "
                    f"Current staged files: {available_files_text}."
                ),
            }
        )

    if not blockers and not readiness.get("ready"):
        blockers.append(
            {
                "title": "Manual review required",
                "severity": "review",
                "detail": "The case is not ready, but no explicit structured blocker was extracted.",
                "resolution": "Review the clinical note against the payer policy language and add a clearer evidence statement before re-running.",
            }
        )

    return blockers


def build_submission_tasks(
    chart: Dict[str, Any],
    readiness: Dict[str, Any],
    contact_result: Dict[str, Any],
    policy_result: Dict[str, Any],
    evidence_files: List[str],
) -> Dict[str, List[str]]:
    delegated_vendor = detect_delegated_vendor(contact_result, policy_result)
    route_url = contact_result.get("source_page_url") or policy_result.get("page_url", "")
    route_phone = contact_result.get("provider_precert_phone", "")
    route_note = str(contact_result.get("provider_precert_notes", "") or "").strip()
    diagnosis = chart.get("diagnosis", "Diagnosis not provided")
    procedure = chart.get("requested_procedure", "Procedure not provided")

    pre_submission_review = [
        f"Confirm patient eligibility for {chart.get('payer_name') or 'the selected payer'} {chart.get('line_of_business') or ''}".strip(),
        f"Verify the case label, diagnosis, and planned procedure: {chart.get('id', 'N/A')} / {diagnosis} / {procedure}.",
        f"Review the matched payer support language before submission: {readiness['supporting_evidence'][0] if readiness.get('supporting_evidence') else 'No matched evidence surfaced.'}",
    ]

    evidence_collection = []
    if readiness.get("missing_evidence"):
        evidence_collection.extend(
            [
                f"Collect or document: {missing}."
                for missing in readiness["missing_evidence"][:4]
            ]
        )
    if evidence_files:
        evidence_collection.append(f"Stage these supporting files for upload: {', '.join(evidence_files)}.")
    else:
        evidence_collection.append("Stage at least one supporting document before portal entry.")

    portal_entry = [
        f"Open the provider route: {route_url or 'Provider route not found'}",
        f"Use the discovered provider phone fallback if the portal path fails: {route_phone or 'Phone fallback not found'}",
        f"Use the payer rationale derived from the chart and policy: {readiness['summary']}",
    ]
    if delegated_vendor:
        portal_entry.append(f"Expect delegated handling through {delegated_vendor}.")
    if route_note:
        portal_entry.append(f"Follow this payer-specific route note: {route_note}")

    escalation_fallback = [
        "If the portal rejects the case, capture the exact rejection text and re-run the case with the updated note.",
        "If required evidence cannot be documented from the existing chart, escalate back to the ordering clinician for clarification.",
    ]
    if route_phone:
        escalation_fallback.append(f"Call {route_phone} if portal routing differs from the public provider instructions.")

    return {
        "pre_submission_review": pre_submission_review,
        "evidence_collection": evidence_collection,
        "portal_entry": portal_entry,
        "escalation_fallback": escalation_fallback,
    }


def build_submission_prep_package(
    chart: Dict[str, Any],
    readiness: Dict[str, Any],
    contact_result: Dict[str, Any],
    policy_result: Dict[str, Any],
    submission_checklist: List[str],
    portal_handoff: Dict[str, Any],
) -> Dict[str, Any]:
    evidence_files = list(dict.fromkeys(chart.get("evidence_files", []) or []))
    blockers = build_submission_blockers(chart, readiness, evidence_files)
    tasks = build_submission_tasks(chart, readiness, contact_result, policy_result, evidence_files)
    route_review_required = bool(
        readiness.get("missing_evidence") or not portal_handoff.get("portal_entry_url") or not contact_result.get("provider_precert_phone")
    )

    return {
        "status": "ready_for_submission_prep" if readiness.get("ready") else "blocked_pending_evidence",
        "readiness_gate": "ready" if readiness.get("ready") else "blocked",
        "owner": "clinic authorization staff",
        "route_review_required": route_review_required,
        "review_summary": {
            "matched_evidence_count": len(readiness.get("supporting_evidence", [])),
            "missing_evidence_count": len(readiness.get("missing_evidence", [])),
            "available_file_count": len(evidence_files),
            "next_review_trigger": (
                "Proceed to portal entry after eligibility and route confirmation."
                if readiness.get("ready")
                else "Re-run immediately after the missing evidence is added to the chart or staging set."
            ),
        },
        "blockers": blockers,
        "tasks": tasks,
        "ready_now": [
            f"Matched evidence: {item}" for item in readiness.get("supporting_evidence", [])[:4]
        ]
        + ([f"Staged file: {item}" for item in evidence_files[:4]] if evidence_files else []),
        "needs_follow_up": [
            f"Missing evidence: {item}" for item in readiness.get("missing_evidence", [])[:4]
        ],
        "staff_script": [
            f"This case is currently {'ready' if readiness.get('ready') else 'not ready'} for payer submission prep.",
            f"Use the route {portal_handoff.get('portal_entry_url') or 'identified in the contact lookup'} and keep the phone fallback {portal_handoff.get('phone_fallback') or 'unavailable'} nearby.",
            (
                "Before portal entry, confirm that the chart language mirrors the matched payer requirements."
                if readiness.get("ready")
                else "Do not open the portal until the missing evidence is documented and the case is re-run."
            ),
        ],
        "submission_checklist_count": len(submission_checklist),
    }


def detect_delegated_vendor(contact_result: Dict[str, Any], policy_result: Dict[str, Any]) -> str:
    haystack = " ".join(
        [
            str(contact_result.get("provider_precert_notes", "") or ""),
            str(contact_result.get("source_page_url", "") or ""),
            str(policy_result.get("page_url", "") or ""),
        ]
    ).lower()

    if "radmd" in haystack or "evolent" in haystack:
        return "Evolent / RadMD"
    if "turningpoint" in haystack:
        return "TurningPoint Healthcare"
    if "cohere" in haystack:
        return "Cohere Health"
    if "carelon" in haystack:
        return "Carelon"
    if "evicore" in haystack:
        return "eviCore"
    return ""


def build_portal_handoff(
    chart: Dict[str, Any],
    readiness: Dict[str, Any],
    contact_result: Dict[str, Any],
    policy_result: Dict[str, Any],
) -> Dict[str, Any]:
    evidence_files = list(dict.fromkeys(chart.get("evidence_files", []) or []))
    line_of_business = str(chart.get("line_of_business", "") or "").strip()
    member_state = str(chart.get("member_state", "") or "").strip()
    delegated_vendor = detect_delegated_vendor(contact_result, policy_result)
    preferred_channel = (
        "Portal or digital precertification route"
        if readiness["ready"]
        else "Evidence collection first, then portal submission"
    )
    route_context = {
        "payer": chart.get("payer_name", ""),
        "line_of_business": line_of_business,
        "member_state": member_state,
        "specialty": chart.get("specialty", ""),
        "delegated_vendor": delegated_vendor,
    }
    route_rationale = (
        contact_result.get("provider_precert_notes")
        or f"Use the provider-facing route discovered from {contact_result.get('source_page_url') or policy_result.get('page_url', 'the payer source page')}."
    )

    return {
        "next_step_title": "Portal-ready submission package" if readiness["ready"] else "Submission prep package",
        "preferred_channel": preferred_channel,
        "portal_entry_url": contact_result.get("source_page_url") or policy_result.get("page_url", ""),
        "phone_fallback": contact_result.get("provider_precert_phone", ""),
        "route_context": route_context,
        "route_rationale": route_rationale,
        "delegated_vendor_hint": delegated_vendor,
        "source_summary": {
            "policy_source_url": policy_result.get("page_url", ""),
            "contact_source_url": contact_result.get("source_page_url", ""),
        },
        "required_fields": [
            f"Case ID: {chart.get('id', 'N/A')}",
            f"Payer: {chart.get('payer_name', 'N/A') or 'N/A'}",
            f"Line of business: {chart.get('line_of_business', 'N/A') or 'N/A'}",
            f"Member state: {chart.get('member_state', 'N/A') or 'N/A'}",
            f"Diagnosis: {chart.get('diagnosis', 'N/A') or 'N/A'}",
            f"Procedure: {chart.get('requested_procedure', 'N/A') or 'N/A'}",
        ],
        "attachments_ready": evidence_files,
        "attachments_missing": readiness["missing_evidence"],
        "operator_note": (
            "Use the matched evidence summary when filling the payer rationale or clinical-justification field."
            if readiness["ready"]
            else "Do not start portal work until the missing evidence is documented and the case is re-run."
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
    saw_complete_event = False
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
            saw_complete_event = True
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
            raise TinyFishWorkflowError(
                error_text,
                run_id=str(evt.get("run_id", "") or ""),
                tinyfish_status=status,
                retryable=status in {"ERROR", "FAILED", "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE"},
            )
        else:
            log("execution", "info", f"TinyFish event: {evt_type}")

    if not saw_complete_event:
        raise TinyFishWorkflowError(
            "TinyFish stream ended before a terminal COMPLETE event.",
            retryable=True,
        )

    return result or {}


def should_retry_tinyfish(exc: Exception) -> bool:
    if isinstance(exc, TinyFishWorkflowError):
        return exc.retryable
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return True
    if isinstance(exc, requests.HTTPError):
        status_code = getattr(exc.response, "status_code", 0)
        return status_code in {408, 409, 425, 429} or status_code >= 500

    message = normalize_text(exc)
    retryable_tokens = [
        "timed out",
        "timeout",
        "connection reset",
        "temporarily unavailable",
        "rate limit",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
    ]
    return any(token in message for token in retryable_tokens)


def run_tinyfish_workflow_with_retries(
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
    max_attempts = parse_int_env("TINYFISH_MAX_ATTEMPTS", DEFAULT_TINYFISH_MAX_ATTEMPTS)
    backoff_seconds = parse_float_env("TINYFISH_RETRY_BACKOFF_SECONDS", DEFAULT_TINYFISH_RETRY_BACKOFF_SECONDS)
    last_error: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            if attempt > 1:
                log(
                    "execution",
                    "retry",
                    f"Retrying {workflow_kind} workflow attempt {attempt} of {max_attempts}.",
                )
            return run_tinyfish_workflow(
                workflow=workflow,
                api_key=api_key,
                base_url=base_url,
                log=log,
                proof=proof,
                workflow_kind=workflow_kind,
                start_message=start_message,
                session_message=session_message,
                success_message=success_message,
            )
        except Exception as exc:  # noqa: PERF203 - clarity matters here
            last_error = exc
            retryable = attempt < max_attempts and should_retry_tinyfish(exc)
            if retryable:
                log(
                    "execution",
                    "retry",
                    f"{workflow_kind.title()} workflow attempt {attempt} failed: {exc}. Retrying in {backoff_seconds:.1f}s.",
                )
                time.sleep(backoff_seconds)
                backoff_seconds *= 2
                continue

            if should_retry_tinyfish(exc) and attempt >= max_attempts:
                raise TinyFishWorkflowError(
                    (
                        f"{workflow_kind.title()} workflow failed after {max_attempts} attempts: {exc}. "
                        "Retry budget exhausted."
                    ),
                    run_id=getattr(exc, "run_id", ""),
                    tinyfish_status=getattr(exc, "tinyfish_status", ""),
                    retryable=False,
                )

            proof(
                workflow_kind,
                "failed",
                {
                    "runId": getattr(exc, "run_id", ""),
                    "error": str(exc),
                    "tinyfishStatus": getattr(exc, "tinyfish_status", ""),
                },
            )
            raise

    raise last_error or RuntimeError(f"{workflow_kind} workflow failed without a recoverable error.")


def run():
    load_dotenv()

    api_key = os.getenv("TINYFISH_API_KEY", "")
    base_url = os.getenv("TINYFISH_API_BASE_URL", "https://agent.tinyfish.ai")
    mode = os.getenv("TINYFISH_MODE", "mock").strip().lower()
    workflow = get_workflow_config()
    contact_workflow = get_contact_workflow_config()

    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data/synthetic_patients.json")
    with open(data_path, "r", encoding="utf-8") as f:
        patients = json.load(f)

    patient = build_patient_context(patients[0])
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

    def proof(workflow_kind: str, status: str, extra: Optional[Dict[str, Any]] = None):
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
            "diagnosis": patient.get("diagnosis", ""),
            "payerName": patient.get("payer_name", ""),
            "lineOfBusiness": patient.get("line_of_business", ""),
            "memberState": patient.get("member_state", ""),
            "specialty": patient.get("specialty", ""),
            "inputMode": patient.get("input_mode", "synthetic_demo"),
        }
    )

    # --- AgentOps session tracking ---
    agentops_session = agentops_start_session(patient["id"], workflow["name"])
    if agentops_session:
        log("execution", "info", f"AgentOps session started: {agentops_session[:8]}...", confidence=probability)
    else:
        log("execution", "info", "AgentOps: no API key, skipping session tracking.", confidence=probability)

    log("execution", "info", "Initializing autonomous agent...", confidence=probability)
    time.sleep(0.35)
    log("execution", "info", "Connecting to TinyFish browser infrastructure...", confidence=probability)
    time.sleep(0.35)
    log("thinking", "info", "Loading reasoning engine...", confidence=probability)
    time.sleep(0.35)
    case_descriptor = "custom intake case" if patient.get("input_mode") == "custom_intake" else "synthetic case"
    log("thinking", "info", f"Loaded {case_descriptor} {patient['id']} for {patient['requested_procedure']}.", confidence=probability)
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
        missing_config = validate_live_config(api_key, workflow, contact_workflow)
        if missing_config:
            proof("policy", "failed", {"error": f"Missing live configuration: {', '.join(missing_config)}"})
            log(
                "execution",
                "error",
                f"Missing live configuration: {', '.join(missing_config)}. Update .env or the custom workflow inputs.",
            )
            emit({"type": "complete"})
            return

        try:
            policy_result = run_tinyfish_workflow_with_retries(
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
            contact_result = run_tinyfish_workflow_with_retries(
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

    submission_checklist = build_submission_checklist(patient, readiness, contact_result)
    portal_handoff = build_portal_handoff(patient, readiness, contact_result, policy_result)
    submission_prep = build_submission_prep_package(
        patient,
        readiness,
        contact_result,
        policy_result,
        submission_checklist,
        portal_handoff,
    )
    log(
        "execution",
        "info",
        (
            f"Prepared downstream action package with {len(submission_checklist)} checklist steps "
            f"and {len(submission_prep['blockers'])} active blocker(s)."
        ),
        confidence=readiness["confidence"],
    )

    operator_packet = {
        "case_id": patient["id"],
        "payer_name": patient.get("payer_name", ""),
        "line_of_business": patient.get("line_of_business", ""),
        "member_state": patient.get("member_state", ""),
        "specialty": patient.get("specialty", ""),
        "diagnosis": patient.get("diagnosis", ""),
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
        "available_evidence_files": patient.get("evidence_files", []),
        "submission_checklist": submission_checklist,
        "portal_handoff": portal_handoff,
        "submission_prep": submission_prep,
    }

    # --- Fireworks AI clinical verdict ---
    fireworks_key = os.getenv("FIREWORKS_API_KEY", "").strip()
    if is_fireworks_enabled() and fireworks_key:
        fireworks_model = get_fireworks_model()
        model_label = fireworks_model.split("/")[-1]
        log(
            "thinking",
            "info",
            f"Calling Fireworks AI ({model_label}) for clinical verdict...",
            confidence=readiness["confidence"],
        )
        time.sleep(0.2)
        verdict_text = fireworks_clinical_summary(readiness, patient, policy_result)
        if verdict_text:
            log("thinking", "success", f"AI Verdict: {verdict_text}", confidence=readiness["confidence"])
            operator_packet["ai_clinical_verdict"] = verdict_text
            operator_packet["model_used"] = fireworks_model
        else:
            log("thinking", "retry", "Fireworks AI returned no verdict (rate limit or timeout).", confidence=readiness["confidence"])
    elif not is_fireworks_enabled():
        log("thinking", "info", "Fireworks AI is disabled (FIREWORKS_ENABLED=false). Skipping LLM verdict.", confidence=readiness["confidence"])
    else:
        log("thinking", "info", "Fireworks AI: no API key, skipping LLM verdict.", confidence=readiness["confidence"])

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

    # --- AgentOps session end ---
    run_status = "Success" if readiness.get("ready") else "Fail"
    agentops_end_session(agentops_session, run_status)
    if agentops_session:
        log("execution", "info", f"AgentOps session ended: {run_status}")

    emit({"type": "complete"})


if __name__ == "__main__":
    try:
        run()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
