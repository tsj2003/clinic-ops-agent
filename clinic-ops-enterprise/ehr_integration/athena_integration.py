"""
athenahealth EHR Integration - REST API
Supports athenaOne workflows
"""

import os
import hmac
import hashlib
import base64
from datetime import datetime
from typing import Dict, List, Optional
import aiohttp
from dataclasses import dataclass


@dataclass
class AthenaPatient:
    """Patient from athenahealth"""
    patient_id: str
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: str
    phone: Optional[str]
    email: Optional[str]


class AthenaHealthClient:
    """athenahealth API Client"""
    
    def __init__(
        self,
        practice_id: str,
        client_id: str,
        client_secret: str,
        version: str = "v1"
    ):
        self.base_url = f"https://api.athenahealth.com/{version}"
        self.practice_id = practice_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token: Optional[str] = None
    
    async def _authenticate(self):
        """OAuth 2.0 authentication"""
        url = f"{self.base_url}/{self.practice_id}/oauth2/token"
        
        # Create authorization header
        auth_string = f"{self.client_id}:{self.client_secret}"
        auth_bytes = base64.b64encode(auth_string.encode()).decode()
        
        headers = {
            "Authorization": f"Basic {auth_bytes}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        data = {"grant_type": "client_credentials"}
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, data=data) as resp:
                result = await resp.json()
                self.access_token = result["access_token"]
    
    async def get_patient(self, patient_id: str) -> Optional[AthenaPatient]:
        """Get patient by ID"""
        if not self.access_token:
            await self._authenticate()
        
        url = f"{self.base_url}/{self.practice_id}/patients/{patient_id}"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                data = await resp.json()
                
                if not data:
                    return None
                
                patient = data[0] if isinstance(data, list) else data
                
                return AthenaPatient(
                    patient_id=str(patient.get("patientid", "")),
                    mrn=patient.get("medicalrecordnumber", ""),
                    first_name=patient.get("firstname", ""),
                    last_name=patient.get("lastname", ""),
                    date_of_birth=patient.get("dob", ""),
                    phone=patient.get("homephone") or patient.get("mobilephone"),
                    email=patient.get("email")
                )
    
    async def search_patient(self, firstname: str, lastname: str, dob: str) -> List[AthenaPatient]:
        """Search for patients"""
        if not self.access_token:
            await self._authenticate()
        
        url = f"{self.base_url}/{self.practice_id}/patients"
        params = {
            "firstname": firstname,
            "lastname": lastname,
            "dob": dob
        }
        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, headers=headers) as resp:
                data = await resp.json()
                
                patients = []
                for p in data.get("patients", []):
                    patients.append(AthenaPatient(
                        patient_id=str(p.get("patientid", "")),
                        mrn=p.get("medicalrecordnumber", ""),
                        first_name=p.get("firstname", ""),
                        last_name=p.get("lastname", ""),
                        date_of_birth=p.get("dob", ""),
                        phone=p.get("homephone") or p.get("mobilephone"),
                        email=p.get("email")
                    ))
                
                return patients
    
    async def create_clinical_document(
        self,
        patient_id: str,
        department_id: str,
        document_type: str,
        content: str,
        internal_note: bool = False
    ) -> str:
        """
        Create clinical document in athena
        Used to write auth/denial status to chart
        """
        if not self.access_token:
            await self._authenticate()
        
        url = f"{self.base_url}/{self.practice_id}/patients/{patient_id}/documents"
        
        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        data = {
            "departmentid": department_id,
            "documentsubclass": "CLINICALDOCUMENT",
            "documenttypeid": document_type,  # "214" for prior auth notes
            "documentdata": base64.b64encode(content.encode()).decode(),
            "internalnote": "true" if internal_note else "false"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data, headers=headers) as resp:
                result = await resp.json()
                return result.get("documentid", "")
    
    async def create_order(
        self,
        patient_id: str,
        department_id: str,
        procedure_code: str,
        diagnosis_codes: List[str],
        notes: str
    ) -> str:
        """Create order in athena"""
        if not self.access_token:
            await self._authenticate()
        
        url = f"{self.base_url}/{self.practice_id}/orders"
        
        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        data = {
            "patientid": patient_id,
            "departmentid": department_id,
            "procedurecode": procedure_code,
            "diagnosiscodes": ",".join(diagnosis_codes),
            "clinicalordertypeid": "23",  # Procedure order
            "ordernote": notes
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data, headers=headers) as resp:
                result = await resp.json()
                return result.get("clinicalorderid", "")


class AthenaIntegrationManager:
    """athenahealth integration manager"""
    
    def __init__(self):
        self.clients: Dict[str, AthenaHealthClient] = {}
    
    def register_practice(
        self,
        org_id: str,
        practice_id: str,
        client_id: str,
        client_secret: str
    ):
        """Register athena practice"""
        self.clients[org_id] = AthenaHealthClient(
            practice_id=practice_id,
            client_id=client_id,
            client_secret=client_secret
        )
    
    async def sync_patient(self, org_id: str, patient_id: str) -> Optional[AthenaPatient]:
        """Sync patient from athena"""
        client = self.clients.get(org_id)
        if not client:
            return None
        return await client.get_patient(patient_id)
    
    async def write_auth_status(
        self,
        org_id: str,
        patient_id: str,
        department_id: str,
        auth_number: str,
        status: str
    ):
        """Write auth status to athena chart"""
        client = self.clients.get(org_id)
        if not client:
            return None
        
        content = f"Prior Authorization {status.upper()}\nAuth Number: {auth_number}\nProcessed by: Clinic Ops Agent\nDate: {datetime.utcnow().isoformat()}"
        
        return await client.create_clinical_document(
            patient_id=patient_id,
            department_id=department_id,
            document_type="214",  # Prior auth document type
            content=content,
            internal_note=True
        )


athena_manager = AthenaIntegrationManager()
