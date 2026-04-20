"""
Allscripts EHR Integration Module
Supports Allscripts Professional and Enterprise EHR systems
"""

import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from dataclasses import dataclass
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend


class AllscriptsConfig(BaseModel):
    """Allscripts API configuration"""
    base_url: str = Field(..., description="Allscripts API base URL")
    client_id: str = Field(..., description="OAuth client ID")
    client_secret: str = Field(..., description="OAuth client secret")
    username: str = Field(..., description="API username")
    password: str = Field(..., description="API password")
    app_name: str = Field(default="ClinicOpsAgent")
    timeout: int = Field(default=60)
    
    class Config:
        env_prefix = "ALLSCRIPTS_"


@dataclass
class AllscriptsToken:
    """Allscripts OAuth token container"""
    access_token: str
    refresh_token: str
    expires_at: datetime
    token_type: str = "Bearer"
    
    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at


class AllscriptsPatient(BaseModel):
    """Allscripts patient data model"""
    patient_id: str
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: str
    gender: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[Dict] = None
    insurance: Optional[List[Dict]] = None


class AllscriptsEncounter(BaseModel):
    """Allscripts encounter/visit data"""
    encounter_id: str
    patient_id: str
    encounter_date: datetime
    provider_id: str
    provider_name: str
    encounter_type: str
    chief_complaint: Optional[str] = None
    diagnosis_codes: List[str] = Field(default_factory=list)
    procedure_codes: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class AllscriptsDocument(BaseModel):
    """Clinical document from Allscripts"""
    document_id: str
    patient_id: str
    document_type: str
    created_date: datetime
    author: str
    title: str
    content: Optional[str] = None
    binary_data: Optional[bytes] = None


class AllscriptsEHRClient:
    """
    Allscripts EHR Integration Client
    
    Supports:
    - Patient search and retrieval
    - Encounter/visit data access
    - Clinical documents
    - Provider directory
    - Appointment scheduling
    - Order management (lab, imaging, referral)
    """
    
    def __init__(self, config: AllscriptsConfig):
        self.config = config
        self.token: Optional[AllscriptsToken] = None
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
    
    async def _ensure_token(self):
        """Ensure valid OAuth token"""
        if self.token is None or self.token.is_expired:
            async with self._lock:
                if self.token is None or self.token.is_expired:
                    await self._authenticate()
    
    async def _authenticate(self):
        """OAuth 2.0 authentication with Allscripts"""
        auth_url = f"{self.config.base_url}/oauth2/token"
        
        payload = {
            "grant_type": "password",
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "username": self.config.username,
            "password": self.config.password,
            "scope": "patient/*.read patient/*.write launch/patient"
        }
        
        async with self.session.post(auth_url, data=payload) as response:
            if response.status != 200:
                raise AllscriptsAuthError(f"Authentication failed: {response.status}")
            
            data = await response.json()
            
            expires_in = data.get("expires_in", 3600)
            self.token = AllscriptsToken(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", ""),
                expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
                token_type=data.get("token_type", "Bearer")
            )
    
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
            "Authorization": f"{self.token.token_type} {self.token.access_token}",
            "X-App-Name": self.config.app_name
        }
        
        async with self.session.request(
            method, url, headers=headers, params=params, json=json_data
        ) as response:
            if response.status == 401:
                # Token expired, retry once
                await self._authenticate()
                headers["Authorization"] = f"{self.token.token_type} {self.token.access_token}"
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
        query: str,
        search_type: str = "name",
        limit: int = 20
    ) -> List[AllscriptsPatient]:
        """
        Search patients in Allscripts
        
        Args:
            query: Search string (name, MRN, phone, etc.)
            search_type: Type of search (name, mrn, phone, dob)
            limit: Maximum results
            
        Returns:
            List of matching patients
        """
        params = {
            "SearchString": query,
            "SearchType": search_type,
            "MaxResults": limit
        }
        
        data = await self._make_request("GET", "GetPatient", params)
        
        patients = []
        for patient_data in data.get("Patients", []):
            patients.append(AllscriptsPatient(
                patient_id=patient_data.get("ID"),
                mrn=patient_data.get("MRN"),
                first_name=patient_data.get("FirstName"),
                last_name=patient_data.get("LastName"),
                date_of_birth=patient_data.get("DOB"),
                gender=patient_data.get("Gender"),
                phone=patient_data.get("HomePhone"),
                email=patient_data.get("Email"),
                address={
                    "street": patient_data.get("AddressLine1"),
                    "city": patient_data.get("City"),
                    "state": patient_data.get("State"),
                    "zip": patient_data.get("Zip"),
                } if patient_data.get("AddressLine1") else None
            ))
        
        return patients
    
    async def get_patient_details(self, patient_id: str) -> AllscriptsPatient:
        """Get comprehensive patient details"""
        params = {"PatientID": patient_id}
        
        data = await self._make_request("GET", "GetPatient", params)
        patient_data = data.get("Patient", {})
        
        return AllscriptsPatient(
            patient_id=patient_id,
            mrn=patient_data.get("MRN"),
            first_name=patient_data.get("FirstName"),
            last_name=patient_data.get("LastName"),
            date_of_birth=patient_data.get("DOB"),
            gender=patient_data.get("Gender"),
            phone=patient_data.get("HomePhone"),
            email=patient_data.get("Email"),
            address={
                "street": patient_data.get("AddressLine1"),
                "city": patient_data.get("City"),
                "state": patient_data.get("State"),
                "zip": patient_data.get("Zip"),
            },
            insurance=patient_data.get("Insurance", [])
        )
    
    # ==================== ENCOUNTER OPERATIONS ====================
    
    async def get_patient_encounters(
        self,
        patient_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        encounter_type: Optional[str] = None
    ) -> List[AllscriptsEncounter]:
        """Get patient encounter history"""
        params = {"PatientID": patient_id}
        
        if start_date:
            params["StartDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["EndDate"] = end_date.strftime("%Y-%m-%d")
        if encounter_type:
            params["EncounterType"] = encounter_type
        
        data = await self._make_request("GET", "GetEncounter", params)
        
        encounters = []
        for enc_data in data.get("Encounters", []):
            encounters.append(AllscriptsEncounter(
                encounter_id=enc_data.get("EncounterID"),
                patient_id=patient_id,
                encounter_date=datetime.fromisoformat(enc_data.get("EncounterDate")),
                provider_id=enc_data.get("ProviderID"),
                provider_name=f"{enc_data.get('ProviderFirstName', '')} {enc_data.get('ProviderLastName', '')}".strip(),
                encounter_type=enc_data.get("EncounterType"),
                chief_complaint=enc_data.get("ChiefComplaint"),
                diagnosis_codes=[d.get("Code") for d in enc_data.get("Diagnoses", [])],
                procedure_codes=[p.get("Code") for p in enc_data.get("Procedures", [])],
                notes=enc_data.get("Notes")
            ))
        
        return encounters
    
    # ==================== DOCUMENT OPERATIONS ====================
    
    async def get_clinical_documents(
        self,
        patient_id: str,
        document_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[AllscriptsDocument]:
        """Get clinical documents for patient"""
        params = {"PatientID": patient_id}
        
        if document_type:
            params["DocumentType"] = document_type
        if start_date:
            params["StartDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["EndDate"] = end_date.strftime("%Y-%m-%d")
        
        data = await self._make_request("GET", "GetDocument", params)
        
        documents = []
        for doc_data in data.get("Documents", []):
            documents.append(AllscriptsDocument(
                document_id=doc_data.get("DocumentID"),
                patient_id=patient_id,
                document_type=doc_data.get("DocumentType"),
                created_date=datetime.fromisoformat(doc_data.get("CreatedDate")),
                author=doc_data.get("Author"),
                title=doc_data.get("Title"),
                content=doc_data.get("Content")
            ))
        
        return documents
    
    async def create_clinical_document(
        self,
        patient_id: str,
        document_type: str,
        title: str,
        content: str,
        author: str
    ) -> AllscriptsDocument:
        """Create new clinical document"""
        payload = {
            "PatientID": patient_id,
            "DocumentType": document_type,
            "Title": title,
            "Content": content,
            "Author": author,
            "CreatedDate": datetime.utcnow().isoformat()
        }
        
        data = await self._make_request("POST", "SaveDocument", json_data=payload)
        
        return AllscriptsDocument(
            document_id=data.get("DocumentID"),
            patient_id=patient_id,
            document_type=document_type,
            created_date=datetime.utcnow(),
            author=author,
            title=title,
            content=content
        )
    
    # ==================== ORDER MANAGEMENT ====================
    
    async def create_lab_order(
        self,
        patient_id: str,
        provider_id: str,
        lab_tests: List[str],
        diagnosis_codes: List[str],
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create laboratory order"""
        payload = {
            "PatientID": patient_id,
            "ProviderID": provider_id,
            "OrderType": "Laboratory",
            "Tests": [{"Code": code} for code in lab_tests],
            "Diagnoses": [{"Code": code} for code in diagnosis_codes],
            "Notes": notes,
            "OrderDate": datetime.utcnow().isoformat()
        }
        
        return await self._make_request("POST", "SaveOrder", json_data=payload)
    
    async def create_imaging_order(
        self,
        patient_id: str,
        provider_id: str,
        imaging_procedure: str,
        diagnosis_codes: List[str],
        urgency: str = "Routine",
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create radiology/imaging order"""
        payload = {
            "PatientID": patient_id,
            "ProviderID": provider_id,
            "OrderType": "Radiology",
            "Procedure": {"Code": imaging_procedure},
            "Diagnoses": [{"Code": code} for code in diagnosis_codes],
            "Urgency": urgency,
            "Notes": notes,
            "OrderDate": datetime.utcnow().isoformat()
        }
        
        return await self._make_request("POST", "SaveOrder", json_data=payload)
    
    # ==================== APPOINTMENT SCHEDULING ====================
    
    async def get_appointments(
        self,
        patient_id: Optional[str] = None,
        provider_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get scheduled appointments"""
        params = {}
        
        if patient_id:
            params["PatientID"] = patient_id
        if provider_id:
            params["ProviderID"] = provider_id
        if start_date:
            params["StartDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["EndDate"] = end_date.strftime("%Y-%m-%d")
        
        data = await self._make_request("GET", "GetSchedule", params)
        return data.get("Appointments", [])
    
    async def schedule_appointment(
        self,
        patient_id: str,
        provider_id: str,
        appointment_date: datetime,
        duration_minutes: int = 30,
        appointment_type: str = "Office Visit",
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Schedule new appointment"""
        payload = {
            "PatientID": patient_id,
            "ProviderID": provider_id,
            "AppointmentDate": appointment_date.isoformat(),
            "Duration": duration_minutes,
            "AppointmentType": appointment_type,
            "Notes": notes
        }
        
        return await self._make_request("POST", "SaveAppointment", json_data=payload)


class AllscriptsAuthError(Exception):
    """Authentication error with Allscripts"""
    pass


class AllscriptsAPIError(Exception):
    """API error from Allscripts"""
    pass


# ==================== FHIR BRIDGE ====================

class AllscriptsFHIRBridge:
    """
    Bridge between Allscripts and FHIR R4
    Converts Allscripts data to/from FHIR format
    """
    
    @staticmethod
    def patient_to_fhir(allscripts_patient: AllscriptsPatient) -> Dict[str, Any]:
        """Convert Allscripts patient to FHIR Patient resource"""
        return {
            "resourceType": "Patient",
            "id": allscripts_patient.patient_id,
            "identifier": [{
                "system": "http://allscripts.com/mrn",
                "value": allscripts_patient.mrn
            }],
            "name": [{
                "family": allscripts_patient.last_name,
                "given": [allscripts_patient.first_name]
            }],
            "gender": allscripts_patient.gender.lower(),
            "birthDate": allscripts_patient.date_of_birth,
            "telecom": [
                {"system": "phone", "value": allscripts_patient.phone, "use": "home"},
                {"system": "email", "value": allscripts_patient.email}
            ] if allscripts_patient.phone or allscripts_patient.email else [],
            "address": [{
                "line": [allscripts_patient.address["street"]],
                "city": allscripts_patient.address["city"],
                "state": allscripts_patient.address["state"],
                "postalCode": allscripts_patient.address["zip"]
            }] if allscripts_patient.address else []
        }
    
    @staticmethod
    def encounter_to_fhir(allscripts_encounter: AllscriptsEncounter) -> Dict[str, Any]:
        """Convert Allscripts encounter to FHIR Encounter resource"""
        return {
            "resourceType": "Encounter",
            "id": allscripts_encounter.encounter_id,
            "status": "finished",
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": allscripts_encounter.encounter_type
            },
            "subject": {
                "reference": f"Patient/{allscripts_encounter.patient_id}"
            },
            "participant": [{
                "individual": {
                    "reference": f"Practitioner/{allscripts_encounter.provider_id}",
                    "display": allscripts_encounter.provider_name
                }
            }],
            "period": {
                "start": allscripts_encounter.encounter_date.isoformat()
            },
            "reasonCode": [{
                "text": allscripts_encounter.chief_complaint
            }] if allscripts_encounter.chief_complaint else [],
            "diagnosis": [{
                "condition": {"code": {"coding": [{"code": code}]}}
            } for code in allscripts_encounter.diagnosis_codes]
        }
