"""
Waystar Clearinghouse Integration Module
Handles electronic claims submission, ERA processing, eligibility verification
"""

import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, BinaryIO, Union
from pydantic import BaseModel, Field
from dataclasses import dataclass
import xml.etree.ElementTree as ET
import json
import base64
from enum import Enum


class WaystarConfig(BaseModel):
    """Waystar API configuration"""
    base_url: str = Field(default="https://api.waystar.com")
    client_id: str = Field(..., description="OAuth client ID")
    client_secret: str = Field(..., description="OAuth client secret")
    submitter_id: str = Field(..., description="Submitter/NPI identifier")
    vendor_name: str = Field(default="ClinicOpsAgent")
    timeout: int = Field(default=120)
    
    class Config:
        env_prefix = "WAYSTAR_"


class ClaimStatus(str, Enum):
    """Claim status values"""
    ACCEPTED = "Accepted"
    REJECTED = "Rejected"
    PENDING = "Pending"
    PENDED = "Pended"
    PAID = "Paid"
    DENIED = "Denied"
    ADJUSTED = "Adjusted"


class EligibilityStatus(str, Enum):
    """Eligibility verification status"""
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    TERMINATED = "Terminated"
    PENDING = "Pending"


@dataclass
class WaystarToken:
    """Waystar OAuth token"""
    access_token: str
    expires_at: datetime
    token_type: str = "Bearer"
    
    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at


class ProfessionalClaim(BaseModel):
    """CMS-1500 Professional Claim"""
    claim_id: str = Field(..., description="Internal claim identifier")
    submitter_id: str
    billing_provider_npi: str
    billing_provider_tax_id: str
    billing_provider_name: str
    billing_provider_address: Dict[str, str]
    
    patient_control_number: str
    patient_last_name: str
    patient_first_name: str
    patient_dob: str  # YYYYMMDD
    patient_gender: str  # M/F
    patient_address: Dict[str, str]
    patient_member_id: str
    
    payer_id: str
    payer_name: str
    
    rendering_provider_npi: Optional[str] = None
    referring_provider_npi: Optional[str] = None
    
    service_lines: List[Dict[str, Any]] = Field(default_factory=list)
    # Each line: procedure_code, modifiers, diagnosis_pointer, charge_amount, units, service_date
    
    diagnosis_codes: List[str] = Field(default_factory=list)
    
    total_charge_amount: float
    patient_amount_due: float = 0.0
    
    place_of_service: str
    claim_frequency_code: str = "1"  # Original claim
    
    # Additional fields
    prior_authorization_number: Optional[str] = None
    referring_provider_name: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "claim_id": "CLM-12345",
                "submitter_id": "1234567890",
                "billing_provider_npi": "1234567890",
                "billing_provider_name": "Smith Medical Group",
                "patient_member_id": "MEM123456",
                "total_charge_amount": 250.00,
                "service_lines": [{
                    "procedure_code": "99213",
                    "charge_amount": 150.00,
                    "units": 1,
                    "service_date": "20240115"
                }]
            }
        }


class InstitutionalClaim(BaseModel):
    """UB-04 Institutional Claim"""
    claim_id: str
    submitter_id: str
    billing_provider_npi: str
    billing_provider_tax_id: str
    facility_code: str  # Type of facility
    
    patient_control_number: str
    patient_last_name: str
    patient_first_name: str
    patient_dob: str
    patient_gender: str
    patient_member_id: str
    
    payer_id: str
    
    admission_date: Optional[str] = None
    discharge_date: Optional[str] = None
    admission_type: Optional[str] = None
    admission_source: Optional[str] = None
    patient_status: Optional[str] = None
    
    revenue_lines: List[Dict[str, Any]] = Field(default_factory=list)
    # Each line: revenue_code, procedure_code, modifiers, charge_amount, units
    
    diagnosis_codes: List[str] = Field(default_factory=list)
    procedure_codes: List[Dict[str, str]] = Field(default_factory=list)
    # Each procedure: code, date
    
    total_charge_amount: float
    
    attending_provider_npi: Optional[str] = None
    operating_provider_npi: Optional[str] = None
    other_provider_npi: Optional[str] = None


class ERATransaction(BaseModel):
    """Electronic Remittance Advice (835) Transaction"""
    transaction_id: str
    payer_id: str
    payer_name: str
    payment_method: str  # ACH, Check, etc.
    payment_date: datetime
    payment_amount: float
    check_eft_trace_number: Optional[str] = None
    
    claims: List[Dict[str, Any]] = Field(default_factory=list)
    # Each claim: claim_id, patient_control_number, claim_status, payment_amount,
    #             charge_amount, patient_responsibility, adjustment_amounts


class EligibilityRequest(BaseModel):
    """Eligibility verification request (270)"""
    request_id: str
    payer_id: str
    provider_npi: str
    
    patient_last_name: str
    patient_first_name: str
    patient_dob: str
    patient_member_id: Optional[str] = None
    patient_ssn_last4: Optional[str] = None
    
    service_type_codes: List[str] = Field(default_factory=list)
    # 30: Health Benefit Plan Coverage
    # 80: Laboratory
    # 98: Professional (Physician) Visit


class EligibilityResponse(BaseModel):
    """Eligibility verification response (271)"""
    request_id: str
    response_id: str
    response_date: datetime
    
    status: EligibilityStatus
    plan_name: Optional[str] = None
    group_number: Optional[str] = None
    group_name: Optional[str] = None
    
    copay_amount: Optional[float] = None
    coinsurance_percent: Optional[float] = None
    deductible_amount: Optional[float] = None
    deductible_met: Optional[float] = None
    out_of_pocket_max: Optional[float] = None
    out_of_pocket_met: Optional[float] = None
    
    coverage_details: List[Dict[str, Any]] = Field(default_factory=list)
    # Each detail: service_type, coverage_level, insurance_type, etc.
    
    in_network: Optional[bool] = None
    prior_authorization_required: Optional[bool] = None
    
    error_codes: List[str] = Field(default_factory=list)


class WaystarClient:
    """
    Waystar Clearinghouse Integration Client
    
    Supports:
    - Professional claims (CMS-1500)
    - Institutional claims (UB-04)
    - Real-time eligibility (270/271)
    - Claim status inquiry
    - ERA (835) processing
    - Attachment submission
    """
    
    def __init__(self, config: WaystarConfig):
        self.config = config
        self.token: Optional[WaystarToken] = None
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
    
    async def _authenticate(self) -> WaystarToken:
        """OAuth 2.0 Client Credentials flow"""
        auth_url = f"{self.config.base_url}/auth/oauth2/token"
        
        payload = {
            "grant_type": "client_credentials",
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "scope": "claims eligibility era"
        }
        
        async with self.session.post(auth_url, data=payload) as response:
            if response.status != 200:
                error = await response.text()
                raise WaystarAuthError(f"Authentication failed: {response.status} - {error}")
            
            data = await response.json()
            
            expires_in = data.get("expires_in", 3600)
            return WaystarToken(
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
        json_data: Optional[Dict] = None,
        return_binary: bool = False
    ) -> Any:
        """Make authenticated API request"""
        await self._ensure_token()
        
        url = f"{self.config.base_url}{endpoint}"
        headers = {
            "Authorization": f"{self.token.token_type} {self.token.access_token}",
            "X-Submitter-ID": self.config.submitter_id,
            "X-Vendor-Name": self.config.vendor_name
        }
        
        async with self.session.request(
            method, url, headers=headers, params=params, json=json_data
        ) as response:
            if response.status == 401:
                # Token expired, re-authenticate
                self.token = await self._authenticate()
                headers["Authorization"] = f"{self.token.token_type} {self.token.access_token}"
                async with self.session.request(
                    method, url, headers=headers, params=params, json=json_data
                ) as retry_response:
                    retry_response.raise_for_status()
                    if return_binary:
                        return await retry_response.read()
                    return await retry_response.json()
            
            response.raise_for_status()
            
            if return_binary:
                return await response.read()
            return await response.json()
    
    # ==================== CLAIM SUBMISSION ====================
    
    async def submit_professional_claim(
        self,
        claim: ProfessionalClaim,
        attachments: Optional[List[Dict]] = None,
        validate_only: bool = False
    ) -> Dict[str, Any]:
        """
        Submit CMS-1500 professional claim
        
        Args:
            claim: Professional claim data
            attachments: Optional list of attachments
            validate_only: If True, only validate without submitting
            
        Returns:
            Submission response with claim reference number
        """
        endpoint = "/claims/v1/professional"
        if validate_only:
            endpoint += "/validate"
        
        payload = {
            "submitterId": claim.submitter_id,
            "billingProvider": {
                "npi": claim.billing_provider_npi,
                "taxId": claim.billing_provider_tax_id,
                "organizationName": claim.billing_provider_name,
                "address": claim.billing_provider_address
            },
            "patient": {
                "controlNumber": claim.patient_control_number,
                "lastName": claim.patient_last_name,
                "firstName": claim.patient_first_name,
                "dateOfBirth": claim.patient_dob,
                "gender": claim.patient_gender,
                "address": claim.patient_address,
                "memberId": claim.patient_member_id
            },
            "payer": {
                "payerId": claim.payer_id,
                "organizationName": claim.payer_name
            },
            "claimInformation": {
                "claimFrequencyCode": claim.claim_frequency_code,
                "placeOfService": claim.place_of_service,
                "patientAmount": {"paidAmount": claim.patient_amount_due},
                "serviceLines": [
                    {
                        "procedureCode": line["procedure_code"],
                        "modifiers": line.get("modifiers", []),
                        "diagnosisPointers": line.get("diagnosis_pointer", ["1"]),
                        "chargeAmount": line["charge_amount"],
                        "unitCount": line.get("units", 1),
                        "serviceDate": line["service_date"]
                    }
                    for line in claim.service_lines
                ],
                "diagnoses": [{"code": code} for code in claim.diagnosis_codes]
            },
            "totalChargeAmount": claim.total_charge_amount
        }
        
        if claim.rendering_provider_npi:
            payload["renderingProvider"] = {"npi": claim.rendering_provider_npi}
        
        if claim.referring_provider_npi:
            payload["referringProvider"] = {"npi": claim.referring_provider_npi}
        
        if claim.prior_authorization_number:
            payload["claimInformation"]["priorAuthorizationNumber"] = claim.prior_authorization_number
        
        if attachments:
            payload["attachments"] = attachments
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    async def submit_institutional_claim(
        self,
        claim: InstitutionalClaim,
        validate_only: bool = False
    ) -> Dict[str, Any]:
        """Submit UB-04 institutional claim"""
        endpoint = "/claims/v1/institutional"
        if validate_only:
            endpoint += "/validate"
        
        payload = {
            "submitterId": claim.submitter_id,
            "billingProvider": {
                "npi": claim.billing_provider_npi,
                "taxId": claim.billing_provider_tax_id
            },
            "patient": {
                "controlNumber": claim.patient_control_number,
                "lastName": claim.patient_last_name,
                "firstName": claim.patient_first_name,
                "dateOfBirth": claim.patient_dob,
                "gender": claim.patient_gender,
                "memberId": claim.patient_member_id
            },
            "payer": {"payerId": claim.payer_id},
            "claimInformation": {
                "facilityCode": claim.facility_code,
                "admissionDate": claim.admission_date,
                "dischargeDate": claim.discharge_date,
                "admissionType": claim.admission_type,
                "admissionSource": claim.admission_source,
                "patientStatus": claim.patient_status,
                "revenueLines": [
                    {
                        "revenueCode": line["revenue_code"],
                        "procedureCode": line.get("procedure_code"),
                        "modifiers": line.get("modifiers", []),
                        "chargeAmount": line["charge_amount"],
                        "unitCount": line.get("units", 1)
                    }
                    for line in claim.revenue_lines
                ],
                "diagnoses": [{"code": code} for code in claim.diagnosis_codes],
                "procedures": claim.procedure_codes
            },
            "totalChargeAmount": claim.total_charge_amount
        }
        
        if claim.attending_provider_npi:
            payload["attendingProvider"] = {"npi": claim.attending_provider_npi}
        
        if claim.operating_provider_npi:
            payload["operatingProvider"] = {"npi": claim.operating_provider_npi}
        
        return await self._make_request("POST", endpoint, json_data=payload)
    
    async def batch_submit_claims(
        self,
        claims: List[Union[ProfessionalClaim, InstitutionalClaim]],
        batch_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Submit multiple claims in batch"""
        payload = {
            "batchName": batch_name or f"Batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            "claims": []
        }
        
        for claim in claims:
            # Convert claim to API format
            if isinstance(claim, ProfessionalClaim):
                claim_data = {"type": "professional", "data": claim.dict()}
            else:
                claim_data = {"type": "institutional", "data": claim.dict()}
            payload["claims"].append(claim_data)
        
        return await self._make_request("POST", "/claims/v1/batch", json_data=payload)
    
    # ==================== CLAIM STATUS ====================
    
    async def check_claim_status(
        self,
        claim_id: Optional[str] = None,
        patient_control_number: Optional[str] = None,
        payer_claim_number: Optional[str] = None,
        date_of_service: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Check claim status
        
        Requires at least one identifier:
        - claim_id (internal)
        - patient_control_number
        - payer_claim_number
        """
        params = {}
        
        if claim_id:
            params["claimId"] = claim_id
        if patient_control_number:
            params["patientControlNumber"] = patient_control_number
        if payer_claim_number:
            params["payerClaimNumber"] = payer_claim_number
        if date_of_service:
            params["serviceDate"] = date_of_service
        
        if not params:
            raise ValueError("At least one identifier required for status check")
        
        return await self._make_request("GET", "/claims/v1/status", params)
    
    async def get_claim_report(
        self,
        start_date: datetime,
        end_date: datetime,
        status: Optional[ClaimStatus] = None,
        payer_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get claim submission report for date range"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d")
        }
        
        if status:
            params["status"] = status.value
        if payer_id:
            params["payerId"] = payer_id
        
        data = await self._make_request("GET", "/reports/v1/claims", params)
        return data.get("claims", [])
    
    # ==================== ELIGIBILITY VERIFICATION ====================
    
    async def verify_eligibility(
        self,
        request: EligibilityRequest
    ) -> EligibilityResponse:
        """
        Real-time eligibility verification (270/271)
        
        Returns patient coverage details, copays, deductibles, etc.
        """
        payload = {
            "requestId": request.request_id,
            "payer": {"payerId": request.payer_id},
            "provider": {"npi": request.provider_npi},
            "subscriber": {
                "lastName": request.patient_last_name,
                "firstName": request.patient_first_name,
                "dateOfBirth": request.patient_dob,
                "memberId": request.patient_member_id,
                "ssnLast4": request.patient_ssn_last4
            },
            "serviceTypeCodes": request.service_type_codes or ["30", "80", "98"]
        }
        
        data = await self._make_request("POST", "/eligibility/v1/verify", json_data=payload)
        
        response_data = data.get("eligibilityResponse", {})
        
        return EligibilityResponse(
            request_id=request.request_id,
            response_id=response_data.get("responseId", ""),
            response_date=datetime.utcnow(),
            status=EligibilityStatus(response_data.get("status", "Unknown")),
            plan_name=response_data.get("planName"),
            group_number=response_data.get("groupNumber"),
            group_name=response_data.get("groupName"),
            copay_amount=response_data.get("copayAmount"),
            coinsurance_percent=response_data.get("coinsurancePercent"),
            deductible_amount=response_data.get("deductible"),
            deductible_met=response_data.get("deductibleMet"),
            out_of_pocket_max=response_data.get("outOfPocketMax"),
            out_of_pocket_met=response_data.get("outOfPocketMet"),
            coverage_details=response_data.get("coverageDetails", []),
            in_network=response_data.get("inNetwork"),
            prior_authorization_required=response_data.get("priorAuthRequired"),
            error_codes=response_data.get("errorCodes", [])
        )
    
    async def batch_eligibility_check(
        self,
        requests: List[EligibilityRequest]
    ) -> List[EligibilityResponse]:
        """Check eligibility for multiple patients in batch"""
        payload = {
            "requests": [
                {
                    "requestId": req.request_id,
                    "payer": {"payerId": req.payer_id},
                    "subscriber": {
                        "lastName": req.patient_last_name,
                        "firstName": req.patient_first_name,
                        "dateOfBirth": req.patient_dob,
                        "memberId": req.patient_member_id
                    },
                    "serviceTypeCodes": req.service_type_codes
                }
                for req in requests
            ]
        }
        
        data = await self._make_request("POST", "/eligibility/v1/batch", json_data=payload)
        
        responses = []
        for resp_data in data.get("responses", []):
            # Map response to original request
            original = next((r for r in requests if r.request_id == resp_data.get("requestId")), None)
            if original:
                responses.append(EligibilityResponse(
                    request_id=original.request_id,
                    response_id=resp_data.get("responseId", ""),
                    response_date=datetime.utcnow(),
                    status=EligibilityStatus(resp_data.get("status", "Unknown"))
                ))
        
        return responses
    
    # ==================== ERA (835) PROCESSING ====================
    
    async def list_available_eras(
        self,
        start_date: datetime,
        end_date: datetime,
        payer_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List available ERA files"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d")
        }
        
        if payer_id:
            params["payerId"] = payer_id
        
        data = await self._make_request("GET", "/era/v1/list", params)
        return data.get("eras", [])
    
    async def download_era(
        self,
        era_id: str,
        format: str = "json"  # json, xml, 835
    ) -> Union[Dict, bytes]:
        """
        Download ERA file
        
        Args:
            era_id: ERA file identifier
            format: Output format (json, xml, or raw 835)
            
        Returns:
            Parsed ERA data or raw bytes
        """
        params = {"format": format}
        
        if format == "json":
            return await self._make_request("GET", f"/era/v1/{era_id}", params)
        else:
            return await self._make_request(
                "GET", f"/era/v1/{era_id}/download", params, return_binary=True
            )
    
    async def parse_era_to_transactions(
        self,
        era_data: Dict[str, Any]
    ) -> List[ERATransaction]:
        """Parse ERA response into transaction objects"""
        transactions = []
        
        for payment in era_data.get("payments", []):
            transaction = ERATransaction(
                transaction_id=payment.get("transactionId"),
                payer_id=payment.get("payerId"),
                payer_name=payment.get("payerName"),
                payment_method=payment.get("paymentMethod", "ACH"),
                payment_date=datetime.fromisoformat(payment.get("paymentDate")),
                payment_amount=payment.get("paymentAmount", 0.0),
                check_eft_trace_number=payment.get("checkEftTraceNumber"),
                claims=[]
            )
            
            for claim in payment.get("claims", []):
                transaction.claims.append({
                    "claim_id": claim.get("claimId"),
                    "patient_control_number": claim.get("patientControlNumber"),
                    "claim_status": claim.get("claimStatus"),
                    "payment_amount": claim.get("paymentAmount", 0.0),
                    "charge_amount": claim.get("chargeAmount", 0.0),
                    "patient_responsibility": claim.get("patientResponsibility", 0.0),
                    "adjustments": claim.get("adjustments", [])
                })
            
            transactions.append(transaction)
        
        return transactions
    
    # ==================== ATTACHMENT SUBMISSION ====================
    
    async def submit_attachment(
        self,
        claim_id: str,
        attachment_type: str,  # CLM_SUPPORT, COB, MEO, etc.
        file_data: bytes,
        filename: str,
        mime_type: str
    ) -> Dict[str, Any]:
        """
        Submit claim attachment
        
        Supported attachment types:
        - CLM_SUPPORT: Claim supporting documentation
        - COB: Coordination of Benefits
        - MEO: Medical Equipment Orders
        - PTAN: Provider Taxonomy and NPI
        """
        # First upload file
        upload_data = await self._upload_file(file_data, filename, mime_type)
        file_id = upload_data.get("fileId")
        
        # Then attach to claim
        payload = {
            "claimId": claim_id,
            "attachmentType": attachment_type,
            "fileId": file_id,
            "description": f"Attachment for claim {claim_id}"
        }
        
        return await self._make_request("POST", "/attachments/v1/submit", json_data=payload)
    
    async def _upload_file(
        self,
        file_data: bytes,
        filename: str,
        mime_type: str
    ) -> Dict[str, Any]:
        """Upload file to Waystar"""
        await self._ensure_token()
        
        url = f"{self.config.base_url}/attachments/v1/upload"
        headers = {
            "Authorization": f"{self.token.token_type} {self.token.access_token}"
        }
        
        data = aiohttp.FormData()
        data.add_field("file", file_data, filename=filename, content_type=mime_type)
        
        async with self.session.post(url, headers=headers, data=data) as response:
            response.raise_for_status()
            return await response.json()


class WaystarAuthError(Exception):
    """Authentication error with Waystar"""
    pass


class WaystarAPIError(Exception):
    """API error from Waystar"""
    pass


# ==================== CLAIMS ANALYTICS ENGINE ====================

class WaystarAnalyticsEngine:
    """
    Analytics engine for Waystar claims data
    Provides insights on claim performance, denial patterns, etc.
    """
    
    def __init__(self, waystar_client: WaystarClient):
        self.client = waystar_client
    
    async def analyze_claim_performance(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """Analyze claim submission performance"""
        claims = await self.client.get_claim_report(start_date, end_date)
        
        total = len(claims)
        if total == 0:
            return {"message": "No claims found in date range"}
        
        by_status = {}
        by_payer = {}
        
        for claim in claims:
            status = claim.get("status", "Unknown")
            by_status[status] = by_status.get(status, 0) + 1
            
            payer = claim.get("payerName", "Unknown")
            by_payer[payer] = by_payer.get(payer, 0) + 1
        
        return {
            "total_claims": total,
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "status_breakdown": by_status,
            "payer_breakdown": by_payer,
            "acceptance_rate": (by_status.get("Accepted", 0) / total) * 100,
            "rejection_rate": (by_status.get("Rejected", 0) / total) * 100
        }
    
    async def reconcile_payments(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """Reconcile claim payments against ERA data"""
        # Get submitted claims
        claims = await self.client.get_claim_report(start_date, end_date)
        
        # Get ERA data
        eras = await self.client.list_available_eras(start_date, end_date)
        
        # Simple reconciliation
        claim_ids = {c.get("patientControlNumber") for c in claims}
        
        reconciled = []
        unreconciled = []
        
        for claim in claims:
            pcn = claim.get("patientControlNumber")
            claim_amount = claim.get("totalChargeAmount", 0)
            
            # Look for matching payment in ERAs
            payment_found = False
            for era in eras:
                era_data = await self.client.download_era(era.get("eraId"))
                for payment in era_data.get("payments", []):
                    for pclaim in payment.get("claims", []):
                        if pclaim.get("patientControlNumber") == pcn:
                            payment_found = True
                            reconciled.append({
                                "claim": claim,
                                "payment": pclaim,
                                "difference": claim_amount - pclaim.get("paymentAmount", 0)
                            })
                            break
            
            if not payment_found:
                unreconciled.append(claim)
        
        return {
            "total_claims": len(claims),
            "reconciled": len(reconciled),
            "unreconciled": len(unreconciled),
            "reconciliation_rate": (len(reconciled) / len(claims) * 100) if claims else 0,
            "unreconciled_claims": unreconciled
        }
