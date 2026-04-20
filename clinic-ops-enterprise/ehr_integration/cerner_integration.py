"""
Cerner EHR Integration - FHIR R4 API
Supports PowerChart and Millennium workflows
"""

import os
import json
import base64
from datetime import datetime
from typing import Dict, List, Optional, Any
import aiohttp
from dataclasses import dataclass


@dataclass
class CernerPatient:
    """Patient from Cerner"""
    patient_id: str
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: str
    gender: str
    phone: Optional[str]
    email: Optional[str]
    insurance_member_id: Optional[str]


class CernerFHIRClient:
    """Cerner Millennium FHIR Client"""
    
    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        tenant_id: str
    ):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id
        self.client_secret = client_secret
        self.tenant_id = tenant_id
        self.access_token: Optional[str] = None
    
    async def _authenticate(self):
        """OAuth 2.0 authentication"""
        url = f"{self.base_url}/oauth2/token"
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "system/Patient.read system/Encounter.read system/DocumentReference.write"
                }
            ) as resp:
                data = await resp.json()
                self.access_token = data["access_token"]
    
    async def get_patient_by_mrn(self, mrn: str) -> Optional[CernerPatient]:
        """Search patient by MRN"""
        if not self.access_token:
            await self._authenticate()
        
        url = f"{self.base_url}/Patient?identifier={mrn}"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                data = await resp.json()
                
                if not data.get("entry"):
                    return None
                
                p = data["entry"][0]["resource"]
                name = p.get("name", [{}])[0]
                
                return CernerPatient(
                    patient_id=p["id"],
                    mrn=mrn,
                    first_name=name.get("given", [""])[0],
                    last_name=name.get("family", ""),
                    date_of_birth=p.get("birthDate", ""),
                    gender=p.get("gender", ""),
                    phone=None,
                    email=None,
                    insurance_member_id=None
                )
    
    async def write_prior_auth_result(
        self,
        patient_id: str,
        auth_number: str,
        status: str,
        notes: str
    ):
        """Write prior auth result to Cerner"""
        if not self.access_token:
            await self._authenticate()
        
        doc = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "51848-7"
                }]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "content": [{
                "attachment": {
                    "contentType": "application/json",
                    "data": base64.b64encode(json.dumps({
                        "auth_number": auth_number,
                        "status": status,
                        "notes": notes,
                        "source": "Clinic Ops Agent"
                    }).encode()).decode()
                }
            }]
        }
        
        url = f"{self.base_url}/DocumentReference"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/fhir+json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=doc) as resp:
                result = await resp.json()
                return result.get("id")


class CernerIntegrationManager:
    """Cerner integration manager"""
    
    def __init__(self):
        self.clients: Dict[str, CernerFHIRClient] = {}
    
    def register_organization(
        self,
        org_id: str,
        cerner_url: str,
        client_id: str,
        client_secret: str,
        tenant_id: str
    ):
        """Register Cerner connection"""
        self.clients[org_id] = CernerFHIRClient(
            base_url=cerner_url,
            client_id=client_id,
            client_secret=client_secret,
            tenant_id=tenant_id
        )
    
    async def sync_patient(self, org_id: str, mrn: str) -> Optional[CernerPatient]:
        """Sync patient from Cerner"""
        client = self.clients.get(org_id)
        if not client:
            return None
        return await client.get_patient_by_mrn(mrn)


cerner_manager = CernerIntegrationManager()
