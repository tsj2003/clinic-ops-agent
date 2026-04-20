"""
Epic EHR Integration - FHIR R4 API
Bidirectional data sync for patient demographics, clinical data, and auth status
"""

import os
import json
from datetime import datetime
from typing import Dict, List, Optional, Any
import aiohttp
from dataclasses import dataclass


@dataclass
class EpicPatient:
    """Patient data from Epic FHIR"""
    patient_id: str
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: str
    gender: str
    phone: Optional[str]
    email: Optional[str]
    address: Dict[str, str]
    insurance_member_id: Optional[str]
    primary_insurance: Optional[str]


@dataclass
class EpicEncounter:
    """Encounter/procedure data from Epic"""
    encounter_id: str
    patient_id: str
    encounter_date: str
    encounter_type: str
    procedure_codes: List[str]
    diagnosis_codes: List[str]
    provider_npi: str
    facility_id: str
    status: str


@dataclass
class EpicClinicalNote:
    """Clinical note from Epic"""
    note_id: str
    patient_id: str
    encounter_id: str
    note_type: str
    author_npi: str
    authored_date: str
    content: str
    section_types: List[str]


class EpicFHIRClient:
    """
    Epic FHIR R4 API Client
    Handles authentication, data retrieval, and write-backs
    """
    
    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        organization_id: str
    ):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id
        self.client_secret = client_secret
        self.organization_id = organization_id
        self.access_token: Optional[str] = None
        self.token_expires: Optional[datetime] = None
    
    async def _get_access_token(self) -> str:
        """Get OAuth 2.0 access token"""
        if self.access_token and self.token_expires and datetime.utcnow() < self.token_expires:
            return self.access_token
        
        url = f"{self.base_url}/oauth2/token"
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "system/*.read system/*.write"
                }
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.access_token = data["access_token"]
                    expires_in = data.get("expires_in", 3600)
                    self.token_expires = datetime.utcnow() + __import__('datetime').timedelta(seconds=expires_in - 60)
                    return self.access_token
                else:
                    raise RuntimeError(f"Epic auth failed: {resp.status}")
    
    async def _make_request(
        self,
        endpoint: str,
        method: str = "GET",
        data: Optional[Dict] = None
    ) -> Dict:
        """Make authenticated request to Epic FHIR"""
        token = await self._get_access_token()
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/fhir+json",
            "Epic-Client-ID": self.client_id
        }
        
        url = f"{self.base_url}/api/FHIR/R4/{endpoint}"
        
        async with aiohttp.ClientSession() as session:
            if method == "GET":
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    else:
                        raise RuntimeError(f"Epic API error: {resp.status}")
            elif method == "POST":
                headers["Content-Type"] = "application/fhir+json"
                async with session.post(url, headers=headers, json=data) as resp:
                    if resp.status in (200, 201):
                        return await resp.json()
                    else:
                        raise RuntimeError(f"Epic API error: {resp.status}")
            elif method == "PATCH":
                headers["Content-Type"] = "application/json-patch+json"
                async with session.patch(url, headers=headers, json=data) as resp:
                    if resp.status in (200, 201):
                        return await resp.json()
                    else:
                        raise RuntimeError(f"Epic API error: {resp.status}")
    
    async def search_patient_by_mrn(self, mrn: str) -> Optional[EpicPatient]:
        """Search for patient by Medical Record Number"""
        params = {
            "identifier": f"MR|{mrn}",
            "_format": "json"
        }
        
        result = await self._make_request(f"Patient?{self._build_query(params)}")
        
        if result.get("total", 0) == 0:
            return None
        
        patient_data = result["entry"][0]["resource"]
        return self._parse_patient(patient_data)
    
    async def get_patient(self, patient_id: str) -> EpicPatient:
        """Get patient by FHIR ID"""
        data = await self._make_request(f"Patient/{patient_id}")
        return self._parse_patient(data)
    
    async def get_patient_encounters(
        self,
        patient_id: str,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None
    ) -> List[EpicEncounter]:
        """Get patient encounters/procedures"""
        params = {
            "patient": patient_id,
            "_format": "json"
        }
        if date_from:
            params["date"] = f"ge{date_from}"
        if date_to:
            params["date"] = params.get("date", "") + f",le{date_to}"
        
        result = await self._make_request(f"Encounter?{self._build_query(params)}")
        
        encounters = []
        for entry in result.get("entry", []):
            encounter_data = entry["resource"]
            encounters.append(self._parse_encounter(encounter_data, patient_id))
        
        return encounters
    
    async def get_clinical_notes(
        self,
        patient_id: str,
        encounter_id: Optional[str] = None
    ) -> List[EpicClinicalNote]:
        """Get clinical notes for patient"""
        params = {
            "patient": patient_id,
            "_format": "json",
            "type": "11506-3"  # Progress note LOINC code
        }
        if encounter_id:
            params["encounter"] = encounter_id
        
        result = await self._make_request(f"DocumentReference?{self._build_query(params)}")
        
        notes = []
        for entry in result.get("entry", []):
            doc_data = entry["resource"]
            # Fetch the actual document content
            content_url = doc_data.get("content", [{}])[0].get("attachment", {}).get("url")
            if content_url:
                note_content = await self._fetch_binary(content_url)
                notes.append(self._parse_document(doc_data, note_content, patient_id))
        
        return notes
    
    async def write_auth_status_to_chart(
        self,
        patient_id: str,
        encounter_id: str,
        auth_number: str,
        status: str,
        denial_reason: Optional[str] = None
    ) -> str:
        """
        Write authorization status back to Epic
        Creates a DocumentReference with auth status
        """
        document = {
            "resourceType": "DocumentReference",
            "status": "current",
            "docStatus": "final",
            "type": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "51848-7",
                    "display": "Prior Authorization Status"
                }]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "encounter": {"reference": f"Encounter/{encounter_id}"},
            "date": datetime.utcnow().isoformat(),
            "author": [{"reference": f"Organization/{self.organization_id}"}],
            "description": f"Authorization {status}: {auth_number}",
            "content": [{
                "attachment": {
                    "contentType": "application/json",
                    "data": base64.b64encode(json.dumps({
                        "authorization_number": auth_number,
                        "status": status,
                        "denial_reason": denial_reason,
                        "processed_by": "Clinic Ops Agent",
                        "timestamp": datetime.utcnow().isoformat()
                    }).encode()).decode()
                }
            }],
            "context": {
                "encounter": [{"reference": f"Encounter/{encounter_id}"}],
                "event": [{
                    "coding": [{
                        "system": "http://snomed.info/sct",
                        "code": "309211009",
                        "display": "Prior Authorization"
                    }]
                }]
            }
        }
        
        result = await self._make_request("DocumentReference", "POST", document)
        return result.get("id", "")
    
    async def write_denial_to_chart(
        self,
        patient_id: str,
        encounter_id: str,
        denial_code: str,
        denial_reason: str,
        claim_number: str,
        appeal_submitted: bool = False
    ) -> str:
        """
        Write denial information back to Epic
        """
        # Create a Task for the denial
        task = {
            "resourceType": "Task",
            "status": "requested",
            "intent": "order",
            "priority": "routine",
            "code": {
                "coding": [{
                    "system": "http://snomed.info/sct",
                    "code": "385669000",
                    "display": "Claims Denial Follow-up"
                }]
            },
            "description": f"Claim {claim_number} denied: {denial_code} - {denial_reason}",
            "for": {"reference": f"Patient/{patient_id}"},
            "encounter": {"reference": f"Encounter/{encounter_id}"},
            "requester": {"reference": f"Organization/{self.organization_id}"},
            "authoredOn": datetime.utcnow().isoformat(),
            "input": [
                {
                    "type": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/task-input-type",
                            "code": "comment"
                        }]
                    },
                    "valueString": json.dumps({
                        "denial_code": denial_code,
                        "denial_reason": denial_reason,
                        "claim_number": claim_number,
                        "appeal_submitted": appeal_submitted,
                        "requires_appeal": not appeal_submitted
                    })
                }
            ]
        }
        
        result = await self._make_request("Task", "POST", task)
        return result.get("id", "")
    
    async def update_coverage_eligibility(
        self,
        patient_id: str,
        coverage_id: str,
        status: str,
        prior_auth_number: Optional[str] = None
    ) -> str:
        """Update Coverage resource with auth status"""
        patch_ops = [
            {
                "op": "replace",
                "path": "/status",
                "value": status
            }
        ]
        
        if prior_auth_number:
            patch_ops.append({
                "op": "add",
                "path": "/extension",
                "value": [{
                    "url": "http://epic.com/fhir/StructureDefinition/prior-authorization-number",
                    "valueString": prior_auth_number
                }]
            })
        
        result = await self._make_request(f"Coverage/{coverage_id}", "PATCH", patch_ops)
        return result.get("id", "")
    
    def _parse_patient(self, data: Dict) -> EpicPatient:
        """Parse FHIR Patient resource"""
        names = data.get("name", [{}])[0]
        telecom = {t.get("system"): t.get("value") for t in data.get("telecom", [])}
        address_data = data.get("address", [{}])[0]
        
        # Get insurance member ID from identifiers
        identifiers = {i.get("type", {}).get("text"): i.get("value") 
                      for i in data.get("identifier", [])}
        
        return EpicPatient(
            patient_id=data.get("id", ""),
            mrn=identifiers.get("MR", data.get("id", "")),
            first_name=names.get("given", [""])[0],
            last_name=names.get("family", ""),
            date_of_birth=data.get("birthDate", ""),
            gender=data.get("gender", ""),
            phone=telecom.get("phone"),
            email=telecom.get("email"),
            address={
                "line": address_data.get("line", [""])[0],
                "city": address_data.get("city", ""),
                "state": address_data.get("state", ""),
                "zip": address_data.get("postalCode", "")
            },
            insurance_member_id=identifiers.get("MB"),
            primary_insurance=None  # Would need Coverage resource lookup
        )
    
    def _parse_encounter(self, data: Dict, patient_id: str) -> EpicEncounter:
        """Parse FHIR Encounter resource"""
        # Extract procedure codes from reasonCode
        procedure_codes = []
        diagnosis_codes = []
        
        for reason in data.get("reasonCode", []):
            for coding in reason.get("coding", []):
                if coding.get("system") == "http://www.ama-assn.org/go/cpt":
                    procedure_codes.append(coding.get("code"))
                elif coding.get("system") == "http://hl7.org/fhir/sid/icd-10-cm":
                    diagnosis_codes.append(coding.get("code"))
        
        return EpicEncounter(
            encounter_id=data.get("id", ""),
            patient_id=patient_id,
            encounter_date=data.get("period", {}).get("start", ""),
            encounter_type=data.get("type", [{}])[0].get("text", ""),
            procedure_codes=procedure_codes,
            diagnosis_codes=diagnosis_codes,
            provider_npi="",  # Would need Practitioner lookup
            facility_id=data.get("serviceProvider", {}).get("reference", "").replace("Organization/", ""),
            status=data.get("status", "")
        )
    
    def _parse_document(
        self,
        data: Dict,
        content: str,
        patient_id: str
    ) -> EpicClinicalNote:
        """Parse FHIR DocumentReference"""
        return EpicClinicalNote(
            note_id=data.get("id", ""),
            patient_id=patient_id,
            encounter_id=data.get("context", {}).get("encounter", [{}])[0].get("reference", "").replace("Encounter/", ""),
            note_type=data.get("type", {}).get("text", ""),
            author_npi="",  # Would need Practitioner lookup
            authored_date=data.get("date", ""),
            content=content,
            section_types=[]
        )
    
    async def _fetch_binary(self, url: str) -> str:
        """Fetch binary content from Epic"""
        token = await self._get_access_token()
        
        headers = {"Authorization": f"Bearer {token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    return data.decode('utf-8')
                return ""
    
    def _build_query(self, params: Dict) -> str:
        """Build URL query string"""
        from urllib.parse import urlencode
        return urlencode(params)


class EpicIntegrationManager:
    """
    High-level manager for Epic EHR integration
    Orchestrates bidirectional data sync
    """
    
    def __init__(self):
        self.clients: Dict[str, EpicFHIRClient] = {}
    
    def register_organization(
        self,
        org_id: str,
        epic_base_url: str,
        client_id: str,
        client_secret: str
    ):
        """Register Epic connection for organization"""
        self.clients[org_id] = EpicFHIRClient(
            base_url=epic_base_url,
            client_id=client_id,
            client_secret=client_secret,
            organization_id=org_id
        )
    
    async def sync_patient_for_denial(
        self,
        org_id: str,
        mrn: str,
        encounter_date: str
    ) -> Dict:
        """
        Pull patient data from Epic for denial management
        """
        client = self.clients.get(org_id)
        if not client:
            raise ValueError(f"Epic not configured for org {org_id}")
        
        # Get patient
        patient = await client.search_patient_by_mrn(mrn)
        if not patient:
            raise ValueError(f"Patient not found: {mrn}")
        
        # Get encounters around denial date
        encounters = await client.get_patient_encounters(
            patient.patient_id,
            date_from=encounter_date,
            date_to=encounter_date
        )
        
        # Get clinical notes
        notes = []
        if encounters:
            notes = await client.get_clinical_notes(
                patient.patient_id,
                encounters[0].encounter_id
            )
        
        return {
            "patient": patient,
            "encounters": encounters,
            "clinical_notes": notes,
            "sync_timestamp": datetime.utcnow().isoformat()
        }
    
    async def write_denial_resolution(
        self,
        org_id: str,
        patient_mrn: str,
        encounter_id: str,
        denial_data: Dict,
        resolution: str,
        recovery_amount: float
    ):
        """
        Write denial resolution back to Epic
        """
        client = self.clients.get(org_id)
        if not client:
            raise ValueError(f"Epic not configured for org {org_id}")
        
        # Find patient
        patient = await client.search_patient_by_mrn(patient_mrn)
        if not patient:
            raise ValueError(f"Patient not found: {patient_mrn}")
        
        # Write resolution as DocumentReference
        doc_id = await client.write_auth_status_to_chart(
            patient_id=patient.patient_id,
            encounter_id=encounter_id,
            auth_number=denial_data.get("claim_number", ""),
            status=resolution,
            denial_reason=None if resolution == "approved" else denial_data.get("denial_reason")
        )
        
        return {"document_id": doc_id, "status": "written"}


# Global instance
epic_manager = EpicIntegrationManager()
