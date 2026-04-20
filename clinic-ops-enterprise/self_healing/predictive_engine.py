"""
Self-Healing Revenue Cycle Engine
Proactively identifies and fixes errors before claim submission
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import asyncio
import aiohttp


class RiskLevel(str, Enum):
    """Prediction risk levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class FixAction(str, Enum):
    """Available fix actions"""
    NONE = "none"
    AUTO_FIX = "auto_fix"
    FLAG_FOR_REVIEW = "flag_for_review"
    BLOCK_SUBMISSION = "block_submission"


@dataclass
class PredictionResult:
    """Denial prediction result"""
    claim_id: str
    denial_probability: float
    predicted_denial_reason: str
    risk_level: RiskLevel
    confidence_score: float
    recommended_actions: List[str]
    auto_fixable: bool
    estimated_recovery_if_fixed: float


@dataclass
class AutoFixResult:
    """Automated fix result"""
    claim_id: str
    fix_applied: bool
    fix_type: str
    original_value: str
    corrected_value: str
    confidence: float
    requires_human_review: bool
    fix_timestamp: datetime


class PredictiveDenialEngine:
    """
    ML-based engine to predict claim denials before submission
    Uses historical patterns and AI analysis
    """
    
    def __init__(
        self,
        fireworks_api_key: Optional[str] = None,
        historical_data: Optional[List[Dict]] = None
    ):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.historical_data = historical_data or []
        self.denial_patterns = self._load_denial_patterns()
    
    def _load_denial_patterns(self) -> Dict[str, Any]:
        """Load historical denial patterns"""
        return {
            "high_risk_combinations": [
                {"cpt": "99285", "payer": "aetna", "risk": 0.75, "reason": "ED visit auth issues"},
                {"cpt": "71020", "payer": "uhc", "risk": 0.65, "reason": "X-ray without prior ED visit"},
                {"cpt": "80053", "diagnosis": "Z00.00", "risk": 0.80, "reason": "Lab with wellness dx"},
            ],
            "missing_field_patterns": [
                {"field": "referring_provider_npi", "cpts": ["99213", "99214"], "risk": 0.60},
                {"field": "prior_auth_number", "cpts": ["99285", "71020"], "risk": 0.85},
                {"field": "place_of_service", "risk": 0.40},
            ],
            "documentation_gaps": [
                {"procedure": "99285", "requires": ["chief_complaint", "exam_findings"], "risk": 0.70},
                {"procedure": "36415", "requires": ["medical_necessity"], "risk": 0.50},
            ]
        }
    
    async def predict_denial_likelihood(
        self,
        claim_data: Dict[str, Any],
        payer_history: Optional[List[Dict]] = None
    ) -> PredictionResult:
        """
        Predict likelihood of claim denial
        Uses both rule-based patterns and AI analysis
        """
        claim_id = claim_data.get("claim_id", "unknown")
        
        # 1. Rule-based risk scoring
        rule_risk = self._calculate_rule_based_risk(claim_data)
        
        # 2. AI-based prediction (if API available)
        ai_risk = await self._calculate_ai_risk(claim_data)
        
        # 3. Historical pattern matching
        hist_risk = self._calculate_historical_risk(claim_data, payer_history)
        
        # Combine risks (weighted average)
        combined_risk = (rule_risk * 0.4) + (ai_risk * 0.4) + (hist_risk * 0.2)
        
        # Determine risk level
        risk_level = self._risk_to_level(combined_risk)
        
        # Get predicted reason
        predicted_reason = self._get_predicted_reason(claim_data, combined_risk)
        
        # Get recommendations
        recommendations = self._generate_recommendations(claim_data, combined_risk)
        
        # Check if auto-fixable
        auto_fixable = self._check_auto_fixable(claim_data, recommendations)
        
        # Calculate recovery value
        recovery = claim_data.get("billed_amount", 0) * (1 - combined_risk)
        
        return PredictionResult(
            claim_id=claim_id,
            denial_probability=combined_risk,
            predicted_denial_reason=predicted_reason,
            risk_level=risk_level,
            confidence_score=self._calculate_confidence(rule_risk, ai_risk, hist_risk),
            recommended_actions=recommendations,
            auto_fixable=auto_fixable,
            estimated_recovery_if_fixed=recovery
        )
    
    def _calculate_rule_based_risk(self, claim_data: Dict) -> float:
        """Calculate risk based on rule patterns"""
        risk_score = 0.0
        risk_factors = 0
        
        cpt = claim_data.get("procedure_code", "")
        payer = claim_data.get("payer_id", "")
        diagnosis_codes = claim_data.get("diagnosis_codes", [])
        
        # Check high-risk combinations
        for pattern in self.denial_patterns["high_risk_combinations"]:
            matches = True
            if "cpt" in pattern and pattern["cpt"] != cpt:
                matches = False
            if "payer" in pattern and pattern["payer"] != payer:
                matches = False
            if "diagnosis" in pattern and pattern["diagnosis"] not in diagnosis_codes:
                matches = False
            
            if matches:
                risk_score += pattern["risk"]
                risk_factors += 1
        
        # Check missing fields
        for pattern in self.denial_patterns["missing_field_patterns"]:
            field = pattern["field"]
            if not claim_data.get(field):
                # Check if CPT matches
                if "cpts" in pattern:
                    if cpt in pattern["cpts"]:
                        risk_score += pattern["risk"]
                        risk_factors += 1
                else:
                    risk_score += pattern["risk"]
                    risk_factors += 1
        
        # Check documentation gaps
        clinical_notes = claim_data.get("clinical_notes", "")
        for pattern in self.denial_patterns["documentation_gaps"]:
            if pattern["procedure"] == cpt:
                missing = []
                for req in pattern["requires"]:
                    if req not in clinical_notes.lower():
                        missing.append(req)
                if missing:
                    risk_score += pattern["risk"]
                    risk_factors += 1
        
        # Return average risk
        if risk_factors == 0:
            return 0.1  # Baseline risk
        
        return min(0.95, risk_score / risk_factors)
    
    async def _calculate_ai_risk(self, claim_data: Dict) -> float:
        """Use AI to predict denial risk"""
        if not self.fireworks_api_key:
            return 0.3  # Default medium risk
        
        prompt = f"""Analyze this medical claim and predict denial probability (0.0-1.0).

Claim Data:
- Procedure: {claim_data.get('procedure_code')}
- Diagnosis: {claim_data.get('diagnosis_codes')}
- Payer: {claim_data.get('payer_id')}
- Billed Amount: ${claim_data.get('billed_amount')}
- Provider NPI: {claim_data.get('provider_npi')}
- Place of Service: {claim_data.get('place_of_service')}

Respond with only a number between 0.0 and 1.0 representing denial probability."""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 10,
                        "temperature": 0.1
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "0.3")
                        try:
                            risk = float(text.strip())
                            return max(0.0, min(1.0, risk))
                        except ValueError:
                            return 0.3
        except Exception:
            pass
        
        return 0.3
    
    def _calculate_historical_risk(
        self,
        claim_data: Dict,
        payer_history: Optional[List[Dict]]
    ) -> float:
        """Calculate risk based on historical patterns"""
        if not payer_history:
            return 0.2
        
        cpt = claim_data.get("procedure_code", "")
        provider = claim_data.get("provider_npi", "")
        
        # Find similar claims
        similar = [
            c for c in payer_history
            if c.get("procedure_code") == cpt
            or c.get("provider_npi") == provider
        ]
        
        if not similar:
            return 0.2
        
        # Calculate denial rate for similar claims
        denied = sum(1 for c in similar if c.get("status") in ["denied", "rejected"])
        return denied / len(similar)
    
    def _risk_to_level(self, risk: float) -> RiskLevel:
        """Convert risk score to level"""
        if risk < 0.2:
            return RiskLevel.LOW
        elif risk < 0.5:
            return RiskLevel.MEDIUM
        elif risk < 0.8:
            return RiskLevel.HIGH
        else:
            return RiskLevel.CRITICAL
    
    def _get_predicted_reason(self, claim_data: Dict, risk: float) -> str:
        """Get most likely denial reason"""
        cpt = claim_data.get("procedure_code", "")
        payer = claim_data.get("payer_id", "")
        
        # Check patterns
        for pattern in self.denial_patterns["high_risk_combinations"]:
            if pattern.get("cpt") == cpt and pattern.get("payer") == payer:
                return pattern["reason"]
        
        # Check missing fields
        for pattern in self.denial_patterns["missing_field_patterns"]:
            if not claim_data.get(pattern["field"]):
                return f"Missing required field: {pattern['field']}"
        
        # Default
        if risk > 0.7:
            return "Multiple risk factors detected - review recommended"
        elif risk > 0.4:
            return "Some risk factors present"
        else:
            return "Low risk - standard processing"
    
    def _generate_recommendations(self, claim_data: Dict, risk: float) -> List[str]:
        """Generate action recommendations"""
        recommendations = []
        
        if risk > 0.5:
            recommendations.append("Review clinical documentation for medical necessity")
        
        if not claim_data.get("prior_auth_number"):
            if claim_data.get("procedure_code") in ["99285", "71020"]:
                recommendations.append("Verify prior authorization status")
        
        if not claim_data.get("referring_provider_npi"):
            recommendations.append("Add referring provider NPI if applicable")
        
        if claim_data.get("billed_amount", 0) > 1000:
            recommendations.append("High-value claim - consider additional documentation")
        
        return recommendations
    
    def _check_auto_fixable(self, claim_data: Dict, recommendations: List[str]) -> bool:
        """Check if issues can be auto-fixed"""
        # Some issues can be auto-fixed
        auto_fixable_issues = [
            "Missing required field: place_of_service",
            "Missing required field: rendering_provider_npi",
        ]
        
        for rec in recommendations:
            if any(issue in rec for issue in auto_fixable_issues):
                return True
        
        return False
    
    def _calculate_confidence(self, rule_risk: float, ai_risk: float, hist_risk: float) -> float:
        """Calculate overall prediction confidence"""
        # Higher variance = lower confidence
        risks = [rule_risk, ai_risk, hist_risk]
        variance = max(risks) - min(risks)
        
        # Confidence decreases as variance increases
        confidence = 1.0 - (variance * 0.5)
        return max(0.5, min(1.0, confidence))


class AutoFixEngine:
    """
    Automatically fixes common claim errors
    """
    
    def __init__(self, db=None):
        self.db = db
        self.fix_rules = self._load_fix_rules()
    
    def _load_fix_rules(self) -> Dict[str, Any]:
        """Load automated fix rules"""
        return {
            "place_of_service": {
                "default": "11",  # Office
                "inference_from": ["procedure_code", "provider_type"]
            },
            "modifier": {
                "rules": [
                    {"condition": "telehealth", "add": "95"},
                    {"condition": "new_patient", "add": "25"},
                ]
            },
            "diagnosis_pointer": {
                "default": "1",
                "mapping": "primary_diagnosis"
            },
            "service_unit": {
                "default": "1",
                "procedure_defaults": {
                    "36415": "1",  # Venipuncture - 1 unit
                    "80053": "1",  # CMP - 1 unit
                }
            }
        }
    
    async def attempt_auto_fix(
        self,
        claim_data: Dict[str, Any],
        prediction: PredictionResult
    ) -> AutoFixResult:
        """
        Attempt to automatically fix identified issues
        """
        claim_id = claim_data.get("claim_id", "unknown")
        
        if not prediction.auto_fixable:
            return AutoFixResult(
                claim_id=claim_id,
                fix_applied=False,
                fix_type="none",
                original_value="",
                corrected_value="",
                confidence=0.0,
                requires_human_review=True,
                fix_timestamp=datetime.utcnow()
            )
        
        # Try to apply fixes
        fixes_applied = []
        corrections = {}
        
        # Fix 1: Missing place of service
        if not claim_data.get("place_of_service"):
            original = claim_data.get("place_of_service", "")
            corrected = self._infer_place_of_service(claim_data)
            if corrected:
                corrections["place_of_service"] = (original, corrected)
                fixes_applied.append("place_of_service")
        
        # Fix 2: Missing service units
        if not claim_data.get("service_units"):
            original = claim_data.get("service_units", "")
            corrected = self._infer_service_units(claim_data)
            if corrected:
                corrections["service_units"] = (original, corrected)
                fixes_applied.append("service_units")
        
        # Fix 3: Missing modifiers
        if not claim_data.get("modifiers"):
            original = claim_data.get("modifiers", [])
            corrected = self._infer_modifiers(claim_data)
            if corrected:
                corrections["modifiers"] = (original, corrected)
                fixes_applied.append("modifiers")
        
        # Apply fixes to database if db available
        if self.db and fixes_applied:
            await self._apply_fixes_to_db(claim_id, corrections)
        
        # Determine if human review still needed
        requires_review = len(fixes_applied) == 0 or prediction.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]
        
        return AutoFixResult(
            claim_id=claim_id,
            fix_applied=len(fixes_applied) > 0,
            fix_type=",".join(fixes_applied) if fixes_applied else "none",
            original_value=str(corrections.get(fixes_applied[0], ("", ""))[0]) if fixes_applied else "",
            corrected_value=str(corrections.get(fixes_applied[0], ("", ""))[1]) if fixes_applied else "",
            confidence=0.8 if fixes_applied else 0.0,
            requires_human_review=requires_review,
            fix_timestamp=datetime.utcnow()
        )
    
    def _infer_place_of_service(self, claim_data: Dict) -> Optional[str]:
        """Infer place of service from context"""
        procedure = claim_data.get("procedure_code", "")
        
        # ED procedures
        if procedure in ["99281", "99282", "99283", "99284", "99285"]:
            return "23"  # Emergency Room
        
        # Inpatient procedures
        if procedure in ["99221", "99222", "99223"]:
            return "21"  # Inpatient Hospital
        
        # Default to office
        return "11"  # Office
    
    def _infer_service_units(self, claim_data: Dict) -> Optional[str]:
        """Infer service units from procedure"""
        procedure = claim_data.get("procedure_code", "")
        
        defaults = self.fix_rules["service_unit"]["procedure_defaults"]
        return defaults.get(procedure, "1")
    
    def _infer_modifiers(self, claim_data: Dict) -> Optional[List[str]]:
        """Infer appropriate modifiers"""
        modifiers = []
        clinical_notes = claim_data.get("clinical_notes", "").lower()
        
        # Telehealth
        if "telehealth" in clinical_notes or "virtual" in clinical_notes or "video" in clinical_notes:
            modifiers.append("95")
        
        # New patient (would need historical data to confirm)
        # This is a simplified example
        
        return modifiers if modifiers else None
    
    async def _apply_fixes_to_db(
        self,
        claim_id: str,
        corrections: Dict[str, Tuple]
    ):
        """Apply corrections to database"""
        if not self.db:
            return
        
        update_data = {
            f"corrections.{field}": {
                "original": orig,
                "corrected": new,
                "timestamp": datetime.utcnow()
            }
            for field, (orig, new) in corrections.items()
        }
        
        update_data["auto_fixed"] = True
        update_data["fixed_at"] = datetime.utcnow()
        
        await self.db.denial_claims.update_one(
            {"_id": claim_id},
            {"$set": update_data}
        )


class SelfHealingOrchestrator:
    """
    Orchestrates the self-healing revenue cycle
    """
    
    def __init__(self, db=None):
        self.predictive_engine = PredictiveDenialEngine()
        self.auto_fix_engine = AutoFixEngine(db)
        self.db = db
    
    async def process_claim_pre_submission(
        self,
        claim_data: Dict[str, Any],
        payer_history: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        Process claim before submission
        Predict issues and auto-fix if possible
        """
        # Step 1: Predict denial likelihood
        prediction = await self.predictive_engine.predict_denial_likelihood(
            claim_data,
            payer_history
        )
        
        # Step 2: Attempt auto-fix if applicable
        fix_result = None
        if prediction.auto_fixable and prediction.denial_probability > 0.3:
            fix_result = await self.auto_fix_engine.attempt_auto_fix(
                claim_data,
                prediction
            )
        
        # Step 3: Determine action
        action = self._determine_action(prediction, fix_result)
        
        # Step 4: Store prediction
        if self.db:
            await self._store_prediction(claim_data["claim_id"], prediction, fix_result)
        
        return {
            "claim_id": claim_data["claim_id"],
            "prediction": prediction,
            "auto_fix": fix_result,
            "recommended_action": action,
            "can_submit": action != FixAction.BLOCK_SUBMISSION,
            "requires_review": action in [FixAction.FLAG_FOR_REVIEW, FixAction.NONE],
            "processing_timestamp": datetime.utcnow().isoformat()
        }
    
    def _determine_action(
        self,
        prediction: PredictionResult,
        fix_result: Optional[AutoFixResult]
    ) -> FixAction:
        """Determine next action based on prediction and fix results"""
        # Critical risk - block submission
        if prediction.risk_level == RiskLevel.CRITICAL:
            return FixAction.BLOCK_SUBMISSION
        
        # High risk - flag for review
        if prediction.risk_level == RiskLevel.HIGH:
            return FixAction.FLAG_FOR_REVIEW
        
        # Auto-fix applied successfully
        if fix_result and fix_result.fix_applied and not fix_result.requires_human_review:
            return FixAction.AUTO_FIX
        
        # Medium risk - flag for review if not fixed
        if prediction.risk_level == RiskLevel.MEDIUM:
            return FixAction.FLAG_FOR_REVIEW
        
        # Low risk - proceed
        return FixAction.NONE
    
    async def _store_prediction(
        self,
        claim_id: str,
        prediction: PredictionResult,
        fix_result: Optional[AutoFixResult]
    ):
        """Store prediction in database"""
        if not self.db:
            return
        
        doc = {
            "claim_id": claim_id,
            "prediction": {
                "denial_probability": prediction.denial_probability,
                "predicted_reason": prediction.predicted_denial_reason,
                "risk_level": prediction.risk_level.value,
                "confidence": prediction.confidence_score,
                "recommendations": prediction.recommended_actions,
            },
            "auto_fix": {
                "applied": fix_result.fix_applied if fix_result else False,
                "fix_type": fix_result.fix_type if fix_result else None,
                "requires_review": fix_result.requires_human_review if fix_result else True,
            } if fix_result else None,
            "created_at": datetime.utcnow()
        }
        
        await self.db.claim_predictions.insert_one(doc)
    
    async def get_self_healing_metrics(
        self,
        organization_id: str,
        period_days: int = 30
    ) -> Dict[str, Any]:
        """
        Get metrics on self-healing performance
        """
        if not self.db:
            return {}
        
        start_date = datetime.utcnow() - timedelta(days=period_days)
        
        # Aggregate predictions
        pipeline = [
            {
                "$match": {
                    "created_at": {"$gte": start_date}
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_predictions": {"$sum": 1},
                    "high_risk_flagged": {
                        "$sum": {
                            "$cond": [{"$eq": ["$prediction.risk_level", "high"]}, 1, 0]
                        }
                    },
                    "auto_fixed": {
                        "$sum": {
                            "$cond": [{"$eq": ["$auto_fix.applied", True]}, 1, 0]
                        }
                    },
                    "avg_denial_probability": {"$avg": "$prediction.denial_probability"},
                }
            }
        ]
        
        result = await self.db.claim_predictions.aggregate(pipeline).to_list(length=1)
        stats = result[0] if result else {}
        
        return {
            "period_days": period_days,
            "total_claims_analyzed": stats.get("total_predictions", 0),
            "high_risk_flagged": stats.get("high_risk_flagged", 0),
            "auto_fixed_count": stats.get("auto_fixed", 0),
            "avg_denial_probability": stats.get("avg_denial_probability", 0),
            "self_healing_rate": (
                stats.get("auto_fixed", 0) / stats.get("total_predictions", 1) * 100
            ) if stats.get("total_predictions") else 0,
            "prevented_denials_estimate": stats.get("high_risk_flagged", 0) * 0.7,  # Assume 70% would have been denied
        }


# Global instances
predictive_engine = PredictiveDenialEngine()
auto_fix_engine = AutoFixEngine()
self_healing_orchestrator = SelfHealingOrchestrator()
