"""
Real-time Fraud Detection Engine
Identifies suspicious patterns in claims, billing, and user behavior
"""

import asyncio
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Tuple
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
from collections import defaultdict
import hashlib
import re
from functools import lru_cache


class FraudSeverity(str, Enum):
    """Fraud alert severity levels"""
    LOW = "low"           # Suspicious but explainable
    MEDIUM = "medium"     # Likely fraudulent, needs review
    HIGH = "high"         # High confidence fraud
    CRITICAL = "critical"  # Immediate action required


class FraudType(str, Enum):
    """Types of fraud/scams detected"""
    # Billing Fraud
    UPCODING = "upcoding"                    # Billing for higher complexity
    UNBUNDLING = "unbundling"                # Separating bundled services
    DUPLICATE_CLAIMS = "duplicate_claims"    # Same service, multiple claims
    FICTITIOUS_SERVICES = "fictitious"       # Services never rendered
    
    # Identity Fraud
    PATIENT_IDENTITY_THEFT = "identity_theft"
    PROVIDER_IDENTITY_FRAUD = "provider_fraud"
    
    # Prescription Fraud
    PHARMACY_FRAUD = "pharmacy_fraud"
    PRESCRIPTION_DIVERSION = "diversion"
    
    # Data Manipulation
    DOCUMENT_FORGERY = "document_forgery"
    DATE_MANIPULATION = "date_manipulation"
    
    # Behavioral Anomalies
    VELOCITY_ABUSE = "velocity_abuse"        # Too many claims too fast
    GEOGRAPHIC_ANOMALY = "geographic_anomaly"
    TIME_ANOMALY = "time_anomaly"


@dataclass
class FraudAlert:
    """Fraud detection alert"""
    alert_id: str
    fraud_type: FraudType
    severity: FraudSeverity
    confidence: float  # 0-1
    entity_type: str  # claim, patient, provider, pharmacy
    entity_id: str
    detected_at: datetime
    description: str
    evidence: Dict[str, Any]
    related_alerts: List[str]
    recommended_action: str
    status: str = "open"  # open, investigating, confirmed, false_positive


class FraudDetectionConfig(BaseModel):
    """Configuration for fraud detection engine"""
    # Thresholds
    velocity_threshold_per_day: int = Field(default=50, ge=10, le=500)
    duplicate_time_window_hours: int = Field(default=24, ge=1, le=168)
    upcoding_deviation_threshold: float = Field(default=2.0, ge=1.0, le=5.0)
    
    # Scoring weights
    velocity_weight: float = Field(default=0.25, ge=0.0, le=1.0)
    pattern_weight: float = Field(default=0.30, ge=0.0, le=1.0)
    anomaly_weight: float = Field(default=0.25, ge=0.0, le=1.0)
    behavioral_weight: float = Field(default=0.20, ge=0.0, le=1.0)
    
    # Auto-actions
    auto_hold_high_severity: bool = True
    auto_notify_critical: bool = True
    
    # Review settings
    manual_review_threshold: float = 0.7
    
    class Config:
        json_schema_extra = {
            "example": {
                "velocity_threshold_per_day": 50,
                "duplicate_time_window_hours": 24,
                "auto_hold_high_severity": True
            }
        }


class VelocityTracker:
    """Tracks claim submission velocity for fraud detection"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        # In-memory storage - in production use Redis
        self.submission_times: Dict[str, List[datetime]] = defaultdict(list)
        self.daily_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    
    def record_submission(self, entity_id: str, entity_type: str = "provider"):
        """Record a claim submission"""
        now = datetime.utcnow()
        
        # Add timestamp
        self.submission_times[entity_id].append(now)
        
        # Update daily count
        day_key = now.strftime("%Y-%m-%d")
        self.daily_counts[entity_id][day_key] += 1
        
        # Clean old data (older than 7 days)
        cutoff = now - timedelta(days=7)
        self.submission_times[entity_id] = [
            t for t in self.submission_times[entity_id] if t > cutoff
        ]
    
    def check_velocity(self, entity_id: str) -> Dict[str, Any]:
        """Check if entity is submitting claims too quickly"""
        now = datetime.utcnow()
        today = now.strftime("%Y-%m-%d")
        
        # Daily count
        daily_count = self.daily_counts[entity_id].get(today, 0)
        
        # Hourly rate (last 24 hours)
        last_24h = now - timedelta(hours=24)
        hourly_submissions = [
            t for t in self.submission_times[entity_id]
            if t > last_24h
        ]
        
        # Calculate rates
        hourly_rate = len(hourly_submissions) / 24.0
        
        # Check burst patterns (multiple submissions within minutes)
        burst_threshold = 5  # 5 submissions
        burst_window = timedelta(minutes=10)
        
        burst_count = 0
        for i, time1 in enumerate(hourly_submissions):
            count = 1
            for time2 in hourly_submissions[i+1:]:
                if time2 - time1 <= burst_window:
                    count += 1
            burst_count = max(burst_count, count)
        
        is_suspicious = (
            daily_count > self.config.velocity_threshold_per_day or
            hourly_rate > 5 or  # More than 5 per hour average
            burst_count >= burst_threshold
        )
        
        return {
            "daily_count": daily_count,
            "hourly_rate": hourly_rate,
            "max_burst": burst_count,
            "is_suspicious": is_suspicious,
            "risk_score": min(daily_count / self.config.velocity_threshold_per_day, 1.0)
        }


class DuplicateDetector:
    """Detects duplicate and near-duplicate claims"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        # Claim fingerprint storage
        self.claim_fingerprints: Dict[str, Dict] = {}
        self.recent_claims: List[Dict] = []
    
    def _generate_fingerprint(self, claim: Dict[str, Any]) -> str:
        """Generate unique fingerprint for claim"""
        # Key fields that should match for duplicates
        key_fields = [
            claim.get("patient_id", ""),
            claim.get("provider_npi", ""),
            claim.get("procedure_code", ""),
            claim.get("diagnosis_codes", []),
            claim.get("service_date", ""),
            str(claim.get("charge_amount", 0))
        ]
        
        fingerprint_str = "|".join(str(f) for f in key_fields)
        return hashlib.md5(fingerprint_str.encode()).hexdigest()[:16]
    
    def check_duplicate(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """Check if claim is a duplicate or near-duplicate"""
        fingerprint = self._generate_fingerprint(claim)
        now = datetime.utcnow()
        
        # Check exact duplicate
        if fingerprint in self.claim_fingerprints:
            existing = self.claim_fingerprints[fingerprint]
            time_diff = now - existing["submitted_at"]
            
            if time_diff <= timedelta(hours=self.config.duplicate_time_window_hours):
                return {
                    "is_duplicate": True,
                    "duplicate_type": "exact",
                    "original_claim_id": existing["claim_id"],
                    "time_since_original_hours": time_diff.total_seconds() / 3600,
                    "confidence": 0.95
                }
        
        # Check near-duplicates (same patient/provider, similar date, same procedure)
        near_duplicates = []
        for recent in self.recent_claims:
            time_diff = now - recent["submitted_at"]
            if time_diff > timedelta(hours=self.config.duplicate_time_window_hours * 7):
                continue
            
            similarity_score = self._calculate_similarity(claim, recent)
            if similarity_score > 0.8:
                near_duplicates.append({
                    "claim_id": recent["claim_id"],
                    "similarity": similarity_score,
                    "time_diff_hours": time_diff.total_seconds() / 3600
                })
        
        # Keep only recent claims (last 7 days)
        cutoff = now - timedelta(days=7)
        self.recent_claims = [
            c for c in self.recent_claims if c["submitted_at"] > cutoff
        ]
        
        # Store current claim
        self.claim_fingerprints[fingerprint] = {
            "claim_id": claim.get("claim_id"),
            "submitted_at": now
        }
        self.recent_claims.append({
            **claim,
            "fingerprint": fingerprint,
            "submitted_at": now
        })
        
        if near_duplicates:
            best_match = max(near_duplicates, key=lambda x: x["similarity"])
            return {
                "is_duplicate": True,
                "duplicate_type": "near",
                "similarity_score": best_match["similarity"],
                "similar_claims": near_duplicates[:3],
                "confidence": best_match["similarity"]
            }
        
        return {"is_duplicate": False, "confidence": 0.0}
    
    def _calculate_similarity(self, claim1: Dict, claim2: Dict) -> float:
        """Calculate similarity score between two claims"""
        scores = []
        
        # Patient match
        scores.append(1.0 if claim1.get("patient_id") == claim2.get("patient_id") else 0.0)
        
        # Provider match
        scores.append(1.0 if claim1.get("provider_npi") == claim2.get("provider_npi") else 0.0)
        
        # Procedure match
        scores.append(1.0 if claim1.get("procedure_code") == claim2.get("procedure_code") else 0.0)
        
        # Date proximity (within 7 days = 1.0, beyond = 0.0)
        try:
            date1 = datetime.fromisoformat(claim1.get("service_date", ""))
            date2 = datetime.fromisoformat(claim2.get("service_date", ""))
            date_diff = abs((date1 - date2).days)
            scores.append(max(0, 1.0 - date_diff / 7))
        except:
            scores.append(0.0)
        
        # Amount similarity (within 10% = 1.0)
        try:
            amt1 = float(claim1.get("charge_amount", 0))
            amt2 = float(claim2.get("charge_amount", 0))
            if amt1 > 0 and amt2 > 0:
                amt_diff = abs(amt1 - amt2) / max(amt1, amt2)
                scores.append(max(0, 1.0 - amt_diff * 10))
            else:
                scores.append(0.0)
        except:
            scores.append(0.0)
        
        return sum(scores) / len(scores)


class UpcodingDetector:
    """Detects upcoding (billing higher complexity than warranted)"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        # Historical patterns per provider
        self.provider_patterns: Dict[str, Dict] = {}
    
    def analyze_coding_patterns(self, provider_npi: str, claims: List[Dict]) -> Dict[str, Any]:
        """Analyze provider's coding patterns for upcoding"""
        if not claims:
            return {"risk_score": 0.0}
        
        # Extract E/M codes (99201-99215, 99281-99285)
        em_codes = [c for c in claims if c.get("procedure_code", "").startswith("992")]
        
        if len(em_codes) < 10:
            return {"risk_score": 0.0, "reason": "Insufficient data"}
        
        # Calculate complexity distribution
        complexity_scores = []
        for claim in em_codes:
            code = claim.get("procedure_code", "")
            # Higher last 2 digits = higher complexity
            try:
                complexity = int(code[-2:])
                complexity_scores.append(complexity)
            except:
                continue
        
        if not complexity_scores:
            return {"risk_score": 0.0}
        
        avg_complexity = np.mean(complexity_scores)
        complexity_std = np.std(complexity_scores)
        
        # Compare to peer benchmarks (simplified)
        # In production, compare against specialty-specific benchmarks
        peer_avg_complexity = 5.0  # Placeholder
        
        deviation = (avg_complexity - peer_avg_complexity) / peer_avg_complexity
        
        # High complexity variance might indicate selective upcoding
        high_complexity_ratio = sum(1 for c in complexity_scores if c >= 4) / len(complexity_scores)
        
        risk_score = 0.0
        reasons = []
        
        if deviation > 0.3:  # 30% higher than peers
            risk_score += 0.4
            reasons.append(f"Average complexity {deviation:.1%} above peer average")
        
        if high_complexity_ratio > 0.7:  # 70%+ high complexity visits
            risk_score += 0.3
            reasons.append(f"{high_complexity_ratio:.1%} visits coded as high complexity")
        
        if complexity_std < 1.0:  # Very low variance = possible systematic upcoding
            risk_score += 0.2
            reasons.append("Unusually consistent complexity coding")
        
        return {
            "risk_score": min(risk_score, 1.0),
            "avg_complexity": avg_complexity,
            "complexity_std": complexity_std,
            "high_complexity_ratio": high_complexity_ratio,
            "deviation_from_peer": deviation,
            "reasons": reasons,
            "sample_size": len(em_codes)
        }


class GeographicAnalyzer:
    """Analyzes geographic patterns for fraud"""
    
    def __init__(self):
        # Provider locations
        self.provider_locations: Dict[str, Tuple[float, float]] = {}
        # Patient home locations
        self.patient_locations: Dict[str, Tuple[float, float]] = {}
    
    def check_geographic_anomaly(
        self,
        patient_id: str,
        provider_npi: str,
        service_location: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Check for impossible/implausible geographic patterns"""
        # Get stored locations
        patient_loc = self.patient_locations.get(patient_id)
        provider_loc = self.provider_locations.get(provider_npi)
        
        if not patient_loc or not provider_loc:
            return {"anomaly_detected": False, "reason": "Location data unavailable"}
        
        # Calculate distance
        distance_km = self._haversine_distance(patient_loc, provider_loc)
        
        # Check for anomalies
        anomalies = []
        
        if distance_km > 200:  # 200km threshold
            anomalies.append(f"Patient-provider distance: {distance_km:.1f} km")
        
        # Check if service location matches provider location
        if service_location:
            service_lat = service_location.get("latitude")
            service_lon = service_location.get("longitude")
            
            if service_lat and service_lon:
                service_distance = self._haversine_distance(
                    provider_loc, (service_lat, service_lon)
                )
                
                if service_distance > 50:  # 50km from provider's usual location
                    anomalies.append(f"Service location {service_distance:.1f} km from provider base")
        
        return {
            "anomaly_detected": len(anomalies) > 0,
            "distance_km": distance_km,
            "anomalies": anomalies,
            "risk_score": min(len(anomalies) * 0.3, 1.0)
        }
    
    @staticmethod
    def _haversine_distance(loc1: Tuple[float, float], loc2: Tuple[float, float]) -> float:
        """Calculate distance between two lat/lon points"""
        lat1, lon1 = loc1
        lat2, lon2 = loc2
        
        R = 6371  # Earth's radius in km
        
        lat1_rad = np.radians(lat1)
        lat2_rad = np.radians(lat2)
        delta_lat = np.radians(lat2 - lat1)
        delta_lon = np.radians(lon2 - lon1)
        
        a = (np.sin(delta_lat / 2) ** 2 +
             np.cos(lat1_rad) * np.cos(lat2_rad) * np.sin(delta_lon / 2) ** 2)
        c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
        
        return R * c


class FraudDetectionEngine:
    """
    Main fraud detection engine
    Combines all detection methods and generates alerts
    """
    
    def __init__(self, config: Optional[FraudDetectionConfig] = None):
        self.config = config or FraudDetectionConfig()
        
        # Detection modules
        self.velocity_tracker = VelocityTracker(self.config)
        self.duplicate_detector = DuplicateDetector(self.config)
        self.upcoding_detector = UpcodingDetector(self.config)
        self.geographic_analyzer = GeographicAnalyzer()
        
        # Alert storage
        self.alerts: List[FraudAlert] = []
        self.alert_counter = 0
        
        # Risk scoring model (simplified rule-based)
        self.risk_weights = {
            "velocity": self.config.velocity_weight,
            "duplicate": 0.20,
            "upcoding": 0.15,
            "geographic": 0.10,
            "pattern": self.config.pattern_weight
        }
    
    async def analyze_claim(self, claim: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze a claim for fraud indicators
        
        Returns fraud risk assessment
        """
        risk_factors = []
        total_risk_score = 0.0
        
        # 1. Velocity Check
        provider_npi = claim.get("provider_npi")
        if provider_npi:
            self.velocity_tracker.record_submission(provider_npi)
            velocity_result = self.velocity_tracker.check_velocity(provider_npi)
            
            if velocity_result["is_suspicious"]:
                risk_factors.append({
                    "type": FraudType.VELOCITY_ABUSE,
                    "severity": FraudSeverity.MEDIUM if velocity_result["risk_score"] > 0.7 else FraudSeverity.LOW,
                    "confidence": velocity_result["risk_score"],
                    "details": velocity_result
                })
                total_risk_score += velocity_result["risk_score"] * self.risk_weights["velocity"]
        
        # 2. Duplicate Detection
        duplicate_result = self.duplicate_detector.check_duplicate(claim)
        if duplicate_result["is_duplicate"]:
            severity = FraudSeverity.HIGH if duplicate_result["confidence"] > 0.9 else FraudSeverity.MEDIUM
            risk_factors.append({
                "type": FraudType.DUPLICATE_CLAIMS,
                "severity": severity,
                "confidence": duplicate_result["confidence"],
                "details": duplicate_result
            })
            total_risk_score += duplicate_result["confidence"] * self.risk_weights["duplicate"]
        
        # 3. Geographic Anomaly
        geo_result = self.geographic_analyzer.check_geographic_anomaly(
            claim.get("patient_id", ""),
            provider_npi or "",
            claim.get("service_location")
        )
        
        if geo_result["anomaly_detected"]:
            risk_factors.append({
                "type": FraudType.GEOGRAPHIC_ANOMALY,
                "severity": FraudSeverity.LOW,
                "confidence": geo_result["risk_score"],
                "details": geo_result
            })
            total_risk_score += geo_result["risk_score"] * self.risk_weights["geographic"]
        
        # 4. Pattern Analysis (simplified)
        pattern_score = self._analyze_patterns(claim)
        if pattern_score > 0.5:
            risk_factors.append({
                "type": FraudType.FICTITIOUS_SERVICES,
                "severity": FraudSeverity.MEDIUM,
                "confidence": pattern_score,
                "details": {"pattern_score": pattern_score}
            })
            total_risk_score += pattern_score * self.risk_weights["pattern"]
        
        # Determine overall fraud likelihood
        overall_confidence = min(total_risk_score, 1.0)
        
        # Determine severity
        if overall_confidence >= 0.9:
            severity = FraudSeverity.CRITICAL
        elif overall_confidence >= 0.7:
            severity = FraudSeverity.HIGH
        elif overall_confidence >= 0.5:
            severity = FraudSeverity.MEDIUM
        else:
            severity = FraudSeverity.LOW
        
        # Generate alert if needed
        alert = None
        if severity in [FraudSeverity.HIGH, FraudSeverity.CRITICAL]:
            alert = self._create_alert(
                fraud_type=risk_factors[0]["type"] if risk_factors else FraudType.FICTITIOUS_SERVICES,
                severity=severity,
                confidence=overall_confidence,
                entity_type="claim",
                entity_id=claim.get("claim_id", "unknown"),
                description=f"High fraud risk detected: {len(risk_factors)} indicators",
                evidence={"risk_factors": risk_factors, "claim": claim}
            )
        
        return {
            "claim_id": claim.get("claim_id"),
            "fraud_risk_score": overall_confidence,
            "risk_level": severity.value,
            "risk_factors": risk_factors,
            "recommendation": self._get_recommendation(severity),
            "alert_generated": alert is not None,
            "alert_id": alert.alert_id if alert else None
        }
    
    def _analyze_patterns(self, claim: Dict) -> float:
        """Analyze claim for suspicious patterns"""
        suspicious_patterns = []
        
        # Round dollar amounts (often indicates made-up numbers)
        try:
            amount = float(claim.get("charge_amount", 0))
            if amount == int(amount) and amount > 0:
                suspicious_patterns.append("round_dollar_amount")
        except:
            pass
        
        # Sequential claim IDs (possible batch generation)
        claim_id = claim.get("claim_id", "")
        if re.match(r'.*\d{4,}$', claim_id):
            suspicious_patterns.append("sequential_id_pattern")
        
        # Service on weekend (unusual for some services)
        try:
            service_date = datetime.fromisoformat(claim.get("service_date", ""))
            if service_date.weekday() >= 5:  # Saturday = 5, Sunday = 6
                suspicious_patterns.append("weekend_service")
        except:
            pass
        
        # Multiple high-cost procedures in single visit
        if claim.get("procedure_code") in ["99285", "99291", "99292", "99233"]:
            suspicious_patterns.append("high_complexity_visit")
        
        return len(suspicious_patterns) * 0.15
    
    def _create_alert(
        self,
        fraud_type: FraudType,
        severity: FraudSeverity,
        confidence: float,
        entity_type: str,
        entity_id: str,
        description: str,
        evidence: Dict[str, Any]
    ) -> FraudAlert:
        """Create fraud alert"""
        self.alert_counter += 1
        
        alert = FraudAlert(
            alert_id=f"FRAUD-{datetime.utcnow().strftime('%Y%m%d')}-{self.alert_counter:04d}",
            fraud_type=fraud_type,
            severity=severity,
            confidence=confidence,
            entity_type=entity_type,
            entity_id=entity_id,
            detected_at=datetime.utcnow(),
            description=description,
            evidence=evidence,
            related_alerts=[],
            recommended_action=self._get_recommended_action(severity),
            status="open"
        )
        
        self.alerts.append(alert)
        
        # Auto-actions for high severity
        if severity == FraudSeverity.CRITICAL and self.config.auto_hold_critical:
            # In production: flag claim for manual review, notify compliance team
            pass
        
        return alert
    
    def _get_recommendation(self, severity: FraudSeverity) -> str:
        """Get action recommendation based on severity"""
        recommendations = {
            FraudSeverity.LOW: "Proceed with standard processing",
            FraudSeverity.MEDIUM: "Enhanced review recommended",
            FraudSeverity.HIGH: "Hold for manual investigation",
            FraudSeverity.CRITICAL: "Immediate compliance review required"
        }
        return recommendations.get(severity, "Review required")
    
    def _get_recommended_action(self, severity: FraudSeverity) -> str:
        """Get specific action for alert"""
        actions = {
            FraudSeverity.LOW: "Monitor and document",
            FraudSeverity.MEDIUM: "Schedule for audit review",
            FraudSeverity.HIGH: "Hold claim and investigate",
            FraudSeverity.CRITICAL: "Escalate to compliance team immediately"
        }
        return actions.get(severity, "Investigate")
    
    async def analyze_provider(self, provider_npi: str, claims: List[Dict]) -> Dict[str, Any]:
        """Analyze provider for systematic fraud patterns"""
        results = {
            "provider_npi": provider_npi,
            "analysis_timestamp": datetime.utcnow().isoformat(),
            "indicators": []
        }
        
        # Upcoding analysis
        upcoding_result = self.upcoding_detector.analyze_coding_patterns(provider_npi, claims)
        if upcoding_result["risk_score"] > 0.5:
            results["indicators"].append({
                "type": FraudType.UPCODING,
                "severity": FraudSeverity.HIGH if upcoding_result["risk_score"] > 0.7 else FraudSeverity.MEDIUM,
                "confidence": upcoding_result["risk_score"],
                "details": upcoding_result
            })
        
        # Velocity analysis
        velocity_result = self.velocity_tracker.check_velocity(provider_npi)
        if velocity_result["is_suspicious"]:
            results["indicators"].append({
                "type": FraudType.VELOCITY_ABUSE,
                "severity": FraudSeverity.MEDIUM,
                "confidence": velocity_result["risk_score"],
                "details": velocity_result
            })
        
        # Overall risk
        total_risk = sum(i["confidence"] for i in results["indicators"])
        results["overall_risk_score"] = min(total_risk, 1.0)
        results["risk_level"] = "high" if total_risk > 0.7 else "medium" if total_risk > 0.4 else "low"
        
        return results
    
    def get_alerts(
        self,
        status: Optional[str] = None,
        severity: Optional[FraudSeverity] = None,
        fraud_type: Optional[FraudType] = None,
        limit: int = 100
    ) -> List[FraudAlert]:
        """Query fraud alerts with filters"""
        filtered = self.alerts
        
        if status:
            filtered = [a for a in filtered if a.status == status]
        
        if severity:
            filtered = [a for a in filtered if a.severity == severity]
        
        if fraud_type:
            filtered = [a for a in filtered if a.fraud_type == fraud_type]
        
        return sorted(filtered, key=lambda x: x.detected_at, reverse=True)[:limit]
    
    def update_alert_status(
        self,
        alert_id: str,
        new_status: str,
        notes: Optional[str] = None
    ) -> bool:
        """Update alert status (investigating, confirmed, false_positive)"""
        for alert in self.alerts:
            if alert.alert_id == alert_id:
                alert.status = new_status
                # Store notes in evidence
                if notes:
                    alert.evidence["investigation_notes"] = notes
                return True
        return False


# ==================== API ENDPOINTS ====================

async def check_claim_fraud(claim: Dict[str, Any]) -> Dict[str, Any]:
    """API endpoint to check claim for fraud"""
    engine = FraudDetectionEngine()
    return await engine.analyze_claim(claim)


async def check_provider_fraud(provider_npi: str, claims: List[Dict]) -> Dict[str, Any]:
    """API endpoint to analyze provider for fraud patterns"""
    engine = FraudDetectionEngine()
    return await engine.analyze_provider(provider_npi, claims)


async def get_fraud_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None
) -> List[Dict]:
    """API endpoint to get fraud alerts"""
    engine = FraudDetectionEngine()
    
    severity_enum = None
    if severity:
        severity_enum = FraudSeverity(severity)
    
    alerts = engine.get_alerts(status=status, severity=severity_enum)
    
    return [
        {
            "alert_id": a.alert_id,
            "fraud_type": a.fraud_type.value,
            "severity": a.severity.value,
            "confidence": a.confidence,
            "entity_type": a.entity_type,
            "entity_id": a.entity_id,
            "detected_at": a.detected_at.isoformat(),
            "description": a.description,
            "status": a.status,
            "recommended_action": a.recommended_action
        }
        for a in alerts
    ]
