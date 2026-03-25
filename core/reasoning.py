import re
from typing import Any, Dict, List, Set, Tuple

class AntigravityEngine:
    def __init__(self):
        self.stopwords: Set[str] = {
            "a",
            "an",
            "and",
            "are",
            "as",
            "at",
            "be",
            "by",
            "for",
            "from",
            "has",
            "have",
            "if",
            "in",
            "is",
            "it",
            "of",
            "on",
            "or",
            "that",
            "the",
            "this",
            "to",
            "with",
        }

    def _normalize_text(self, value: Any) -> str:
        return str(value or "").lower()

    def _chart_text(self, chart: Dict[Any, Any]) -> str:
        return " ".join(
            [
                self._normalize_text(chart.get("diagnosis")),
                self._normalize_text(chart.get("requested_procedure")),
                " ".join(self._normalize_text(note) for note in chart.get("clinical_notes", [])),
                " ".join(self._normalize_text(file_name) for file_name in chart.get("evidence_files", [])),
            ]
        )

    def _tokenize_keywords(self, text: str) -> List[str]:
        tokens = re.findall(r"[a-z0-9][a-z0-9\-]+", self._normalize_text(text))
        keywords: List[str] = []
        for token in tokens:
            if token in self.stopwords or len(token) <= 2:
                continue
            keywords.append(token)
        return keywords

    def summarize_chart_signals(self, chart: Dict[Any, Any]) -> Dict[str, Any]:
        chart_text = self._chart_text(chart)
        signal_map = {
            "therapy": ["physical therapy", "conservative therapy", "home exercise", "chiropractic"],
            "imaging": ["x-ray", "mri", "ct", "ultrasound", "radiograph"],
            "symptoms": ["pain", "radiating", "radicul", "weakness", "numbness", "instability"],
            "medications": ["ibuprofen", "naproxen", "acetaminophen", "medication", "nsaid", "steroid"],
            "rationale": ["failed", "minimal improvement", "persistent", "severe", "unable to", "limitation"],
        }

        found_signals: List[str] = []
        for label, markers in signal_map.items():
            if any(marker in chart_text for marker in markers):
                found_signals.append(label)

        has_duration = bool(re.search(r"\b(\d+|six|eight|twelve)\s+weeks?\b", chart_text))
        if has_duration:
            found_signals.append("duration")

        return {
            "chart_text": chart_text,
            "signal_count": len(found_signals),
            "signals": found_signals,
            "note_count": len(chart.get("clinical_notes", [])),
            "evidence_count": len(chart.get("evidence_files", [])),
        }

    def match_requirement_text(self, requirement: str, chart: Dict[Any, Any]) -> Dict[str, Any]:
        requirement_text = self._normalize_text(requirement)
        chart_text = self._chart_text(chart)

        keyword_groups = {
            "conservative therapy": ["physical therapy", "conservative therapy", "home exercise", "pt "],
            "physical therapy": ["physical therapy", "pt "],
            "radiculopathy": ["radiating", "radicul", "leg pain", "nerve"],
            "neurologic deficit": ["weakness", "numbness", "reflex", "sensory"],
            "x-ray": ["x-ray", "radiograph"],
            "imaging": ["x-ray", "mri", "ct", "ultrasound", "imaging"],
            "physician rationale": ["assessment", "plan", "rationale", "failed", "minimal improvement"],
            "medication": ["ibuprofen", "naproxen", "nsaid", "medication", "steroid"],
        }

        matched_markers: List[str] = []
        for group, markers in keyword_groups.items():
            if group in requirement_text and any(marker in chart_text for marker in markers):
                matched_markers.append(group)

        duration_match = re.search(r"\b(\d+|six|eight|twelve)\s+weeks?\b", requirement_text)
        if duration_match and duration_match.group(0) in chart_text:
            matched_markers.append(duration_match.group(0))

        req_keywords = set(self._tokenize_keywords(requirement_text))
        chart_keywords = set(self._tokenize_keywords(chart_text))
        overlap = req_keywords.intersection(chart_keywords)

        matched = bool(matched_markers) or (len(req_keywords) > 0 and len(overlap) >= min(2, len(req_keywords)))
        score = 0.0
        if req_keywords:
            score = len(overlap) / len(req_keywords)
        if matched_markers:
            score = max(score, 0.75)

        explanation = ""
        if matched_markers:
            explanation = f"Matched chart evidence for {', '.join(matched_markers)}."
        elif matched:
            explanation = f"Matched keywords: {', '.join(sorted(overlap)[:4])}."
        else:
            explanation = f"Could not find chart support for requirement: {requirement.strip()}."

        return {
            "matched": matched,
            "score": round(score, 2),
            "overlap": sorted(overlap),
            "explanation": explanation,
        }

    def calculate_approval_probability(self, chart: Dict[Any, Any]) -> Tuple[int, str]:
        """Calculates effort vs approval probability to decide the initial action."""
        signals = self.summarize_chart_signals(chart)

        score = 42
        score += min(20, signals["note_count"] * 6)
        score += min(12, signals["evidence_count"] * 6)
        score += min(26, signals["signal_count"] * 6)

        if chart.get("diagnosis"):
            score += 4
        if chart.get("requested_procedure"):
            score += 4

        probability = max(20, min(94, score))

        if probability >= 80:
            reason_prefix = "High probability."
        elif probability >= 60:
            reason_prefix = "Moderate probability."
        else:
            reason_prefix = "Low probability."

        if signals["signals"]:
            evidence_summary = ", ".join(signals["signals"][:4])
            return probability, f"{reason_prefix} Chart already contains structured support signals: {evidence_summary}."

        return probability, f"{reason_prefix} Chart has basic demographics and procedure context, but limited supporting evidence."

    def economic_decision(self, probability: int, estimated_minutes: int = 12, claim_value_usd: int = 75) -> Dict[str, Any]:
        """Decides whether to file now, delay, or escalate based on expected value."""
        labor_cost = round((estimated_minutes / 60) * 25, 2)  # $25/hr baseline admin cost
        expected_recovery = round((probability / 100) * claim_value_usd, 2)

        if probability >= 70 and expected_recovery > labor_cost:
            action = "proceed"
            reason = "Positive expected value. Filing now."
        elif 50 <= probability < 70:
            action = "escalate"
            reason = "Borderline confidence. Optimize human attention with targeted review."
        else:
            action = "delay"
            reason = "Low expected return without additional evidence."

        return {
            "action": action,
            "labor_cost_usd": labor_cost,
            "expected_recovery_usd": expected_recovery,
            "reason": reason,
        }

    def extract_cpt_and_diagnosis(self, chart: Dict[Any, Any]) -> Dict[str, str]:
        """Extracts required UI codes from text."""
        # For demo purposes, we parse the raw fields. In real life, LLM extracts this from unstructured PDFs.
        diag = chart.get("diagnosis", "").split(" - ")[0]
        proc = chart.get("requested_procedure", "")
        cpt = ""
        if "CPT" in proc:
            cpt = proc.split("CPT ")[1].replace(")", "")
        return {"diagnosis_code": diag, "cpt_code": cpt}

    def _select_best_evidence_file(self, chart: Dict[Any, Any], keywords: List[str]) -> str:
        evidence_files = chart.get("evidence_files", [])
        if not evidence_files:
            return ""

        lowered_keywords = [re.sub(r"[^a-z0-9]+", "", keyword.lower()) for keyword in keywords if keyword]
        for file_name in evidence_files:
            lowered_name = re.sub(r"[^a-z0-9]+", "", file_name.lower())
            if any(keyword in lowered_name for keyword in lowered_keywords):
                return file_name

        return evidence_files[0]

    def analyze_portal_error(self, error_text: str, chart: Dict[Any, Any]) -> Dict[str, Any]:
        """Crucial Edge: Reads an error from the insurance portal and drafts a recovery plan."""
        error_text = self._normalize_text(error_text)
        chart_text = self._chart_text(chart)

        categories = [
            {
                "label": "conservative therapy",
                "keywords": ["conservative therapy", "physical therapy", "pt", "home exercise"],
                "recovery_step": "upload_therapy_evidence",
                "upload_label": "therapy evidence",
            },
            {
                "label": "imaging",
                "keywords": ["x-ray", "xray", "radiology", "imaging", "mri", "ct", "ultrasound"],
                "recovery_step": "upload_imaging_evidence",
                "upload_label": "imaging report",
            },
            {
                "label": "clinical rationale",
                "keywords": ["clinical rationale", "medical necessity", "physician rationale", "assessment", "plan"],
                "recovery_step": "upload_clinical_rationale",
                "upload_label": "clinical rationale",
            },
            {
                "label": "medication history",
                "keywords": ["medication", "nsaid", "steroid", "pharmacy"],
                "recovery_step": "upload_medication_history",
                "upload_label": "medication history",
            },
            {
                "label": "symptom documentation",
                "keywords": ["radiculopathy", "neurologic", "symptom", "pain", "weakness", "numbness"],
                "recovery_step": "upload_symptom_documentation",
                "upload_label": "symptom documentation",
            },
        ]

        for category in categories:
            if not any(keyword in error_text for keyword in category["keywords"]):
                continue

            evidence_present = any(keyword in chart_text for keyword in category["keywords"])
            file_target = self._select_best_evidence_file(chart, category["keywords"])

            if evidence_present or file_target:
                return {
                    "action": "recover",
                    "reason": (
                        f"Supporting {category['label']} evidence appears to exist in the chart. "
                        "Switching to upload and resubmit."
                    ),
                    "recovery_step": category["recovery_step"],
                    "upload_label": category["upload_label"],
                    "file_target": file_target,
                }

            return {
                "action": "escalate",
                "reason": (
                    f"Portal requires {category['label']} evidence, but the chart does not appear to contain it. "
                    "Escalating to human review."
                ),
                "missing_category": category["label"],
            }

        fallback_file = self._select_best_evidence_file(chart, [])
        if fallback_file:
            return {
                "action": "recover",
                "reason": "Portal rejection was non-specific, but the chart contains supporting files. Attempting document upload recovery.",
                "recovery_step": "upload_supporting_documentation",
                "upload_label": "supporting documentation",
                "file_target": fallback_file,
            }

        return {
            "action": "escalate",
            "reason": "Portal rejection could not be mapped to available chart evidence. Escalating to human review.",
        }

    def explanation_mode(self, chart: Dict[Any, Any], probability: int, outcome: str) -> str:
        """Returns a concise, judge-friendly post-action explanation."""
        codes = self.extract_cpt_and_diagnosis(chart)
        proc = chart.get("requested_procedure", "Unknown Procedure")
        return (
            f"Filed {proc} with CPT {codes.get('cpt_code', 'N/A')} and diagnosis {codes.get('diagnosis_code', 'N/A')}. "
            f"Approval probability was {probability}%. Final outcome: {outcome}."
        )
