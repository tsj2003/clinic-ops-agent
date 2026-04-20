"""
Pharmacy & Specialty DME Automation Expansion
Specialized workflows for PBM, formulary management, and DME fulfillment
"""

import os
import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import aiohttp


class FormularyStatus(str, Enum):
    """Drug formulary status"""
    COVERED = "covered"
    NON_FORMULARY = "non_formulary"
    PRIOR_AUTH_REQUIRED = "prior_auth_required"
    STEP_THERAPY_REQUIRED = "step_therapy_required"
    NOT_COVERED = "not_covered"
    LIMITED_DISTRIBUTION = "limited_distribution"


class DMEStatus(str, Enum):
    """DME order status"""
    PENDING = "pending"
    PA_REQUIRED = "pa_required"
    PA_SUBMITTED = "pa_submitted"
    PA_APPROVED = "pa_approved"
    PA_DENIED = "pa_denied"
    DISPENSED = "dispensed"
    DELIVERED = "delivered"


@dataclass
class FormularyDrug:
    """Drug formulary information"""
    ndc_code: str
    drug_name: str
    generic_name: str
    brand_name: Optional[str]
    formulary_status: FormularyStatus
    tier: int  # 1-5, tier 1 = lowest cost
    quantity_limits: Optional[Dict]
    age_limits: Optional[Dict]
    step_therapy_drugs: List[str]
    alternatives: List[str]
    patient_pay_amount: float
    plan_pay_amount: float


@dataclass
class DMEOrder:
    """Durable Medical Equipment order"""
    order_id: str
    patient_id: str
    provider_npi: str
    hcpcs_code: str  # HCPCS Level II code
    description: str
    quantity: int
    rental_vs_purchase: str  # "rental" or "purchase"
    length_of_need_months: int
    dx_codes: List[str]
    modifiers: List[str]
    documentation_urls: List[str]
    status: DMEStatus
    created_at: datetime
    pa_submitted_at: Optional[datetime]
    pa_response_at: Optional[datetime]


@dataclass
class PharmacyClaim:
    """Pharmacy benefit claim"""
    claim_id: str
    patient_id: str
    ndc_code: str
    drug_name: str
    quantity: float
    days_supply: int
    pharmacy_npi: str
    prescribing_provider_npi: str
    dx_codes: List[str]
    formulary_status: FormularyStatus
    rejected: bool
    rejection_code: Optional[str]
    rejection_reason: Optional[str]
    prior_auth_required: bool
    submitted_at: datetime


class PBMWorkflowEngine:
    """
    Pharmacy Benefit Management workflow automation
    """
    
    def __init__(
        self,
        surescripts_enabled: bool = True,
        covermymeds_enabled: bool = True
    ):
        self.surescripts_enabled = surescripts_enabled
        self.covermymeds_enabled = covermymeds_enabled
        self.formulary_cache: Dict[str, Dict[str, FormularyDrug]] = {}
    
    async def check_formulary(
        self,
        pbm_id: str,
        plan_id: str,
        ndc_code: str
    ) -> Optional[FormularyDrug]:
        """
        Check drug formulary status with PBM
        """
        cache_key = f"{pbm_id}:{plan_id}"
        
        # Check cache first
        if cache_key in self.formulary_cache:
            if ndc_code in self.formulary_cache[cache_key]:
                return self.formulary_cache[cache_key][ndc_code]
        
        # In production, would query PBM API
        # For now, return mock data
        formulary_drug = self._generate_mock_formulary_drug(ndc_code)
        
        # Cache result
        if cache_key not in self.formulary_cache:
            self.formulary_cache[cache_key] = {}
        self.formulary_cache[cache_key][ndc_code] = formulary_drug
        
        return formulary_drug
    
    def _generate_mock_formulary_drug(self, ndc_code: str) -> FormularyDrug:
        """Generate mock formulary data for testing"""
        # Parse NDC to determine drug (simplified)
        last_2 = ndc_code[-2:] if len(ndc_code) >= 2 else "00"
        
        if last_2 in ["01", "02", "03"]:
            return FormularyDrug(
                ndc_code=ndc_code,
                drug_name="Metformin 500mg",
                generic_name="Metformin Hydrochloride",
                brand_name=None,
                formulary_status=FormularyStatus.COVERED,
                tier=1,
                quantity_limits=None,
                age_limits=None,
                step_therapy_drugs=[],
                alternatives=[],
                patient_pay_amount=10.00,
                plan_pay_amount=25.00
            )
        elif last_2 in ["10", "11", "12"]:
            return FormularyDrug(
                ndc_code=ndc_code,
                drug_name="Insulin Glargine",
                generic_name="Insulin Glargine",
                brand_name="Lantus",
                formulary_status=FormularyStatus.PRIOR_AUTH_REQUIRED,
                tier=2,
                quantity_limits={"max_quantity": 300, "days_supply": 30},
                age_limits=None,
                step_therapy_drugs=["NPH Insulin", "Insulin Detemir"],
                alternatives=["Basaglar", "Semglee"],
                patient_pay_amount=45.00,
                plan_pay_amount=320.00
            )
        else:
            return FormularyDrug(
                ndc_code=ndc_code,
                drug_name="Specialty Drug",
                generic_name="Generic Specialty",
                brand_name="Brand Specialty",
                formulary_status=FormularyStatus.LIMITED_DISTRIBUTION,
                tier=5,
                quantity_limits={"max_quantity": 30, "days_supply": 30},
                age_limits={"min_age": 18},
                step_therapy_drugs=[],
                alternatives=[],
                patient_pay_amount=250.00,
                plan_pay_amount=5000.00
            )
    
    async def submit_pharmacy_claim(
        self,
        claim: PharmacyClaim
    ) -> Dict[str, Any]:
        """
        Submit pharmacy claim to PBM
        """
        # Check formulary first
        formulary_drug = await self.check_formulary(
            "pbm-express-scripts",
            "plan-standard",
            claim.ndc_code
        )
        
        if not formulary_drug:
            return {
                "success": False,
                "rejected": True,
                "rejection_code": "75",
                "rejection_reason": "NDC not found in formulary",
                "claim_id": claim.claim_id
            }
        
        # Check formulary status
        if formulary_drug.formulary_status == FormularyStatus.NOT_COVERED:
            return {
                "success": False,
                "rejected": True,
                "rejection_code": "76",
                "rejection_reason": "Drug not covered",
                "alternative_drugs": formulary_drug.alternatives,
                "claim_id": claim.claim_id
            }
        
        if formulary_drug.formulary_status == FormularyStatus.PRIOR_AUTH_REQUIRED:
            # Initiate prior auth workflow
            pa_result = await self._initiate_pharmacy_pa(claim, formulary_drug)
            
            return {
                "success": False,
                "rejected": True,
                "rejection_code": "79",
                "rejection_reason": "Prior authorization required",
                "prior_auth_initiated": True,
                "pa_reference": pa_result.get("pa_reference"),
                "claim_id": claim.claim_id
            }
        
        if formulary_drug.formulary_status == FormularyStatus.STEP_THERAPY_REQUIRED:
            return {
                "success": False,
                "rejected": True,
                "rejection_code": "76",
                "rejection_reason": "Step therapy required",
                "required_step_drugs": formulary_drug.step_therapy_drugs,
                "claim_id": claim.claim_id
            }
        
        # Claim approved (simulated)
        return {
            "success": True,
            "rejected": False,
            "claim_id": claim.claim_id,
            "patient_pay": formulary_drug.patient_pay_amount,
            "plan_pay": formulary_drug.plan_pay_amount,
            "formulary_tier": formulary_drug.tier,
            "transaction_id": f"PBM-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{claim.claim_id[-4:]}"
        }
    
    async def _initiate_pharmacy_pa(
        self,
        claim: PharmacyClaim,
        formulary_drug: FormularyDrug
    ) -> Dict[str, Any]:
        """Initiate prior authorization for pharmacy claim"""
        # In production, would:
        # 1. Submit to CoverMyMeds or similar
        # 2. Include clinical documentation
        # 3. Track PA status
        
        pa_reference = f"PA-PHARM-{claim.claim_id}"
        
        return {
            "pa_reference": pa_reference,
            "status": "submitted",
            "submitted_at": datetime.utcnow().isoformat(),
            "expected_response_hours": 48,
            "required_documents": [
                "Prescription",
                "Diagnosis codes",
                "Clinical notes supporting medical necessity"
            ]
        }
    
    async def analyze_formulary_changes(
        self,
        pbm_id: str,
        plan_id: str,
        effective_date: datetime
    ) -> Dict[str, Any]:
        """
        Analyze formulary changes and identify impacted members
        """
        # In production, would:
        # 1. Compare current vs new formulary
        # 2. Identify drugs moving to non-covered or higher tiers
        # 3. Find members currently taking those drugs
        # 4. Generate impact report
        
        mock_changes = [
            {
                "ndc_code": "12345-678-90",
                "drug_name": "Omeprazole 20mg",
                "change_type": "tier_increase",
                "from_tier": 1,
                "to_tier": 2,
                "estimated_impacted_members": 150
            },
            {
                "ndc_code": "98765-432-10",
                "drug_name": "Specialty Biologic",
                "change_type": "prior_auth_added",
                "from_status": "covered",
                "to_status": "prior_auth_required",
                "estimated_impacted_members": 25
            }
        ]
        
        total_impacted = sum(c["estimated_impacted_members"] for c in mock_changes)
        
        return {
            "pbm_id": pbm_id,
            "plan_id": plan_id,
            "effective_date": effective_date.isoformat(),
            "total_formulary_changes": len(mock_changes),
            "total_impacted_members": total_impacted,
            "changes": mock_changes,
            "recommendations": [
                "Notify impacted members 30 days in advance",
                "Provide alternative drug options",
                "Initiate prior auth process for high-risk members"
            ]
        }


class DMEWorkflowEngine:
    """
    Durable Medical Equipment workflow automation
    """
    
    def __init__(self, db=None):
        self.db = db
        self.orders: Dict[str, DMEOrder] = {}
    
    async def create_dme_order(
        self,
        patient_id: str,
        provider_npi: str,
        hcpcs_code: str,
        description: str,
        quantity: int,
        rental_vs_purchase: str,
        length_of_need_months: int,
        dx_codes: List[str],
        modifiers: List[str],
        documentation: List[str]
    ) -> DMEOrder:
        """
        Create new DME order
        """
        order_id = f"DME-{patient_id[:6]}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        order = DMEOrder(
            order_id=order_id,
            patient_id=patient_id,
            provider_npi=provider_npi,
            hcpcs_code=hcpcs_code,
            description=description,
            quantity=quantity,
            rental_vs_purchase=rental_vs_purchase,
            length_of_need_months=length_of_need_months,
            dx_codes=dx_codes,
            modifiers=modifiers,
            documentation_urls=documentation,
            status=DMEStatus.PENDING,
            created_at=datetime.utcnow(),
            pa_submitted_at=None,
            pa_response_at=None
        )
        
        self.orders[order_id] = order
        
        # Check if PA required
        pa_required = await self._check_pa_requirement(hcpcs_code, modifiers)
        
        if pa_required:
            order.status = DMEStatus.PA_REQUIRED
            
            # Auto-submit PA
            await self._submit_dme_pa(order)
        else:
            # Route to dispensing
            order.status = DMEStatus.DISPENSED
        
        # Store to database
        if self.db:
            await self._store_order(order)
        
        return order
    
    async def _check_pa_requirement(
        self,
        hcpcs_code: str,
        modifiers: List[str]
    ) -> bool:
        """Check if prior auth required for DME item"""
        # High-cost items typically require PA
        high_cost_codes = ["E1399", "K0001", "K0005", "K0009"]  # Power wheelchairs, etc.
        
        if hcpcs_code in high_cost_codes:
            return True
        
        # Certain modifiers trigger PA
        pa_modifiers = ["RR"]  # Rental
        
        if any(m in modifiers for m in pa_modifiers):
            return True
        
        return False
    
    async def _submit_dme_pa(self, order: DMEOrder):
        """Submit prior auth for DME order"""
        order.status = DMEStatus.PA_SUBMITTED
        order.pa_submitted_at = datetime.utcnow()
        
        # In production, would:
        # 1. Submit to payer portal
        # 2. Include documentation
        # 3. Track response
        
        # Simulate async response
        await asyncio.sleep(0.1)
        
        # Mock approval for most orders
        order.status = DMEStatus.PA_APPROVED
        order.pa_response_at = datetime.utcnow()
    
    async def _store_order(self, order: DMEOrder):
        """Store DME order to database"""
        if not self.db:
            return
        
        doc = {
            "_id": order.order_id,
            "patient_id": order.patient_id,
            "provider_npi": order.provider_npi,
            "hcpcs_code": order.hcpcs_code,
            "description": order.description,
            "quantity": order.quantity,
            "rental_vs_purchase": order.rental_vs_purchase,
            "length_of_need_months": order.length_of_need_months,
            "dx_codes": order.dx_codes,
            "modifiers": order.modifiers,
            "documentation_urls": order.documentation_urls,
            "status": order.status.value,
            "created_at": order.created_at,
            "pa_submitted_at": order.pa_submitted_at,
            "pa_response_at": order.pa_response_at
        }
        
        await self.db.dme_orders.insert_one(doc)
    
    async def get_order_status(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get status of DME order"""
        if order_id not in self.orders:
            return None
        
        order = self.orders[order_id]
        
        return {
            "order_id": order_id,
            "status": order.status.value,
            "hcpcs_code": order.hcpcs_code,
            "description": order.description,
            "pa_required": order.status in [DMEStatus.PA_REQUIRED, DMEStatus.PA_SUBMITTED],
            "pa_submitted_at": order.pa_submitted_at.isoformat() if order.pa_submitted_at else None,
            "pa_response_at": order.pa_response_at.isoformat() if order.pa_response_at else None,
            "created_at": order.created_at.isoformat()
        }
    
    async def integrate_with_dispensing_network(
        self,
        order_id: str,
        dispensing_network: str  # " cardinal", "mckesson", "mwi"
    ) -> Dict[str, Any]:
        """
        Integrate with DME dispensing network via HL7/FHIR
        """
        if order_id not in self.orders:
            return {"error": "Order not found"}
        
        order = self.orders[order_id]
        
        # In production, would:
        # 1. Convert order to HL7/FHIR format
        # 2. Submit to dispensing network API
        # 3. Track fulfillment
        
        # Mock successful integration
        return {
            "order_id": order_id,
            "dispensing_network": dispensing_network,
            "integration_status": "connected",
            "fhir_resources_created": [
                {
                    "resourceType": "SupplyDelivery",
                    "id": f"SD-{order_id}",
                    "status": "preparation"
                }
            ],
            "estimated_fulfillment_days": 3
        }


class SpecialtyPharmacyIntegration:
    """
    Integration with specialty pharmacy networks
    """
    
    def __init__(self):
        self.networks = {
            " CVS_Specialty": "https://api.cvspecialty.com/fhir",
            "Accredo": "https://api.accredo.com/fhir",
            "BioPlus": "https://api.bioplus.com/fhir"
        }
    
    async def route_to_specialty_pharmacy(
        self,
        patient_id: str,
        drug_ndc: str,
        network_preference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Route specialty medication to appropriate pharmacy
        """
        # Determine best pharmacy based on drug and network
        if network_preference and network_preference in self.networks:
            selected_network = network_preference
        else:
            # Default selection logic
            selected_network = "Accredo"
        
        # Create FHIR MedicationRequest
        medication_request = {
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {
                "coding": [{
                    "system": "http://hl7.org/fhir/sid/ndc",
                    "code": drug_ndc
                }]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "dispenseRequest": {
                "quantity": {"value": 30, "unit": "tablets"},
                "expectedSupplyDuration": {"value": 30, "unit": "days"}
            }
        }
        
        return {
            "routing_successful": True,
            "selected_pharmacy": selected_network,
            "medication_request": medication_request,
            "estimated_delivery_days": 2,
            "patient_counseling_scheduled": True
        }


# Global instances
pbm_workflow_engine = PBMWorkflowEngine()
dme_workflow_engine = DMEWorkflowEngine()
specialty_pharmacy_integration = SpecialtyPharmacyIntegration()
