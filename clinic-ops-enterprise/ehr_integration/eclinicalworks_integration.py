"""
eClinicalWorks (eCW) EHR Integration Module
Supports eCW 20.x and later versions
"""

import asyncio
import aiohttp
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Union
from pydantic import BaseModel, Field
from dataclasses import dataclass
import json
import hashlib


class eClinicalWorksConfig(BaseModel):
    """eClinicalWorks API configuration"""
    base_url: str = Field(..., description="eCW API base URL")
    username: str = Field(..., description="API username")
    password: str = Field(..., description="API password")
    facility_code: str = Field(..., description="Facility/Location code")
    app_key: str = Field(..., description="Application key")
    timeout: int = Field(default=60)
    use_rest_api: bool = Field(default=True)  # True = REST, False = SOAP
    
    class Config:
        env_prefix = "ECW_"


@dataclass
class eCWToken:
    """eCW session token"""
    session_id: str
    user_id: str
    expires_at: datetime
    
    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at


class eCWPatient(BaseModel):
    """eClinicalWorks patient model"""
    patient_id: str
    chart_number: str  # eCW specific
    first_name: str
    last_name: str
    middle_name: Optional[str] = None
    date_of_birth: str
    gender: str
    ssn: Optional[str] = None
    phone_home: Optional[str] = None
    phone_mobile: Optional[str] = None
    phone_work: Optional[str] = None
    email: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    country: str = "USA"
    primary_insurance: Optional[Dict] = None
    secondary_insurance: Optional[Dict] = None
    responsible_party: Optional[Dict] = None
    employer: Optional[Dict] = None


class eCWAppointment(BaseModel):
    """eClinicalWorks appointment"""
    appointment_id: str
    patient_id: str
    patient_name: str
    provider_id: str
    provider_name: str
    location_id: str
    appointment_date: datetime
    duration_minutes: int
    appointment_type: str
    status: str  # Scheduled, CheckedIn, Completed, Cancelled, NoShow
    notes: Optional[str] = None
    chief_complaint: Optional[str] = None
    visit_reason: Optional[str] = None


class eCWEncounter(BaseModel):
    """eClinicalWorks encounter/visit note"""
    encounter_id: str
    patient_id: str
    visit_date: datetime
    provider_id: str
    provider_name: str
    location_id: str
    chief_complaint: Optional[str] = None
    hpi: Optional[str] = None  # History of Present Illness
    ros: Optional[Dict] = None  # Review of Systems
    physical_exam: Optional[str] = None
    assessment_and_plan: Optional[str] = None
    diagnosis_codes: List[str] = Field(default_factory=list)
    procedure_codes: List[str] = Field(default_factory=list)
    vitals: Optional[Dict] = None
    medications: List[Dict] = Field(default_factory=list)
    allergies: List[Dict] = Field(default_factory=list)


class eCWLabResult(BaseModel):
    """eClinicalWorks lab result"""
    result_id: str
    patient_id: str
    order_id: str
    test_code: str
    test_name: str
    result_value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    abnormal_flag: Optional[str] = None  # H, L, N, A
    status: str  # Pending, Preliminary, Final, Corrected
    observation_date: datetime
    result_date: datetime
    performing_lab: Optional[str] = None
    ordering_provider: Optional[str] = None


class eClinicalWorksClient:
    """
    eClinicalWorks EHR Integration Client
    
    Supports both REST API (v20+) and legacy SOAP API
    """
    
    def __init__(self, config: eClinicalWorksConfig):
        self.config = config
        self.token: Optional[eCWToken] = None
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
    
    async def _authenticate(self) -> eCWToken:
        """Authenticate with eCW API"""
        auth_url = f"{self.config.base_url}/api/auth"
        
        payload = {
            "username": self.config.username,
            "password": self.config.password,
            "facility": self.config.facility_code,
            "appKey": self.config.app_key
        }
        
        async with self.session.post(auth_url, json=payload) as response:
            if response.status != 200:
                error_text = await response.text()
                raise eCWAuthError(f"Authentication failed: {response.status} - {error_text}")
            
            data = await response.json()
            
            return eCWToken(
                session_id=data["sessionId"],
                user_id=data["userId"],
                expires_at=datetime.utcnow() + timedelta(hours=8)
            )
    
    async def _ensure_token(self):
        """Ensure valid session"""
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
        
        url = f"{self.config.base_url}/api/{endpoint}"
        headers = {
            "Authorization": f"Session {self.token.session_id}",
            "X-Facility": self.config.facility_code
        }
        
        async with self.session.request(
            method, url, headers=headers, params=params, json=json_data
        ) as response:
            if response.status == 401:
                # Session expired, re-authenticate
                self.token = await self._authenticate()
                headers["Authorization"] = f"Session {self.token.session_id}"
                async with self.session.request(
                    method, url, headers=headers, params=params, json=json_data
                ) as retry_response:
                    retry_response.raise_for_status()
                    return await retry_response.json()
            
            response.raise_for_status()
            return await response.json()
    
    # ==================== PATIENT OPERATIONS ====================
    
    async def search_patients(
        self,
        search_term: str,
        search_by: str = "name",  # name, chartnumber, phone, dob
        active_only: bool = True,
        limit: int = 50
    ) -> List[eCWPatient]:
        """
        Search patients in eClinicalWorks
        
        Args:
            search_term: Search string
            search_by: Search field type
            active_only: Return only active patients
            limit: Maximum results
        """
        params = {
            "searchTerm": search_term,
            "searchBy": search_by,
            "activeOnly": str(active_only).lower(),
            "limit": limit
        }
        
        data = await self._make_request("GET", "patients/search", params)
        
        patients = []
        for patient_data in data.get("patients", []):
            patients.append(eCWPatient(
                patient_id=str(patient_data.get("patientId")),
                chart_number=patient_data.get("chartNumber", ""),
                first_name=patient_data.get("firstName", ""),
                last_name=patient_data.get("lastName", ""),
                middle_name=patient_data.get("middleName"),
                date_of_birth=patient_data.get("dateOfBirth"),
                gender=patient_data.get("gender", ""),
                ssn=patient_data.get("ssn"),
                phone_home=patient_data.get("phoneHome"),
                phone_mobile=patient_data.get("phoneMobile"),
                phone_work=patient_data.get("phoneWork"),
                email=patient_data.get("email"),
                address_line1=patient_data.get("addressLine1"),
                address_line2=patient_data.get("addressLine2"),
                city=patient_data.get("city"),
                state=patient_data.get("state"),
                zip=patient_data.get("zip"),
                country=patient_data.get("country", "USA"),
                primary_insurance=patient_data.get("primaryInsurance"),
                secondary_insurance=patient_data.get("secondaryInsurance"),
                responsible_party=patient_data.get("responsibleParty"),
                employer=patient_data.get("employer")
            ))
        
        return patients
    
    async def get_patient_details(self, patient_id: str) -> eCWPatient:
        """Get full patient demographics"""
        data = await self._make_request("GET", f"patients/{patient_id}")
        patient_data = data.get("patient", {})
        
        return eCWPatient(
            patient_id=patient_id,
            chart_number=patient_data.get("chartNumber", ""),
            first_name=patient_data.get("firstName", ""),
            last_name=patient_data.get("lastName", ""),
            middle_name=patient_data.get("middleName"),
            date_of_birth=patient_data.get("dateOfBirth"),
            gender=patient_data.get("gender", ""),
            ssn=patient_data.get("ssn"),
            phone_home=patient_data.get("phoneHome"),
            phone_mobile=patient_data.get("phoneMobile"),
            phone_work=patient_data.get("phoneWork"),
            email=patient_data.get("email"),
            address_line1=patient_data.get("addressLine1"),
            address_line2=patient_data.get("addressLine2"),
            city=patient_data.get("city"),
            state=patient_data.get("state"),
            zip=patient_data.get("zip"),
            country=patient_data.get("country", "USA"),
            primary_insurance=patient_data.get("primaryInsurance"),
            secondary_insurance=patient_data.get("secondaryInsurance"),
            responsible_party=patient_data.get("responsibleParty"),
            employer=patient_data.get("employer")
        )
    
    async def create_patient(self, patient: eCWPatient) -> str:
        """Create new patient record"""
        payload = {
            "firstName": patient.first_name,
            "lastName": patient.last_name,
            "middleName": patient.middle_name,
            "dateOfBirth": patient.date_of_birth,
            "gender": patient.gender,
            "ssn": patient.ssn,
            "phoneHome": patient.phone_home,
            "phoneMobile": patient.phone_mobile,
            "phoneWork": patient.phone_work,
            "email": patient.email,
            "addressLine1": patient.address_line1,
            "addressLine2": patient.address_line2,
            "city": patient.city,
            "state": patient.state,
            "zip": patient.zip,
            "country": patient.country,
            "primaryInsurance": patient.primary_insurance,
            "secondaryInsurance": patient.secondary_insurance
        }
        
        data = await self._make_request("POST", "patients", json_data=payload)
        return data.get("patientId", "")
    
    async def update_patient(self, patient_id: str, patient: eCWPatient) -> bool:
        """Update patient demographics"""
        payload = {
            "firstName": patient.first_name,
            "lastName": patient.last_name,
            "middleName": patient.middle_name,
            "dateOfBirth": patient.date_of_birth,
            "gender": patient.gender,
            "ssn": patient.ssn,
            "phoneHome": patient.phone_home,
            "phoneMobile": patient.phone_mobile,
            "phoneWork": patient.phone_work,
            "email": patient.email,
            "addressLine1": patient.address_line1,
            "addressLine2": patient.address_line2,
            "city": patient.city,
            "state": patient.state,
            "zip": patient.zip,
            "country": patient.country,
            "primaryInsurance": patient.primary_insurance,
            "secondaryInsurance": patient.secondary_insurance
        }
        
        await self._make_request("PUT", f"patients/{patient_id}", json_data=payload)
        return True
    
    # ==================== APPOINTMENT OPERATIONS ====================
    
    async def get_appointments(
        self,
        patient_id: Optional[str] = None,
        provider_id: Optional[str] = None,
        location_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[eCWAppointment]:
        """Get appointments with filtering"""
        params = {"limit": limit}
        
        if patient_id:
            params["patientId"] = patient_id
        if provider_id:
            params["providerId"] = provider_id
        if location_id:
            params["locationId"] = location_id
        if start_date:
            params["startDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["endDate"] = end_date.strftime("%Y-%m-%d")
        if status:
            params["status"] = status
        
        data = await self._make_request("GET", "appointments", params)
        
        appointments = []
        for appt_data in data.get("appointments", []):
            appointments.append(eCWAppointment(
                appointment_id=str(appt_data.get("appointmentId")),
                patient_id=str(appt_data.get("patientId")),
                patient_name=appt_data.get("patientName", ""),
                provider_id=str(appt_data.get("providerId")),
                provider_name=appt_data.get("providerName", ""),
                location_id=str(appt_data.get("locationId")),
                appointment_date=datetime.fromisoformat(appt_data.get("appointmentDate")),
                duration_minutes=appt_data.get("duration", 15),
                appointment_type=appt_data.get("appointmentType", ""),
                status=appt_data.get("status", "Scheduled"),
                notes=appt_data.get("notes"),
                chief_complaint=appt_data.get("chiefComplaint"),
                visit_reason=appt_data.get("visitReason")
            ))
        
        return appointments
    
    async def schedule_appointment(self, appointment: eCWAppointment) -> str:
        """Schedule new appointment"""
        payload = {
            "patientId": appointment.patient_id,
            "providerId": appointment.provider_id,
            "locationId": appointment.location_id,
            "appointmentDate": appointment.appointment_date.isoformat(),
            "duration": appointment.duration_minutes,
            "appointmentType": appointment.appointment_type,
            "notes": appointment.notes,
            "chiefComplaint": appointment.chief_complaint,
            "visitReason": appointment.visit_reason
        }
        
        data = await self._make_request("POST", "appointments", json_data=payload)
        return data.get("appointmentId", "")
    
    async def update_appointment_status(
        self,
        appointment_id: str,
        status: str,
        notes: Optional[str] = None
    ) -> bool:
        """Update appointment status (CheckedIn, Completed, Cancelled, etc.)"""
        payload = {
            "status": status,
            "notes": notes
        }
        
        await self._make_request("PUT", f"appointments/{appointment_id}/status", json_data=payload)
        return True
    
    # ==================== ENCOUNTER/CHART NOTES ====================
    
    async def get_encounter_list(
        self,
        patient_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get list of patient encounters"""
        params = {"patientId": patient_id}
        
        if start_date:
            params["startDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["endDate"] = end_date.strftime("%Y-%m-%d")
        
        data = await self._make_request("GET", "encounters", params)
        return data.get("encounters", [])
    
    async def get_encounter_details(self, encounter_id: str) -> eCWEncounter:
        """Get full encounter details with clinical data"""
        data = await self._make_request("GET", f"encounters/{encounter_id}")
        enc_data = data.get("encounter", {})
        
        return eCWEncounter(
            encounter_id=encounter_id,
            patient_id=str(enc_data.get("patientId")),
            visit_date=datetime.fromisoformat(enc_data.get("visitDate")),
            provider_id=str(enc_data.get("providerId")),
            provider_name=enc_data.get("providerName", ""),
            location_id=str(enc_data.get("locationId")),
            chief_complaint=enc_data.get("chiefComplaint"),
            hpi=enc_data.get("hpi"),
            ros=enc_data.get("reviewOfSystems"),
            physical_exam=enc_data.get("physicalExam"),
            assessment_and_plan=enc_data.get("assessmentAndPlan"),
            diagnosis_codes=[d.get("code") for d in enc_data.get("diagnoses", [])],
            procedure_codes=[p.get("code") for p in enc_data.get("procedures", [])],
            vitals=enc_data.get("vitals"),
            medications=enc_data.get("medications", []),
            allergies=enc_data.get("allergies", [])
        )
    
    # ==================== LAB RESULTS ====================
    
    async def get_lab_results(
        self,
        patient_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        status: Optional[str] = None
    ) -> List[eCWLabResult]:
        """Get patient lab results"""
        params = {"patientId": patient_id}
        
        if start_date:
            params["startDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["endDate"] = end_date.strftime("%Y-%m-%d")
        if status:
            params["status"] = status
        
        data = await self._make_request("GET", "lab/results", params)
        
        results = []
        for result_data in data.get("results", []):
            results.append(eCWLabResult(
                result_id=str(result_data.get("resultId")),
                patient_id=patient_id,
                order_id=str(result_data.get("orderId")),
                test_code=result_data.get("testCode", ""),
                test_name=result_data.get("testName", ""),
                result_value=str(result_data.get("resultValue", "")),
                unit=result_data.get("unit"),
                reference_range=result_data.get("referenceRange"),
                abnormal_flag=result_data.get("abnormalFlag"),
                status=result_data.get("status", "Unknown"),
                observation_date=datetime.fromisoformat(result_data.get("observationDate")),
                result_date=datetime.fromisoformat(result_data.get("resultDate")),
                performing_lab=result_data.get("performingLab"),
                ordering_provider=result_data.get("orderingProvider")
            ))
        
        return results
    
    async def get_lab_document(
        self,
        result_id: str
    ) -> Optional[bytes]:
        """Get lab result PDF/document"""
        url = f"{self.config.base_url}/api/lab/results/{result_id}/document"
        headers = {"Authorization": f"Session {self.token.session_id}"}
        
        async with self.session.get(url, headers=headers) as response:
            if response.status == 200:
                return await response.read()
            return None
    
    # ==================== BILLING/CLAIMS INTEGRATION ====================
    
    async def get_superbill(
        self,
        encounter_id: str
    ) -> Dict[str, Any]:
        """Get superbill for encounter (charge slip)"""
        data = await self._make_request("GET", f"billing/superbill/{encounter_id}")
        return data.get("superbill", {})
    
    async def get_outstanding_claims(
        self,
        patient_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get outstanding/unbilled encounters"""
        params = {}
        
        if patient_id:
            params["patientId"] = patient_id
        if start_date:
            params["startDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["endDate"] = end_date.strftime("%Y-%m-%d")
        
        data = await self._make_request("GET", "billing/outstanding", params)
        return data.get("claims", [])


class eCWAuthError(Exception):
    """Authentication error with eClinicalWorks"""
    pass


class eCWAPIError(Exception):
    """API error from eClinicalWorks"""
    pass


# ==================== BIDIRECTIONAL SYNC ENGINE ====================

class eCWSyncEngine:
    """
    Bidirectional synchronization engine for eClinicalWorks
    Keeps Clinic Ops data in sync with eCW
    """
    
    def __init__(self, ecw_client: eClinicalWorksClient):
        self.client = ecw_client
        self.sync_interval_minutes = 15
    
    async def sync_patient_demographics(self, patient_id: str) -> Dict[str, Any]:
        """Sync patient demographics from eCW to Clinic Ops"""
        patient = await self.client.get_patient_details(patient_id)
        
        # Convert to Clinic Ops format
        return {
            "patient_id": patient.patient_id,
            "mrn": patient.chart_number,
            "first_name": patient.first_name,
            "last_name": patient.last_name,
            "date_of_birth": patient.date_of_birth,
            "gender": patient.gender,
            "phone": patient.phone_mobile or patient.phone_home,
            "email": patient.email,
            "address": {
                "line1": patient.address_line1,
                "line2": patient.address_line2,
                "city": patient.city,
                "state": patient.state,
                "zip": patient.zip
            },
            "insurance": patient.primary_insurance,
            "ecw_sync_timestamp": datetime.utcnow().isoformat()
        }
    
    async def sync_encounter_for_claims(
        self,
        encounter_id: str
    ) -> Dict[str, Any]:
        """Sync encounter data for claims processing"""
        encounter = await self.client.get_encounter_details(encounter_id)
        superbill = await self.client.get_superbill(encounter_id)
        
        return {
            "encounter_id": encounter_id,
            "patient_id": encounter.patient_id,
            "visit_date": encounter.visit_date.isoformat(),
            "provider_id": encounter.provider_id,
            "provider_name": encounter.provider_name,
            "diagnosis_codes": encounter.diagnosis_codes,
            "procedure_codes": encounter.procedure_codes,
            "superbill_charges": superbill.get("charges", []),
            "chief_complaint": encounter.chief_complaint,
            "ready_for_claim": superbill.get("isComplete", False),
            "ecw_sync_timestamp": datetime.utcnow().isoformat()
        }
    
    async def find_unbilled_encounters(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> List[str]:
        """Find encounters ready for billing"""
        claims = await self.client.get_outstanding_claims(
            start_date=start_date,
            end_date=end_date
        )
        
        unbilled = []
        for claim in claims:
            if claim.get("status") in ["Ready", "Pending", "Incomplete"]:
                unbilled.append(claim.get("encounterId"))
        
        return unbilled
