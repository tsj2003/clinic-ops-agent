"""
Pre-Submission Engine
Highest-ROI feature: catch errors BEFORE claim submission
Real-time NLP documentation review with line-item mismatch detection
"""

import os
import json
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import asyncio
import aiohttp


class RiskLevel(Enum):
    """Pre-submission risk levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IssueType(Enum):
    """Types of pre-submission issues"""
    CODE_DOCUMENTATION_MISMATCH = "code_documentation_mismatch"
    MISSING_DOCUMENTATION = "missing_documentation"
    MEDICAL_NECESSITY_UNCLEAR = "medical_necessity_unclear"
    MODIFIER_MISSING = "modifier_missing"
    DIAGNOSIS_UNSUPPORTED = "diagnosis_unsupported"
    PROCEDURE_UNDOCUMENTED = "procedure_undocumented"
    UNBUNDLED_SERVICES = "unbundled_services"
    DUPLICATE_CLAIM = "duplicate_claim"


@dataclass
class PreSubmissionIssue:
    """Individual pre-submission issue"""
    issue_type: IssueType
    severity: RiskLevel
    line_item: Optional[int]  # Claim line item number
    description: str
    suggested_fix: str
    auto_fixable: bool
    confidence: float


@dataclass
class PreSubmissionReport:
    """Complete pre-submission analysis report"""
    claim_id: str
    overall_risk_score: float
    risk_level: RiskLevel
    issues: List[PreSubmissionIssue]
    can_submit: bool
    requires_human_review: bool
    auto_fixes_applied: List[Dict]
    documentation_gaps: List[str]
    estimated_denial_probability: float
    analysis_timestamp: datetime


class NLPDocumentationAnalyzer:
    """
    NLP-based clinical documentation analysis
    Ensures clinical notes support billed codes
    """
    
    def __init__(self, fireworks_api_key: Optional[str] = None):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
    
    async def analyze_documentation(
        self,
        clinical_notes: str,
        cpt_code: str,
        cpt_description: str,
        icd10_codes: List[str],
        modifiers: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Analyze if clinical documentation supports the billed codes
        """
        if not self.fireworks_api_key or not clinical_notes:
            return {
                "adequate": False,
                "confidence": 0.5,
                "supporting_evidence": [],
                "missing_elements": ["No documentation available"],
                "mismatches": []
            }
        
        prompt = f"""Analyze if the clinical documentation adequately supports the billed service.

BILLED SERVICE:
CPT Code: {cpt_code}
Description: {cpt_description}
Modifiers: {', '.join(modifiers) if modifiers else 'None'}
Diagnosis Codes: {', '.join(icd10_codes)}

CLINICAL DOCUMENTATION:
{clinical_notes[:3000]}

Analyze and respond in JSON:
{{
    "adequate": true/false,
    "confidence": 0.0-1.0,
    "supporting_evidence": ["list of specific documentation elements that support the service"],
    "missing_elements": ["list of required documentation elements that are missing"],
    "mismatches": ["list of any discrepancies between codes and documentation"],
    "recommendation": "proceed" or "obtain_additional_documentation" or "review"
}}"""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 800,
                        "temperature": 0.1
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "{}").strip()
                        
                        # Extract JSON
                        try:
                            # Find JSON block
                            if "```json" in text:
                                text = text.split("```json")[1].split("```")[0]
                            elif "```" in text:
                                text = text.split("```")[1].split("```")[0]
                            
                            result = json.loads(text)
                            return result
                        except json.JSONDecodeError:
                            # Fallback parsing
                            return self._fallback_parse(text)
        except Exception as e:
            return {
                "adequate": False,
                "confidence": 0.5,
                "supporting_evidence": [],
                "missing_elements": [f"Analysis error: {str(e)}"],
                "mismatches": []
            }
        
        return {
            "adequate": False,
            "confidence": 0.5,
            "supporting_evidence": [],
            "missing_elements": ["Unable to analyze"],
            "mismatches": []
        }
    
    def _fallback_parse(self, text: str) -> Dict[str, Any]:
        """Fallback parsing for non-JSON responses"""
        text_lower = text.lower()
        
        adequate = "adequate" in text_lower and "true" in text_lower
        
        # Extract confidence
        confidence_match = re.search(r'confidence[:\s]+([0-9.]+)', text_lower)
        confidence = float(confidence_match.group(1)) if confidence_match else 0.5
        
        return {
            "adequate": adequate,
            "confidence": confidence,
            "supporting_evidence": [],
            "missing_elements": ["Parse error - manual review needed"],
            "mismatches": []
        }
    
    def extract_key_clinical_elements(self, clinical_notes: str) -> Dict[str, List[str]]:
        """Extract key clinical elements from notes"""
        elements = {
            "chief_complaint": [],
            "history_of_present_illness": [],
            "exam_findings": [],
            "diagnosis_statements": [],
            "procedures_documented": [],
            "medications": [],
            "follow_up_instructions": []
        }
        
        notes_lower = clinical_notes.lower()
        
        # Chief complaint patterns
        cc_patterns = [
            r'chief complaint[:\s]+([^\n]+)',
            r'cc[:\s]+([^\n]+)',
            r'presented with[:\s]+([^\n]+)',
            r'patient complains? of[:\s]+([^\n]+)'
        ]
        for pattern in cc_patterns:
            matches = re.findall(pattern, notes_lower)
            elements["chief_complaint"].extend(matches)
        
        # Exam findings patterns
        exam_patterns = [
            r'physical examination?[:\s]+([^\n]+(?:\n[^\n]+){0,5})',
            r'exam[:\s]+([^\n]+(?:\n[^\n]+){0,5})',
            r'assessment[:\s]+([^\n]+)'
        ]
        for pattern in exam_patterns:
            matches = re.findall(pattern, notes_lower)
            elements["exam_findings"].extend(matches)
        
        return elements


class HistoricalPatternAnalyzer:
    """
    Analyzes historical denial patterns
    Predicts likelihood of denial based on similar claims
    """
    
    def __init__(self, db=None):
        self.db = db
    
    async def analyze_historical_patterns(
        self,
        claim_data: Dict[str, Any],
        lookback_months: int = 12
    ) -> Dict[str, Any]:
        """
        Analyze historical patterns for this claim type
        """
        if not self.db:
            return {
                "similar_claims_count": 0,
                "historical_denial_rate": 0.1,
                "common_denial_reasons": [],
                "risk_factors": []
            }
        
        start_date = datetime.utcnow() - timedelta(days=30*lookback_months)
        
        cpt_code = claim_data.get("procedure_code")
        payer_id = claim_data.get("payer_id")
        
        # Find similar claims
        query = {
            "procedure.procedure_code": cpt_code,
            "created_at": {"$gte": start_date}
        }
        
        if payer_id:
            query["payer_id"] = payer_id
        
        pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "denied": {
                        "$sum": {"$cond": [{"$eq": ["$status", "denied"]}, 1, 0]}
                    },
                    "denial_reasons": {
                        "$push": {"$cond": [{"$eq": ["$status", "denied"]}, "$denial.reason", None]}
                    }
                }
            }
        ]
        
        result = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
        
        if not result:
            return {
                "similar_claims_count": 0,
                "historical_denial_rate": 0.0,
                "common_denial_reasons": [],
                "risk_factors": []
            }
        
        stats = result[0]
        total = stats.get("total", 1)
        denied = stats.get("denied", 0)
        
        # Calculate denial rate
        denial_rate = denied / total if total > 0 else 0
        
        # Common denial reasons
        reasons = [r for r in stats.get("denial_reasons", []) if r]
        from collections import Counter
        common_reasons = Counter(reasons).most_common(3)
        
        return {
            "similar_claims_count": total,
            "historical_denial_rate": denial_rate,
            "common_denial_reasons": [{"reason": r, "count": c} for r, c in common_reasons],
            "risk_factors": self._identify_risk_factors(denial_rate, common_reasons)
        }
    
    def _identify_risk_factors(
        self,
        denial_rate: float,
        common_reasons: List[Tuple[str, int]]
    ) -> List[str]:
        """Identify specific risk factors"""
        risks = []
        
        if denial_rate > 0.3:
            risks.append(f"High historical denial rate ({denial_rate*100:.0f}%)")
        
        for reason, _ in common_reasons:
            if "medical necessity" in reason.lower():
                risks.append("Medical necessity denials common")
            if "authorization" in reason.lower():
                risks.append("Prior authorization issues frequent")
            if "documentation" in reason.lower():
                risks.append("Documentation-related denials common")
        
        return risks


class PreSubmissionEngine:
    """
    Main pre-submission analysis engine
    Coordinates NLP analysis, pattern matching, and risk scoring
    """
    
    def __init__(self, db=None):
        self.db = db
        self.nlp_analyzer = NLPDocumentationAnalyzer()
        self.pattern_analyzer = HistoricalPatternAnalyzer(db)
        
        # Risk scoring weights
        self.weights = {
            "documentation_adequacy": 0.30,
            "code_documentation_match": 0.25,
            "historical_denial_rate": 0.20,
            "payer_complexity": 0.15,
            "claim_complexity": 0.10
        }
    
    async def analyze_claim_pre_submission(
        self,
        claim_data: Dict[str, Any],
        patient_data: Dict[str, Any],
        clinical_notes: str
    ) -> PreSubmissionReport:
        """
        Comprehensive pre-submission analysis
        """
        claim_id = claim_data.get("claim_id", "unknown")
        issues = []
        auto_fixes = []
        
        # 1. NLP Documentation Analysis
        doc_analysis = await self.nlp_analyzer.analyze_documentation(
            clinical_notes=clinical_notes,
            cpt_code=claim_data.get("procedure_code"),
            cpt_description=claim_data.get("procedure_description", ""),
            icd10_codes=claim_data.get("diagnosis_codes", []),
            modifiers=claim_data.get("modifiers")
        )
        
        if not doc_analysis.get("adequate", False):
            issues.append(PreSubmissionIssue(
                issue_type=IssueType.MISSING_DOCUMENTATION,
                severity=RiskLevel.HIGH,
                line_item=None,
                description="Clinical documentation inadequate for billed service",
                suggested_fix=f"Add: {', '.join(doc_analysis.get('missing_elements', []))}",
                auto_fixable=False,
                confidence=doc_analysis.get("confidence", 0.7)
            ))
        
        # Check for code-documentation mismatches
        for mismatch in doc_analysis.get("mismatches", []):
            issues.append(PreSubmissionIssue(
                issue_type=IssueType.CODE_DOCUMENTATION_MISMATCH,
                severity=RiskLevel.CRITICAL,
                line_item=None,
                description=mismatch,
                suggested_fix="Verify coding accuracy against documentation",
                auto_fixable=False,
                confidence=0.85
            ))
        
        # 2. Historical Pattern Analysis
        historical = await self.pattern_analyzer.analyze_historical_patterns(claim_data)
        
        if historical["historical_denial_rate"] > 0.25:
            issues.append(PreSubmissionIssue(
                issue_type=IssueType.MEDICAL_NECESSITY_UNCLEAR,
                severity=RiskLevel.HIGH if historical["historical_denial_rate"] > 0.4 else RiskLevel.MEDIUM,
                line_item=None,
                description=f"Historical denial rate: {historical['historical_denial_rate']*100:.0f}%",
                suggested_fix="Review similar approved claims for documentation patterns",
                auto_fixable=False,
                confidence=historical["historical_denial_rate"]
            ))
        
        # Add risk factors as issues
        for risk in historical.get("risk_factors", []):
            issues.append(PreSubmissionIssue(
                issue_type=IssueType.MEDICAL_NECESSITY_UNCLEAR,
                severity=RiskLevel.MEDIUM,
                line_item=None,
                description=risk,
                suggested_fix="Address risk factor before submission",
                auto_fixable=False,
                confidence=0.7
            ))
        
        # 3. Auto-fix checks
        # Fix missing modifiers
        if not claim_data.get("modifiers"):
            inferred_modifiers = self._infer_modifiers(clinical_notes)
            if inferred_modifiers:
                auto_fixes.append({
                    "field": "modifiers",
                    "original": None,
                    "corrected": inferred_modifiers,
                    "reason": "Inferred from clinical notes"
                })
        
        # Fix missing place of service
        if not claim_data.get("place_of_service"):
            inferred_pos = self._infer_place_of_service(claim_data.get("procedure_code"))
            if inferred_pos:
                auto_fixes.append({
                    "field": "place_of_service",
                    "original": None,
                    "corrected": inferred_pos,
                    "reason": "Inferred from procedure code"
                })
        
        # 4. Calculate overall risk score
        risk_score = self._calculate_risk_score(
            doc_analysis,
            historical,
            claim_data,
            len(issues)
        )
        
        risk_level = self._score_to_level(risk_score)
        
        # 5. Determine submission readiness
        critical_issues = [i for i in issues if i.severity == RiskLevel.CRITICAL]
        high_issues = [i for i in issues if i.severity == RiskLevel.HIGH]
        
        can_submit = len(critical_issues) == 0 and risk_score < 0.7
        requires_review = len(high_issues) > 0 or risk_score >= 0.5
        
        return PreSubmissionReport(
            claim_id=claim_id,
            overall_risk_score=risk_score,
            risk_level=risk_level,
            issues=issues,
            can_submit=can_submit,
            requires_human_review=requires_review,
            auto_fixes_applied=auto_fixes,
            documentation_gaps=doc_analysis.get("missing_elements", []),
            estimated_denial_probability=risk_score,
            analysis_timestamp=datetime.utcnow()
        )
    
    def _calculate_risk_score(
        self,
        doc_analysis: Dict,
        historical: Dict,
        claim_data: Dict,
        issue_count: int
    ) -> float:
        """Calculate composite risk score"""
        scores = []
        
        # Documentation adequacy
        doc_score = 0.8 if doc_analysis.get("adequate", False) else 0.3
        scores.append((doc_score, self.weights["documentation_adequacy"]))
        
        # Code-documentation match
        match_score = doc_analysis.get("confidence", 0.5)
        scores.append((match_score, self.weights["code_documentation_match"]))
        
        # Historical denial rate (inverse - higher denial = lower score)
        hist_score = 1.0 - historical.get("historical_denial_rate", 0.1)
        scores.append((hist_score, self.weights["historical_denial_rate"]))
        
        # Payer complexity (simplified)
        payer_complexity = 0.8  # Default
        complex_payers = ["uhc", "aetna", "cigna"]  # Known complex
        if claim_data.get("payer_id", "").lower() in complex_payers:
            payer_complexity = 0.7
        scores.append((payer_complexity, self.weights["payer_complexity"]))
        
        # Claim complexity
        complexity = 0.9  # Simple claim
        if len(claim_data.get("diagnosis_codes", [])) > 3:
            complexity = 0.7
        if claim_data.get("modifiers"):
            complexity -= 0.1 * len(claim_data.get("modifiers"))
        scores.append((complexity, self.weights["claim_complexity"]))
        
        # Weighted average
        total_weight = sum(w for _, w in scores)
        weighted_score = sum(s * w for s, w in scores) / total_weight if total_weight > 0 else 0.5
        
        # Adjust for issue count
        issue_penalty = min(0.3, issue_count * 0.05)
        
        final_score = weighted_score - issue_penalty
        return max(0.0, min(1.0, final_score))
    
    def _score_to_level(self, score: float) -> RiskLevel:
        """Convert score to risk level"""
        if score >= 0.8:
            return RiskLevel.LOW
        elif score >= 0.6:
            return RiskLevel.MEDIUM
        elif score >= 0.4:
            return RiskLevel.HIGH
        else:
            return RiskLevel.CRITICAL
    
    def _infer_modifiers(self, clinical_notes: str) -> Optional[List[str]]:
        """Infer appropriate modifiers from clinical notes"""
        notes_lower = clinical_notes.lower()
        modifiers = []
        
        if "telehealth" in notes_lower or "virtual" in notes_lower:
            modifiers.append("95")  # Synchronous telehealth
        
        if "new patient" in notes_lower:
            # Would need to check if actually new patient
            pass
        
        if "decision for surgery" in notes_lower:
            modifiers.append("57")  # Decision for surgery
        
        return modifiers if modifiers else None
    
    def _infer_place_of_service(self, procedure_code: str) -> Optional[str]:
        """Infer place of service from procedure code"""
        # ED visits
        if procedure_code in ["99281", "99282", "99283", "99284", "99285"]:
            return "23"  # Emergency Room
        
        # Inpatient
        if procedure_code in ["99221", "99222", "99223", "99231", "99232", "99233"]:
            return "21"  # Inpatient Hospital
        
        # Office visits default
        if procedure_code in ["99211", "99212", "99213", "99214", "99215"]:
            return "11"  # Office
        
        return None
    
    async def batch_analyze(
        self,
        claims: List[Dict[str, Any]]
    ) -> List[PreSubmissionReport]:
        """Batch analyze multiple claims"""
        semaphore = asyncio.Semaphore(5)  # Limit concurrency
        
        async def analyze_with_limit(claim_data):
            async with semaphore:
                return await self.analyze_claim_pre_submission(
                    claim_data=claim_data,
                    patient_data=claim_data.get("patient", {}),
                    clinical_notes=claim_data.get("clinical_notes", "")
                )
        
        tasks = [analyze_with_limit(c) for c in claims]
        return await asyncio.gather(*tasks)
    
    def generate_billing_team_report(
        self,
        reports: List[PreSubmissionReport]
    ) -> Dict[str, Any]:
        """Generate summary report for billing team"""
        total = len(reports)
        can_submit = sum(1 for r in reports if r.can_submit)
        needs_review = sum(1 for r in reports if r.requires_human_review)
        
        risk_distribution = {
            "low": sum(1 for r in reports if r.risk_level == RiskLevel.LOW),
            "medium": sum(1 for r in reports if r.risk_level == RiskLevel.MEDIUM),
            "high": sum(1 for r in reports if r.risk_level == RiskLevel.HIGH),
            "critical": sum(1 for r in reports if r.risk_level == RiskLevel.CRITICAL)
        }
        
        # Collect common issues
        all_issues = []
        for report in reports:
            all_issues.extend([(i.issue_type.value, i.severity.value) for i in report.issues])
        
        from collections import Counter
        common_issues = Counter(all_issues).most_common(5)
        
        return {
            "total_claims_analyzed": total,
            "can_submit_immediately": can_submit,
            "requires_review": needs_review,
            "risk_distribution": risk_distribution,
            "estimated_prevented_denials": risk_distribution["high"] + risk_distribution["critical"],
            "common_issues": [{"type": t, "severity": s, "count": c} for (t, s), c in common_issues],
            "avg_risk_score": sum(r.overall_risk_score for r in reports) / total if total else 0,
            "report_generated": datetime.utcnow().isoformat()
        }


# Import needed
from datetime import timedelta

# Global instance
pre_submission_engine = PreSubmissionEngine()
