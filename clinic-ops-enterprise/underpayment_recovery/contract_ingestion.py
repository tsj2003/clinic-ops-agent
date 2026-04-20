"""
Autonomous Underpayment Recovery Engine
AI-powered contract analysis and underpayment detection
"""

import os
import json
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import aiohttp
from decimal import Decimal, ROUND_HALF_UP


class ContractTermType(str, Enum):
    """Types of contract terms"""
    RATE_SCHEDULE = "rate_schedule"
    TIMELY_FILING = "timely_filing"
    BUNDLING_RULES = "bundling_rules"
    MODIFIER_RULES = "modifier_rules"
    PLACE_OF_SERVICE = "place_of_service"
    PRIOR_AUTH_REQUIREMENTS = "prior_auth_requirements"
    DOWNCODE_PROTECTION = "downcode_protection"


class UnderpaymentSeverity(str, Enum):
    """Severity levels for underpayments"""
    LOW = "low"  # <$50
    MEDIUM = "medium"  # $50-$500
    HIGH = "high"  # $500-$2000
    CRITICAL = "critical"  # >$2000


@dataclass
class ContractTerm:
    """Extracted contract term"""
    term_type: ContractTermType
    procedure_code: Optional[str]
    modifier: Optional[str]
    place_of_service: Optional[str]
    contracted_rate: Optional[Decimal]
    payer_id: str
    effective_date: datetime
    expiration_date: Optional[datetime]
    special_conditions: List[str]
    raw_text: str
    confidence: float


@dataclass
class ERAClaim:
    """Electronic Remittance Advice claim"""
    claim_id: str
    patient_id: str
    procedure_code: str
    modifier: Optional[str]
    place_of_service: str
    billed_amount: Decimal
    paid_amount: Decimal
    allowed_amount: Decimal
    denial_code: Optional[str]
    denial_reason: Optional[str]
    payer_id: str
    payment_date: datetime
    service_date: datetime
    underpayment_detected: bool = False
    underpayment_amount: Decimal = field(default_factory=lambda: Decimal("0"))


@dataclass
class UnderpaymentFlag:
    """Detected underpayment"""
    flag_id: str
    era_claim: ERAClaim
    contract_term: ContractTerm
    expected_amount: Decimal
    actual_amount: Decimal
    underpayment_amount: Decimal
    severity: UnderpaymentSeverity
    recovery_deadline: datetime
    dispute_window_days: int
    auto_recovery_eligible: bool
    dispute_initiated: bool = False
    recovery_status: str = "pending"


class ContractIngestionEngine:
    """
    AI-powered contract ingestion and term extraction
    """
    
    def __init__(
        self,
        fireworks_api_key: Optional[str] = None,
        mixedbread_api_key: Optional[str] = None
    ):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.mixedbread_api_key = mixedbread_api_key or os.getenv("MIXEDBREAD_API_KEY")
        self.extracted_terms: Dict[str, List[ContractTerm]] = {}
        self.contract_cache: Dict[str, Dict] = {}
    
    async def ingest_contract_document(
        self,
        contract_id: str,
        payer_id: str,
        document_text: str,
        document_type: str = "pdf"
    ) -> Dict[str, Any]:
        """
        Ingest and analyze a payer contract document
        Extract key terms using AI
        """
        # Use AI to extract contract terms
        extraction_result = await self._extract_terms_with_ai(
            document_text, payer_id
        )
        
        # Parse and structure the terms
        terms = self._parse_extracted_terms(extraction_result, payer_id)
        
        # Store in cache
        self.contract_cache[contract_id] = {
            "payer_id": payer_id,
            "document_type": document_type,
            "ingested_at": datetime.utcnow(),
            "terms": [self._term_to_dict(t) for t in terms],
            "raw_extraction": extraction_result
        }
        
        # Index terms by payer for quick lookup
        if payer_id not in self.extracted_terms:
            self.extracted_terms[payer_id] = []
        self.extracted_terms[payer_id].extend(terms)
        
        return {
            "contract_id": contract_id,
            "payer_id": payer_id,
            "terms_extracted": len(terms),
            "term_types": list(set(t.term_type.value for t in terms)),
            "high_confidence_terms": len([t for t in terms if t.confidence > 0.8]),
            "requires_review": len([t for t in terms if t.confidence < 0.6]) > 0
        }
    
    async def _extract_terms_with_ai(
        self,
        document_text: str,
        payer_id: str
    ) -> Dict[str, Any]:
        """Use AI to extract contract terms from document"""
        if not self.fireworks_api_key:
            # Return mock extraction for testing
            return self._generate_mock_extraction(payer_id)
        
        prompt = f"""Extract all payment terms from this payer contract.

Contract Text:
{document_text[:8000]}  # Limit to 8K chars

Extract and return in JSON format:
{{
    "rate_schedule": [
        {{
            "procedure_code": "CPT code or 'all'",
            "modifier": "modifier or null",
            "place_of_service": "pos code or null",
            "contracted_rate": "rate as decimal",
            "special_conditions": ["conditions"]
        }}
    ],
    "timely_filing": {{
        "days": number,
        "exceptions": ["exceptions"]
    }},
    "bundling_rules": [
        {{
            "primary_code": "CPT",
            "bundled_codes": ["CPTs"],
            "explanation": "description"
        }}
    ],
    "modifier_rules": [
        {{
            "modifier": "modifier code",
            "payment_impact": "description"
        }}
    ],
    "downcode_protection": {{
        "applies": true/false,
        "conditions": "description"
    }}
}}"""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 2000,
                        "temperature": 0.1
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "{}").strip()
                        
                        # Extract JSON
                        if "```json" in text:
                            text = text.split("```json")[1].split("```")[0]
                        elif "```" in text:
                            text = text.split("```")[1].split("```")[0]
                        
                        return json.loads(text)
        except Exception as e:
            print(f"Contract extraction error: {e}")
        
        return self._generate_mock_extraction(payer_id)
    
    def _generate_mock_extraction(self, payer_id: str) -> Dict[str, Any]:
        """Generate mock extraction for testing"""
        return {
            "rate_schedule": [
                {
                    "procedure_code": "99213",
                    "modifier": None,
                    "place_of_service": "11",
                    "contracted_rate": "125.00",
                    "special_conditions": []
                },
                {
                    "procedure_code": "99214",
                    "modifier": None,
                    "place_of_service": "11",
                    "contracted_rate": "185.00",
                    "special_conditions": []
                },
                {
                    "procedure_code": "99285",
                    "modifier": None,
                    "place_of_service": "23",
                    "contracted_rate": "450.00",
                    "special_conditions": ["Requires modifier 25 if E/M same day"]
                }
            ],
            "timely_filing": {
                "days": 180,
                "exceptions": ["Medicare crossover claims 365 days"]
            },
            "bundling_rules": [
                {
                    "primary_code": "99213",
                    "bundled_codes": ["36415"],
                    "explanation": "Venipuncture bundled with office visit"
                }
            ],
            "modifier_rules": [
                {
                    "modifier": "25",
                    "payment_impact": "Significant separately identifiable E/M"
                },
                {
                    "modifier": "59",
                    "payment_impact": "Distinct procedural service"
                }
            ],
            "downcode_protection": {
                "applies": True,
                "conditions": "Must meet medical necessity documentation requirements"
            }
        }
    
    def _parse_extracted_terms(
        self,
        extraction: Dict[str, Any],
        payer_id: str
    ) -> List[ContractTerm]:
        """Parse AI extraction into ContractTerm objects"""
        terms = []
        
        # Parse rate schedule
        for rate in extraction.get("rate_schedule", []):
            try:
                term = ContractTerm(
                    term_type=ContractTermType.RATE_SCHEDULE,
                    procedure_code=rate.get("procedure_code"),
                    modifier=rate.get("modifier"),
                    place_of_service=rate.get("place_of_service"),
                    contracted_rate=Decimal(rate.get("contracted_rate", "0")),
                    payer_id=payer_id,
                    effective_date=datetime.utcnow(),
                    expiration_date=None,
                    special_conditions=rate.get("special_conditions", []),
                    raw_text=json.dumps(rate),
                    confidence=0.85
                )
                terms.append(term)
            except Exception:
                continue
        
        # Parse timely filing
        timely_filing = extraction.get("timely_filing", {})
        if timely_filing:
            term = ContractTerm(
                term_type=ContractTermType.TIMELY_FILING,
                procedure_code=None,
                modifier=None,
                place_of_service=None,
                contracted_rate=None,
                payer_id=payer_id,
                effective_date=datetime.utcnow(),
                expiration_date=datetime.utcnow() + timedelta(days=timely_filing.get("days", 180)),
                special_conditions=timely_filing.get("exceptions", []),
                raw_text=json.dumps(timely_filing),
                confidence=0.90
            )
            terms.append(term)
        
        return terms
    
    def _term_to_dict(self, term: ContractTerm) -> Dict[str, Any]:
        """Convert ContractTerm to dictionary"""
        return {
            "term_type": term.term_type.value,
            "procedure_code": term.procedure_code,
            "modifier": term.modifier,
            "place_of_service": term.place_of_service,
            "contracted_rate": str(term.contracted_rate) if term.contracted_rate else None,
            "payer_id": term.payer_id,
            "effective_date": term.effective_date.isoformat(),
            "expiration_date": term.expiration_date.isoformat() if term.expiration_date else None,
            "special_conditions": term.special_conditions,
            "confidence": term.confidence
        }
    
    def get_contracted_rate(
        self,
        payer_id: str,
        procedure_code: str,
        modifier: Optional[str] = None,
        place_of_service: Optional[str] = None
    ) -> Optional[Decimal]:
        """Get contracted rate for specific procedure"""
        if payer_id not in self.extracted_terms:
            return None
        
        # Find matching term
        for term in self.extracted_terms[payer_id]:
            if term.term_type != ContractTermType.RATE_SCHEDULE:
                continue
            
            # Match procedure code
            if term.procedure_code != procedure_code:
                # Check for 'all' wildcard
                if term.procedure_code != "all":
                    continue
            
            # Match modifier if specified
            if modifier and term.modifier and term.modifier != modifier:
                continue
            
            # Match place of service if specified
            if place_of_service and term.place_of_service and term.place_of_service != place_of_service:
                continue
            
            return term.contracted_rate
        
        return None


class UnderpaymentDetectionEngine:
    """
    Real-time underpayment detection from ERA sweeps
    """
    
    def __init__(
        self,
        contract_engine: ContractIngestionEngine,
        db=None
    ):
        self.contract_engine = contract_engine
        self.db = db
        self.flagged_underpayments: List[UnderpaymentFlag] = []
    
    async def sweep_era_batch(
        self,
        era_claims: List[Dict[str, Any]]
    ) -> List[UnderpaymentFlag]:
        """
        Sweep batch of ERA claims for underpayments
        """
        detected = []
        
        for era_data in era_claims:
            # Convert to ERAClaim object
            era_claim = self._parse_era_claim(era_data)
            
            # Check for underpayment
            flag = await self._detect_underpayment(era_claim)
            
            if flag:
                detected.append(flag)
                self.flagged_underpayments.append(flag)
                
                # Store to database if available
                if self.db:
                    await self._store_underpayment(flag)
        
        return detected
    
    def _parse_era_claim(self, era_data: Dict[str, Any]) -> ERAClaim:
        """Parse ERA data into ERAClaim object"""
        return ERAClaim(
            claim_id=era_data.get("claim_id", "unknown"),
            patient_id=era_data.get("patient_id", "unknown"),
            procedure_code=era_data.get("procedure_code", ""),
            modifier=era_data.get("modifier"),
            place_of_service=era_data.get("place_of_service", "11"),
            billed_amount=Decimal(str(era_data.get("billed_amount", 0))),
            paid_amount=Decimal(str(era_data.get("paid_amount", 0))),
            allowed_amount=Decimal(str(era_data.get("allowed_amount", 0))),
            denial_code=era_data.get("denial_code"),
            denial_reason=era_data.get("denial_reason"),
            payer_id=era_data.get("payer_id", "unknown"),
            payment_date=datetime.fromisoformat(era_data.get("payment_date")) if era_data.get("payment_date") else datetime.utcnow(),
            service_date=datetime.fromisoformat(era_data.get("service_date")) if era_data.get("service_date") else datetime.utcnow()
        )
    
    async def _detect_underpayment(
        self,
        era_claim: ERAClaim
    ) -> Optional[UnderpaymentFlag]:
        """Detect if claim was underpaid"""
        
        # Get contracted rate
        contracted_rate = self.contract_engine.get_contracted_rate(
            payer_id=era_claim.payer_id,
            procedure_code=era_claim.procedure_code,
            modifier=era_claim.modifier,
            place_of_service=era_claim.place_of_service
        )
        
        if not contracted_rate:
            # No contract term found, can't determine underpayment
            return None
        
        # Calculate expected amount
        expected_amount = contracted_rate
        
        # Check if actually paid less than expected
        if era_claim.paid_amount >= expected_amount * Decimal("0.98"):
            # Within 2% tolerance, not underpaid
            return None
        
        # Calculate underpayment amount
        underpayment_amount = expected_amount - era_claim.paid_amount
        
        if underpayment_amount <= 0:
            return None
        
        # Determine severity
        severity = self._calculate_severity(underpayment_amount)
        
        # Get recovery deadline
        recovery_deadline = self._calculate_recovery_deadline(era_claim)
        
        # Determine if eligible for auto-recovery
        auto_eligible = self._determine_auto_eligibility(
            era_claim, underpayment_amount, severity
        )
        
        # Create flag
        flag = UnderpaymentFlag(
            flag_id=f"UNDERPAY-{era_claim.claim_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            era_claim=era_claim,
            contract_term=ContractTerm(
                term_type=ContractTermType.RATE_SCHEDULE,
                procedure_code=era_claim.procedure_code,
                modifier=era_claim.modifier,
                place_of_service=era_claim.place_of_service,
                contracted_rate=contracted_rate,
                payer_id=era_claim.payer_id,
                effective_date=datetime.utcnow(),
                expiration_date=None,
                special_conditions=[],
                raw_text="",
                confidence=0.85
            ),
            expected_amount=expected_amount,
            actual_amount=era_claim.paid_amount,
            underpayment_amount=underpayment_amount,
            severity=severity,
            recovery_deadline=recovery_deadline,
            dispute_window_days=30,
            auto_recovery_eligible=auto_eligible
        )
        
        return flag
    
    def _calculate_severity(self, underpayment_amount: Decimal) -> UnderpaymentSeverity:
        """Calculate severity level of underpayment"""
        amount = float(underpayment_amount)
        
        if amount < 50:
            return UnderpaymentSeverity.LOW
        elif amount < 500:
            return UnderpaymentSeverity.MEDIUM
        elif amount < 2000:
            return UnderpaymentSeverity.HIGH
        else:
            return UnderpaymentSeverity.CRITICAL
    
    def _calculate_recovery_deadline(
        self,
        era_claim: ERAClaim
    ) -> datetime:
        """Calculate deadline for recovery action"""
        # Default: 30 days from payment
        return era_claim.payment_date + timedelta(days=30)
    
    def _determine_auto_eligibility(
        self,
        era_claim: ERAClaim,
        underpayment_amount: Decimal,
        severity: UnderpaymentSeverity
    ) -> bool:
        """Determine if underpayment is eligible for automatic recovery"""
        # Auto-recover if:
        # 1. High or Critical severity
        # 2. Clear underpayment (not denied, just underpaid)
        # 3. No denial code present
        
        if severity in [UnderpaymentSeverity.HIGH, UnderpaymentSeverity.CRITICAL]:
            if not era_claim.denial_code:
                return True
        
        return False
    
    async def _store_underpayment(self, flag: UnderpaymentFlag):
        """Store underpayment flag to database"""
        if not self.db:
            return
        
        doc = {
            "_id": flag.flag_id,
            "claim_id": flag.era_claim.claim_id,
            "payer_id": flag.era_claim.payer_id,
            "procedure_code": flag.era_claim.procedure_code,
            "expected_amount": str(flag.expected_amount),
            "actual_amount": str(flag.actual_amount),
            "underpayment_amount": str(flag.underpayment_amount),
            "severity": flag.severity.value,
            "recovery_deadline": flag.recovery_deadline,
            "auto_recovery_eligible": flag.auto_recovery_eligible,
            "recovery_status": flag.recovery_status,
            "created_at": datetime.utcnow()
        }
        
        await self.db.underpayment_flags.insert_one(doc)
    
    async def initiate_recovery(
        self,
        flag_id: str,
        recovery_method: str = "auto"
    ) -> Dict[str, Any]:
        """
        Initiate recovery process for underpayment
        """
        # Find flag
        flag = None
        for f in self.flagged_underpayments:
            if f.flag_id == flag_id:
                flag = f
                break
        
        if not flag:
            return {"error": "Flag not found"}
        
        if recovery_method == "auto" and flag.auto_recovery_eligible:
            # Auto-initiate contractual dispute
            result = await self._initiate_contractual_dispute(flag)
            flag.recovery_status = "dispute_initiated"
            flag.dispute_initiated = True
            return result
        else:
            # Route to recovery queue for manual review
            flag.recovery_status = "manual_review_queue"
            return {
                "flag_id": flag_id,
                "status": "routed_to_queue",
                "queue": "underpayment_recovery",
                "priority": flag.severity.value
            }
    
    async def _initiate_contractual_dispute(
        self,
        flag: UnderpaymentFlag
    ) -> Dict[str, Any]:
        """Initiate contractual dispute with payer"""
        # In production, this would:
        # 1. Generate dispute letter citing contract terms
        # 2. Submit via payer portal or EDI
        # 3. Track dispute status
        
        return {
            "flag_id": flag.flag_id,
            "status": "dispute_initiated",
            "dispute_type": "contractual_underpayment",
            "expected_amount": str(flag.expected_amount),
            "actual_amount": str(flag.actual_amount),
            "underpayment_amount": str(flag.underpayment_amount),
            "contract_reference": f"Rate schedule: {flag.contract_term.procedure_code}",
            "submitted_at": datetime.utcnow().isoformat(),
            "expected_resolution_days": 45
        }


class RecoveryQueueManager:
    """
    Manages recovery queues for underpayments
    """
    
    def __init__(self, db=None):
        self.db = db
        self.queues = {
            "critical": [],
            "high": [],
            "medium": [],
            "low": []
        }
    
    def route_to_queue(self, flag: UnderpaymentFlag):
        """Route underpayment to appropriate queue"""
        queue_name = flag.severity.value
        self.queues[queue_name].append(flag)
    
    def get_queue_stats(self) -> Dict[str, Any]:
        """Get statistics for all queues"""
        return {
            "critical": {
                "count": len(self.queues["critical"]),
                "total_value": sum(float(f.underpayment_amount) for f in self.queues["critical"])
            },
            "high": {
                "count": len(self.queues["high"]),
                "total_value": sum(float(f.underpayment_amount) for f in self.queues["high"])
            },
            "medium": {
                "count": len(self.queues["medium"]),
                "total_value": sum(float(f.underpayment_amount) for f in self.queues["medium"])
            },
            "low": {
                "count": len(self.queues["low"]),
                "total_value": sum(float(f.underpayment_amount) for f in self.queues["low"])
            }
        }


# Global instances
contract_ingestion_engine = ContractIngestionEngine()
underpayment_detection_engine = UnderpaymentDetectionEngine(contract_ingestion_engine)
recovery_queue_manager = RecoveryQueueManager()
