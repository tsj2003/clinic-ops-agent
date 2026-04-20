"""
Change Healthcare (Optum) API Integration Module
Supports claims, eligibility, ERA, prior auth, and payment solutions
"""

import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
import json
import hashlib
import hmac
import base64


class ChangeHealthcareConfig(BaseModel):
    """Change Healthcare API configuration"""
    base_url: str = Field(default="https://api.changehealthcare.com")
    client_id: str = Field(..., description="OAuth client ID")
    client_secret: str = Field(..., description="OAuth client secret")
    api_key: str = Field(..., description="API key for product access")
    submitter_id: str = Field(..., description="Submitter identifier")
    environment: str = Field(default="production")  # sandbox, production
    timeout: int = Field(default=120)
    
    class Config:
        env_prefix = "CHANGE_HC_"


@dataclass
class ChangeHCToken:
    """Change Healthcare OAuth token"""
    access_token: str
    expires_at: datetime
    token_type: str = "Bearer"
    
    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at


class ClaimsProduct(str, Enum):
    """Change Healthcare claims products"""
    PROFESSIONAL = "professionalClaims"
    INSTITUTIONAL = "institutionalClaims"
    DENTAL = "dentalClaims"
    VISION = "visionClaims"
    WORKERS_COMP = "workersCompClaims"


class ProfessionalClaimCHC(BaseModel):
    """Professional claim for Change Healthcare"""
    claim_id: str
    submitter_id: str
    trading_partner_service_id: str  # Payer ID
    
    billing_provider: Dict[str, Any]  # NPI, taxonomy, address, contact
    pay_to_address: Optional[Dict] = None
    subscriber: Dict[str, Any]  # Patient info
    dependent: Optional[Dict] = None
    
    claim_code_information: Optional[Dict] = None
    claim_date_information: Dict[str, str]  # statement_dates, etc.
    claim_supplemental_information: Optional[Dict] = None
    
    service_lines: List[Dict[str, Any]]
    # procedure_code, modifiers, diagnosis_codes, service_dates, charge_amount, units
    
    diagnosis_codes: List[Dict[str, str]]  # icd10 codes
    
    prior_authorization_number: Optional[str] = None
    
    # Financial
    claim_amount: str  # Total charge amount
    patient_responsibility_amount: Optional[str] = None
    
    # Providers
    rendering_provider: Optional[Dict] = None
    referring_provider: Optional[Dict] = None
    billing_pay_to_provider: Optional[Dict] = None
    assistant_surgeon: Optional[Dict] = None
    other_operating_physician: Optional[Dict] = None
    service_facility_location: Optional[Dict] = None
    ambulance_pick_up_location: Optional[Dict] = None
    ambulance_drop_off_location: Optional[Dict] = None


class PriorAuthRequest(BaseModel):
    """Prior authorization request"""
    request_id: str
    patient_id: str
    subscriber_first_name: str
    subscriber_last_name: str
    subscriber_dob: str
    subscriber_member_id: str
    
    provider_npi: str
    provider_taxonomy: Optional[str] = None
    provider_address: Dict[str, str]
    
    diagnosis_codes: List[str]
    procedure_codes: List[str]
    
    service_start_date: str
    service_end_date: str
    
    request_type: str  # Initial, Extension, Revision
    request_category: str  # Urgent, Expedited, Standard
    
    clinical_reason: str
    clinical_documentation: Optional[List[Dict]] = None  # Attachment refs
    
    # Service details
    service_type: str
    place_of_service: str
    estimated_amount: float


class PriorAuthResponse(BaseModel):
    """Prior authorization response"""
    request_id: str
    response_id: str
    response_date: datetime
    
    status: str  # Approved, Denied, Pended, Cancelled
    auth_number: Optional[str] = None
    
    approved_services: List[Dict] = Field(default_factory=list)
    denied_services: List[Dict] = Field(default_factory=list)
    
    effective_date: Optional[str] = None
    expiration_date: Optional[str] = None
    
    pended_reason: Optional[str] = None
    denial_reason: Optional[str] = None
    denial_reason_code: Optional[str] = None
    
    next_steps: Optional[str] = None


class PaymentStatus(str, Enum):
    """Payment status values"""
    PENDING = "Pending"
    PROCESSING = "Processing"
    COMPLETED = "Completed"
    FAILED = "Failed"
    REFUNDED = "Refunded"


class PaymentRequest(BaseModel):
    """Payment request for patient collections"""
    payment_id: str
    patient_id: str
    patient_first_name: str
    patient_last_name: str
    
    amount: float
    currency: str = "USD"
    
    payment_method: str  # credit_card, debit_card, ach, check
    card_details: Optional[Dict] = None  # Tokenized card info
    bank_details: Optional[Dict] = None  # For ACH
    
    # What is being paid
    claim_ids: List[str] = Field(default_factory=list)
    statement_id: Optional[str] = None
    
    # Meta
    description: str
    receipt_email: str
    metadata: Optional[Dict] = None


class ChangeHealthcareClient:
    """
    Change Healthcare API Integration Client
    
    Supports:
    - Claims submission (all types)
    - Eligibility verification
    - ERA/EFT processing
    - Prior authorization
    - Patient payments/collections
    - Attachment submission
    - Provider directory
    """
    
    def __init__(self, config: ChangeHealthcareConfig):
        self.config = config
        self.token: Optional[ChangeHCToken] = None
        self.session: Optional[aiohttp.ClientSession] = None
        self._lock = asyncio.Lock()
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.config.timeout),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def _authenticate(self) -> ChangeHCToken:
        """OAuth 2.0 authentication"""
        auth_url = f"{self.config.base_url}/apip/auth/v2/token"
        
        payload = {
            "grant_type": "client_credentials",
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret
        }
        
        async with self.session.post(auth_url, data=payload) as response:
            if response.status != 200:
                error = await response.text()
                raise ChangeHCAuthError(f"Authentication failed: {response.status} - {error}")
            
            data = await response.json()
            
            expires_in = data.get("expires_in", 3600)
            return ChangeHCToken(
                access_token=data["access_token"],
                expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
                token_type=data.get("token_type", "Bearer")
            )
    
    async def _ensure_token(self):
        """Ensure valid OAuth token"""
        if self.token is None or self.token.is_expired:
            async with self._lock:
                if self.token is None or self.token.is_expired:
                    self.token = await self._authenticate()
    
    async def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        json_data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make authenticated API request"""
        await self._ensure_token()
        
        url = f"{self.config.base_url}{endpoint}"
        headers = {
            "Authorization": f"{self.token.token_type} {self.token.access_token}",
            "X-Api-Key": self.config.api_key
        }
        
        async with self.session.request(
            method, url, headers=headers, params=params, json=json_data
        ) as response:
            if response.status == 401:
                self.token = await self._authenticate()
                headers["Authorization"] = f"{self.token.token_type} {self.token.access_token}"
                async with self.session.request(
                    method, url, headers=headers, params=params, json=json_data
                ) as retry_response:
                    retry_response.raise_for_status()
                    return await retry_response.json()
            
            response.raise_for_status()
            return await response.json()
    
    # ==================== CLAIMS SUBMISSION ====================
    
    async def submit_professional_claim(
        self,
        claim: ProfessionalClaimCHC,
        validate_only: bool = False,
        synchronous: bool = False
    ) -> Dict[str, Any]:
        """
        Submit professional claim (837P)
        
        Args:
            claim: Professional claim data
            validate_only: If True, only validate without submitting
            synchronous: If True, wait for payer response
            
        Returns:
            Submission response with control number
        """
        endpoint = "/medicalnetwork/professionalclaims/v3/submission"
        
        payload = {
            "controlNumber": claim.claim_id,
            "submitter": {
                "organizationName": claim.submitter_id,
                "contactInformation": {
                    "name": "Billing Department",
                    "phoneNumber": "0000000000"
                }
            },
            "tradingPartnerServiceId": claim.trading_partner_service_id,
            "tradingPartnerName": "Unknown",
            "billingProvider": claim.billing_provider,
            "subscriber": claim.subscriber,
            "claimInformation": {
                "claimFilingCode": "CI",
                "patientControlNumber": claim.claim_id,
                "claimChargeAmount": claim.claim_amount,
                "placeOfServiceCode": claim.billing_provider.get("address", {}).get("state", ""),
                "claimFrequencyCode": "1",
                "signatureIndicator": "Y",
                "planParticipationCode": "A",
                "benefitsAssignmentCertificationIndicator": "Y",
                "releaseInformationCode": "Y",
                "claimDateInformation": claim.claim_date_information,
                "claimCodeInformation": claim.claim_code_information or {
                    "admittingDiagnosisTypeCode": "BJ",
                    "admittingDiagnosisCode": claim.diagnosis_codes[0].get("icd10") if claim.diagnosis_codes else ""
                },
                "serviceLines": [
                    {
                        "serviceDate": line.get("service_dates", ""),
                        "professionalService": {
                            "procedureIdentifier": "HC",
                            "procedureCode": line.get("procedure_code"),
                            "procedureModifiers": line.get("modifiers", []),
                            "lineItemChargeAmount": line.get("charge_amount"),
                            "measurementUnit": line.get("unit", "UN"),
                            "serviceUnitCount": str(line.get("units", 1)),
                            "diagnosisPointer": line.get("diagnosis_codes", ["1"])
                        }
                    }
                    for line in claim.service_lines
                ],
                "diagnosisRelatedGroupInformation": {
                    "diagnosisRelatedGroupCode": ""
                },
                "diagnoses": [
                    {
                        "diagnosisTypeCode": "BK" if i == 0 else "BF",
                        "diagnosisCode": d.get("icd10", "")
                    }
                    for i, d in enumerate(claim.diagnosis_codes)
                ]
            }
        }
        
        if claim.dependent:
            payload["dependent"] = claim.dependent
        
        if claim.prior_authorization_number:
            payload["claimInformation"]["priorAuthorizationNumber"] = claim.prior_authorization_number
        
        if claim.rendering_provider:
            payload["renderingProvider"] = claim.rendering_provider
        
        if claim.referring_provider:
            payload["referringProvider"] = claim.referring_provider
        
        if claim.patient_responsibility_amount:
            payload["claimInformation"]["patientResponsibilityAmount"] = claim.patient_responsibility_amount
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    async def check_claim_status(
        self,
        control_number: str,
        trading_partner_id: str
    ) -> Dict[str, Any]:
        """Check claim status (276/277)"""
        endpoint = "/medicalnetwork/professionalclaims/v1/status"
        
        payload = {
            "controlNumber": control_number,
            "tradingPartnerServiceId": trading_partner_id
        }
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    # ==================== PRIOR AUTHORIZATION ====================
    
    async def submit_prior_auth(
        self,
        request: PriorAuthRequest
    ) -> PriorAuthResponse:
        """
        Submit prior authorization request
        
        Supports professional and institutional prior auth
        """
        endpoint = "/medicalnetwork/priorauth/v1/request"
        
        payload = {
            "requestMetadata": {
                "senderRequestId": request.request_id,
                "senderRequestTimestamp": datetime.utcnow().isoformat()
            },
            "patient": {
                "memberId": request.subscriber_member_id,
                "firstName": request.subscriber_first_name,
                "lastName": request.subscriber_last_name,
                "dateOfBirth": request.subscriber_dob
            },
            "requestingProvider": {
                "npi": request.provider_npi,
                "firstName": "Provider",
                "lastName": "Name",
                "address": request.provider_address
            },
            "servicingProvider": {
                "npi": request.provider_npi
            },
            "subscriber": {
                "firstName": request.subscriber_first_name,
                "lastName": request.subscriber_last_name,
                "dateOfBirth": request.subscriber_dob,
                "memberId": request.subscriber_member_id
            },
            "services": [
                {
                    "serviceType": request.service_type,
                    "procedureCode": code,
                    "diagnosisCode": request.diagnosis_codes[0] if request.diagnosis_codes else "",
                    "serviceStartDate": request.service_start_date,
                    "serviceEndDate": request.service_end_date,
                    "estimatedCost": str(request.estimated_amount)
                }
                for code in request.procedure_codes
            ],
            "diagnoses": [{"code": code} for code in request.diagnosis_codes],
            "requestCategory": {
                "code": request.request_category,
                "value": request.request_category
            },
            "requestType": request.request_type,
            "purpose": "Plan required prior authorization",
            "urgency": request.request_category,
            "supportingInfo": [
                {
                    "category": "clinicalReason",
                    "valueString": request.clinical_reason
                }
            ]
        }
        
        if request.clinical_documentation:
            for doc in request.clinical_documentation:
                payload["supportingInfo"].append({
                    "category": "attachment",
                    "valueAttachment": doc
                })
        
        data = await self._make_request("POST", endpoint, json_data=payload)
        
        return PriorAuthResponse(
            request_id=request.request_id,
            response_id=data.get("responseMetadata", {}).get("receiverResponseId", ""),
            response_date=datetime.utcnow(),
            status=data.get("decision", "Pended"),
            auth_number=data.get("authNumber"),
            approved_services=[],
            denied_services=[],
            effective_date=data.get("effectiveDate"),
            expiration_date=data.get("expirationDate"),
            pended_reason=data.get("pendedReason"),
            denial_reason=data.get("denialReason"),
            denial_reason_code=data.get("denialReasonCode"),
            next_steps=data.get("nextSteps")
        )
    
    async def check_prior_auth_status(
        self,
        request_id: str
    ) -> PriorAuthResponse:
        """Check prior auth status"""
        endpoint = f"/medicalnetwork/priorauth/v1/status/{request_id}"
        
        data = await self._make_request("GET", endpoint)
        
        return PriorAuthResponse(
            request_id=request_id,
            response_id=data.get("responseMetadata", {}).get("receiverResponseId", ""),
            response_date=datetime.utcnow(),
            status=data.get("decision", "Unknown"),
            auth_number=data.get("authNumber"),
            approved_services=[],
            denied_services=[],
            effective_date=data.get("effectiveDate"),
            expiration_date=data.get("expirationDate"),
            pended_reason=data.get("pendedReason"),
            denial_reason=data.get("denialReason"),
            denial_reason_code=data.get("denialReasonCode"),
            next_steps=data.get("nextSteps")
        )
    
    # ==================== ELIGIBILITY ====================
    
    async def verify_eligibility(
        self,
        payer_id: str,
        provider_npi: str,
        subscriber_first_name: str,
        subscriber_last_name: str,
        subscriber_dob: str,
        subscriber_member_id: Optional[str] = None,
        service_type_codes: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Real-time eligibility verification
        
        Returns detailed benefit information including:
        - Coverage status
        - Copay/coinsurance amounts
        - Deductible status
        - Prior auth requirements
        """
        endpoint = "/medicalnetwork/insurance/eligibility/v1"
        
        payload = {
            "controlNumber": f"ELIG{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            "tradingPartnerServiceId": payer_id,
            "provider": {
                "npi": provider_npi,
                "organizationName": "Clinic"
            },
            "subscriber": {
                "firstName": subscriber_first_name,
                "lastName": subscriber_last_name,
                "dateOfBirth": subscriber_dob,
                "memberId": subscriber_member_id
            },
            "dependent": None
        }
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    # ==================== ATTACHMENTS ====================
    
    async def submit_attachment(
        self,
        claim_control_number: str,
        trading_partner_id: str,
        file_data: bytes,
        filename: str,
        mime_type: str,
        attachment_type: str = "CLM_SUPPORT"
    ) -> Dict[str, Any]:
        """
        Submit claim attachment via Change Healthcare
        
        Attachment types:
        - CLM_SUPPORT: Claim supporting documentation
        - COB: Coordination of Benefits
        - MEO: Medical Equipment Orders
        - OTN: Order/Treatment Notification
        """
        # Step 1: Upload file
        upload_result = await self._upload_attachment_file(
            file_data, filename, mime_type
        )
        file_id = upload_result.get("fileId")
        
        # Step 2: Submit attachment metadata
        endpoint = "/attachments/submission/v1"
        
        payload = {
            "controlNumber": f"ATT{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            "tradingPartnerServiceId": trading_partner_id,
            "payerAddress": {
                "address1": "Unknown",
                "city": "Unknown",
                "state": "Unknown",
                "postalCode": "00000"
            },
            "provider": {
                "npi": "1234567890"
            },
            "subscriber": {
                "firstName": "Patient",
                "lastName": "Name"
            },
            "claimReference": {
                "controlNumber": claim_control_number
            },
            "attachmentDetails": [
                {
                    "attachmentType": attachment_type,
                    "fileName": filename,
                    "fileSize": len(file_data),
                    "fileId": file_id,
                    "documentType": mime_type
                }
            ]
        }
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    async def _upload_attachment_file(
        self,
        file_data: bytes,
        filename: str,
        mime_type: str
    ) -> Dict[str, Any]:
        """Upload file for attachment"""
        await self._ensure_token()
        
        url = f"{self.config.base_url}/attachments/submission/v1/upload"
        headers = {
            "Authorization": f"{self.token.token_type} {self.token.access_token}",
            "X-Api-Key": self.config.api_key
        }
        
        data = aiohttp.FormData()
        data.add_field("file", file_data, filename=filename, content_type=mime_type)
        
        async with self.session.post(url, headers=headers, data=data) as response:
            response.raise_for_status()
            return await response.json()
    
    # ==================== PAYMENTS ====================
    
    async def process_patient_payment(
        self,
        payment: PaymentRequest
    ) -> Dict[str, Any]:
        """
        Process patient payment via Change Healthcare
        
        Supports credit cards, debit cards, and ACH
        """
        endpoint = "/payments/patientcollections/v1"
        
        payload = {
            "paymentId": payment.payment_id,
            "patient": {
                "patientId": payment.patient_id,
                "firstName": payment.patient_first_name,
                "lastName": payment.patient_last_name
            },
            "amount": {
                "value": str(payment.amount),
                "currency": payment.currency
            },
            "paymentMethod": payment.payment_method,
            "description": payment.description,
            "receiptEmail": payment.receipt_email
        }
        
        if payment.card_details:
            payload["card"] = payment.card_details
        elif payment.bank_details:
            payload["bankAccount"] = payment.bank_details
        
        if payment.claim_ids:
            payload["claimReferences"] = [{"claimId": cid} for cid in payment.claim_ids]
        
        if payment.metadata:
            payload["metadata"] = payment.metadata
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    async def get_payment_status(
        self,
        payment_id: str
    ) -> Dict[str, Any]:
        """Get payment transaction status"""
        endpoint = f"/payments/patientcollections/v1/{payment_id}"
        return await self._make_request("GET", endpoint)
    
    async def refund_payment(
        self,
        payment_id: str,
        amount: float,
        reason: str
    ) -> Dict[str, Any]:
        """Process payment refund"""
        endpoint = f"/payments/patientcollections/v1/{payment_id}/refund"
        
        payload = {
            "amount": str(amount),
            "reason": reason
        }
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    # ==================== PROVIDER DIRECTORY ====================
    
    async def search_provider_directory(
        self,
        npi: Optional[str] = None,
        last_name: Optional[str] = None,
        first_name: Optional[str] = None,
        state: Optional[str] = None,
        specialty: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Search Change Healthcare provider directory"""
        endpoint = "/providerdirectory/v1/providers"
        
        params = {"limit": limit}
        
        if npi:
            params["npi"] = npi
        if last_name:
            params["lastName"] = last_name
        if first_name:
            params["firstName"] = first_name
        if state:
            params["state"] = state
        if specialty:
            params["specialty"] = specialty
        
        data = await self._make_request("GET", endpoint, params)
        return data.get("providers", [])


class ChangeHCAuthError(Exception):
    """Authentication error with Change Healthcare"""
    pass


class ChangeHCAPIError(Exception):
    """API error from Change Healthcare"""
    pass


# ==================== INTEGRATION ENGINE ====================

class ChangeHCIntegrationEngine:
    """
    Integration engine combining Change Healthcare capabilities
    with Clinic Ops workflows
    """
    
    def __init__(self, chc_client: ChangeHealthcareClient):
        self.client = chc_client
    
    async def submit_claim_with_attachments(
        self,
        claim: ProfessionalClaimCHC,
        attachments: List[Dict[str, Any]]  # List of {file_data, filename, mime_type}
    ) -> Dict[str, Any]:
        """
        Submit claim with supporting documentation
        
        Flow:
        1. Submit claim
        2. Get control number
        3. Upload attachments
        4. Link attachments to claim
        """
        # Step 1: Submit claim
        claim_result = await self.client.submit_professional_claim(claim)
        control_number = claim_result.get("controlNumber")
        
        # Step 2: Upload attachments
        attachment_ids = []
        for attachment in attachments:
            result = await self.client.submit_attachment(
                claim_control_number=control_number,
                trading_partner_id=claim.trading_partner_service_id,
                file_data=attachment["file_data"],
                filename=attachment["filename"],
                mime_type=attachment["mime_type"]
            )
            attachment_ids.append(result.get("attachmentId"))
        
        return {
            "claim_submitted": True,
            "control_number": control_number,
            "attachments_submitted": len(attachment_ids),
            "attachment_ids": attachment_ids,
            "submission_timestamp": datetime.utcnow().isoformat()
        }
    
    async def handle_prior_auth_workflow(
        self,
        request: PriorAuthRequest
    ) -> Dict[str, Any]:
        """
        Complete prior authorization workflow
        
        Handles initial submission, status checks, and response processing
        """
        # Submit PA
        response = await self.client.submit_prior_auth(request)
        
        # If pended, schedule status check
        if response.status == "Pended":
            # In production, schedule async check
            return {
                "status": "Pended",
                "request_id": request.request_id,
                "response_id": response.response_id,
                "pended_reason": response.pended_reason,
                "next_steps": response.next_steps,
                "requires_follow_up": True,
                "follow_up_scheduled": datetime.utcnow() + timedelta(hours=24)
            }
        
        # If approved, extract authorization details
        if response.status == "Approved":
            return {
                "status": "Approved",
                "request_id": request.request_id,
                "response_id": response.response_id,
                "auth_number": response.auth_number,
                "effective_date": response.effective_date,
                "expiration_date": response.expiration_date,
                "approved_services": response.approved_services,
                "ready_for_claim": True
            }
        
        # If denied, capture denial reason for appeal
        if response.status == "Denied":
            return {
                "status": "Denied",
                "request_id": request.request_id,
                "response_id": response.response_id,
                "denial_reason": response.denial_reason,
                "denial_reason_code": response.denial_reason_code,
                "requires_appeal": True,
                "appeal_recommended": True
            }
        
        return {
            "status": response.status,
            "request_id": request.request_id,
            "response_id": response.response_id
        }
