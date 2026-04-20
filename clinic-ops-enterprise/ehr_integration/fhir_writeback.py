"""
Direct FHIR Write-Backs
Bidirectional HL7 FHIR integration for Epic, Cerner, Athenahealth
Avoids middleware per-transaction fees
"""

import os
import json
import asyncio
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime
import aiohttp
import hashlib


@dataclass
class FHIRWritebackResult:
    """Result of FHIR write-back operation"""
    success: bool
    resource_type: str
    resource_id: Optional[str]
    status_code: int
    message: str
    timestamp: datetime
    validation_errors: List[str]


class FHIRWritebackEngine:
    """
    Direct FHIR R4 write-back engine
    Writes prior auth approvals and denial statuses directly to EHR
    """
    
    def __init__(
        self,
        epic_base_url: Optional[str] = None,
        cerner_base_url: Optional[str] = None,
        athena_base_url: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None
    ):
        self.epic_base_url = epic_base_url or os.getenv("EPIC_FHIR_URL", "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4")
        self.cerner_base_url = cerner_base_url or os.getenv("CERNER_FHIR_URL", "https://fhir-ehr.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d")
        self.athena_base_url = athena_base_url or os.getenv("ATHENA_FHIR_URL", "https://api.platform.athenahealth.com/fhir/r4")
        
        self.client_id = client_id or os.getenv("EHR_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("EHR_CLIENT_SECRET")
        
        self.access_tokens: Dict[str, str] = {}
        self.token_expiry: Dict[str, datetime] = {}
    
    async def _get_access_token(self, ehr_type: str) -> Optional[str]:
        """Get or refresh OAuth2 access token"""
        # Check if token is still valid
        if ehr_type in self.access_tokens:
            expiry = self.token_expiry.get(ehr_type)
            if expiry and expiry > datetime.utcnow():
                return self.access_tokens[ehr_type]
        
        # Get new token
        if ehr_type == "epic":
            return await self._get_epic_token()
        elif ehr_type == "cerner":
            return await self._get_cerner_token()
        elif ehr_type == "athena":
            return await self._get_athena_token()
        
        return None
    
    async def _get_epic_token(self) -> Optional[str]:
        """Get Epic OAuth2 token"""
        if not self.client_id or not self.client_secret:
            return None
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "scope": "system/*.read system/*.write"
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        token = data.get("access_token")
                        expires_in = data.get("expires_in", 3600)
                        
                        self.access_tokens["epic"] = token
                        self.token_expiry["epic"] = datetime.utcnow().timestamp() + expires_in
                        
                        return token
        except Exception as e:
            print(f"Epic token error: {e}")
        
        return None
    
    async def _get_cerner_token(self) -> Optional[str]:
        """Get Cerner OAuth2 token"""
        if not self.client_id or not self.client_secret:
            return None
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://authorization.cerner.com/tenants/ec2458f2-1e24-41c8-b71b-0e701af7583d/protocols/oauth2/profiles/smart-v1/token",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "scope": "system/*.read system/*.write"
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        token = data.get("access_token")
                        expires_in = data.get("expires_in", 3600)
                        
                        self.access_tokens["cerner"] = token
                        self.token_expiry["cerner"] = datetime.utcnow().timestamp() + expires_in
                        
                        return token
        except Exception as e:
            print(f"Cerner token error: {e}")
        
        return None
    
    async def _get_athena_token(self) -> Optional[str]:
        """Get Athenahealth OAuth2 token"""
        if not self.client_id or not self.client_secret:
            return None
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.platform.athenahealth.com/oauth2/v1/token",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        token = data.get("access_token")
                        expires_in = data.get("expires_in", 3600)
                        
                        self.access_tokens["athena"] = token
                        self.token_expiry["athena"] = datetime.utcnow().timestamp() + expires_in
                        
                        return token
        except Exception as e:
            print(f"Athena token error: {e}")
        
        return None
    
    async def write_prior_auth_approval(
        self,
        ehr_type: str,
        patient_id: str,
        auth_number: str,
        procedure_code: str,
        approved_units: int,
        effective_date: datetime,
        expiration_date: Optional[datetime] = None,
        notes: Optional[str] = None
    ) -> FHIRWritebackResult:
        """
        Write prior authorization approval back to EHR
        Creates/updates Coverage and DocumentReference resources
        """
        token = await self._get_access_token(ehr_type)
        if not token:
            return FHIRWritebackResult(
                success=False,
                resource_type="Coverage",
                resource_id=None,
                status_code=401,
                message="Failed to obtain access token",
                timestamp=datetime.utcnow(),
                validation_errors=["Authentication failed"]
            )
        
        # Build FHIR Coverage resource for prior auth
        coverage_resource = {
            "resourceType": "Coverage",
            "status": "active",
            "type": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                    "code": "priorauth",
                    "display": "Prior Authorization"
                }]
            },
            "subscriber": {"reference": f"Patient/{patient_id}"},
            "beneficiary": {"reference": f"Patient/{patient_id}"},
            "period": {
                "start": effective_date.isoformat(),
                "end": expiration_date.isoformat() if expiration_date else None
            },
            "class": [{
                "type": {
                    "coding": [{
                        "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                        "code": "authorization",
                        "display": "Authorization Number"
                    }]
                },
                "value": auth_number
            }],
            "extension": [
                {
                    "url": "http://hl7.org/fhir/us/carin-bb/StructureDefinition/CoverageProcedure",
                    "valueCodeableConcept": {
                        "coding": [{
                            "system": "http://www.ama-assn.org/go/cpt",
                            "code": procedure_code
                        }]
                    }
                },
                {
                    "url": "http://hl7.org/fhir/us/carin-bb/StructureDefinition/CoverageApprovedUnits",
                    "valueInteger": approved_units
                }
            ]
        }
        
        if notes:
            coverage_resource["extension"].append({
                "url": "http://hl7.org/fhir/StructureDefinition/coverage-notes",
                "valueString": notes
            })
        
        # Send to EHR
        base_url = getattr(self, f"{ehr_type}_base_url")
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{base_url}/Coverage",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/fhir+json"
                    },
                    json=coverage_resource
                ) as resp:
                    response_text = await resp.text()
                    
                    if resp.status in [200, 201]:
                        data = json.loads(response_text)
                        resource_id = data.get("id")
                        
                        # Also create DocumentReference for the auth letter
                        await self._create_auth_document_reference(
                            ehr_type, token, patient_id, auth_number, notes
                        )
                        
                        return FHIRWritebackResult(
                            success=True,
                            resource_type="Coverage",
                            resource_id=resource_id,
                            status_code=resp.status,
                            message="Prior authorization approval written successfully",
                            timestamp=datetime.utcnow(),
                            validation_errors=[]
                        )
                    else:
                        return FHIRWritebackResult(
                            success=False,
                            resource_type="Coverage",
                            resource_id=None,
                            status_code=resp.status,
                            message=f"Write failed: {response_text}",
                            timestamp=datetime.utcnow(),
                            validation_errors=[f"HTTP {resp.status}: {response_text[:200]}"]
                        )
                        
        except Exception as e:
            return FHIRWritebackResult(
                success=False,
                resource_type="Coverage",
                resource_id=None,
                status_code=500,
                message=f"Exception: {str(e)}",
                timestamp=datetime.utcnow(),
                validation_errors=[str(e)]
            )
    
    async def _create_auth_document_reference(
        self,
        ehr_type: str,
        token: str,
        patient_id: str,
        auth_number: str,
        notes: Optional[str]
    ):
        """Create DocumentReference for authorization documentation"""
        base_url = getattr(self, f"{ehr_type}_base_url")
        
        doc_ref = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "57133-1",
                    "display": "Prior authorization document"
                }]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "date": datetime.utcnow().isoformat(),
            "description": f"Prior Authorization Approval: {auth_number}",
            "content": [{
                "attachment": {
                    "title": f"Auth {auth_number}",
                    "contentType": "text/plain",
                    "data": notes.encode().hex() if notes else b"Approved".hex()
                }
            }]
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{base_url}/DocumentReference",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/fhir+json"
                    },
                    json=doc_ref
                )
        except Exception:
            pass  # Non-critical
    
    async def write_denial_status(
        self,
        ehr_type: str,
        patient_id: str,
        claim_id: str,
        denial_reason: str,
        denial_code: str,
        service_date: datetime,
        appeal_deadline: Optional[datetime] = None,
        appeal_instructions: Optional[str] = None
    ) -> FHIRWritebackResult:
        """
        Write denial status back to EHR
        Creates Task and DocumentReference resources
        """
        token = await self._get_access_token(ehr_type)
        if not token:
            return FHIRWritebackResult(
                success=False,
                resource_type="Task",
                resource_id=None,
                status_code=401,
                message="Failed to obtain access token",
                timestamp=datetime.utcnow(),
                validation_errors=["Authentication failed"]
            )
        
        base_url = getattr(self, f"{ehr_type}_base_url")
        
        # Create Task for denial follow-up
        task_resource = {
            "resourceType": "Task",
            "status": "requested",
            "intent": "order",
            "priority": "urgent",
            "code": {
                "coding": [{
                    "system": "http://hl7.org/fhir/CodeSystem/task-code",
                    "code": "fulfill",
                    "display": "Fulfill the focal request"
                }]
            },
            "description": f"Claim Denied: {denial_reason}",
            "for": {"reference": f"Patient/{patient_id}"},
            "authoredOn": datetime.utcnow().isoformat(),
            "executionPeriod": {
                "start": service_date.isoformat()
            },
            "input": [
                {
                    "type": {
                        "coding": [{
                            "system": "http://terminology.hl7.org/CodeSystem/v2-0278",
                            "code": "DEN",
                            "display": "Denied"
                        }]
                    },
                    "valueString": denial_code
                },
                {
                    "type": {
                        "text": "Denial Reason"
                    },
                    "valueString": denial_reason
                }
            ],
            "note": [{
                "text": f"Denial requires appeal. Deadline: {appeal_deadline.isoformat() if appeal_deadline else 'Check payer portal'}"
            }]
        }
        
        if appeal_instructions:
            task_resource["note"].append({
                "text": f"Appeal Instructions: {appeal_instructions}"
            })
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{base_url}/Task",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/fhir+json"
                    },
                    json=task_resource
                ) as resp:
                    response_text = await resp.text()
                    
                    if resp.status in [200, 201]:
                        data = json.loads(response_text)
                        task_id = data.get("id")
                        
                        # Create denial letter DocumentReference
                        await self._create_denial_document_reference(
                            ehr_type, token, patient_id, claim_id, denial_reason, denial_code
                        )
                        
                        return FHIRWritebackResult(
                            success=True,
                            resource_type="Task",
                            resource_id=task_id,
                            status_code=resp.status,
                            message="Denial status written successfully",
                            timestamp=datetime.utcnow(),
                            validation_errors=[]
                        )
                    else:
                        return FHIRWritebackResult(
                            success=False,
                            resource_type="Task",
                            resource_id=None,
                            status_code=resp.status,
                            message=f"Write failed: {response_text}",
                            timestamp=datetime.utcnow(),
                            validation_errors=[f"HTTP {resp.status}: {response_text[:200]}"]
                        )
                        
        except Exception as e:
            return FHIRWritebackResult(
                success=False,
                resource_type="Task",
                resource_id=None,
                status_code=500,
                message=f"Exception: {str(e)}",
                timestamp=datetime.utcnow(),
                validation_errors=[str(e)]
            )
    
    async def _create_denial_document_reference(
        self,
        ehr_type: str,
        token: str,
        patient_id: str,
        claim_id: str,
        denial_reason: str,
        denial_code: str
    ):
        """Create DocumentReference for denial documentation"""
        base_url = getattr(self, f"{ehr_type}_base_url")
        
        doc_ref = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "11502-2",
                    "display": "Claim denial letter"
                }]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "date": datetime.utcnow().isoformat(),
            "description": f"Claim Denial - {denial_code}",
            "content": [{
                "attachment": {
                    "title": f"Denial Notice - Claim {claim_id}",
                    "contentType": "text/plain",
                    "data": f"Denial Code: {denial_code}\nReason: {denial_reason}".encode().hex()
                }
            }]
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{base_url}/DocumentReference",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/fhir+json"
                    },
                    json=doc_ref
                )
        except Exception:
            pass
    
    async def write_appeal_confirmation(
        self,
        ehr_type: str,
        patient_id: str,
        appeal_id: str,
        original_claim_id: str,
        appeal_status: str,  # "submitted", "pending", "approved", "denied"
        appeal_date: datetime,
        confirmation_number: Optional[str] = None,
        notes: Optional[str] = None
    ) -> FHIRWritebackResult:
        """
        Write appeal submission confirmation to EHR
        """
        token = await self._get_access_token(ehr_type)
        if not token:
            return FHIRWritebackResult(
                success=False,
                resource_type="Communication",
                resource_id=None,
                status_code=401,
                message="Failed to obtain access token",
                timestamp=datetime.utcnow(),
                validation_errors=["Authentication failed"]
            )
        
        base_url = getattr(self, f"{ehr_type}_base_url")
        
        # Create Communication resource for appeal update
        communication = {
            "resourceType": "Communication",
            "status": "completed",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/communication-category",
                    "code": "notification",
                    "display": "Notification"
                }]
            }],
            "subject": {"reference": f"Patient/{patient_id}"},
            "sent": appeal_date.isoformat(),
            "payload": [
                {
                    "contentString": f"Appeal {appeal_status}: {appeal_id}"
                }
            ],
            "note": [{
                "text": notes or f"Appeal for claim {original_claim_id} has been {appeal_status}"
            }]
        }
        
        if confirmation_number:
            communication["identifier"] = [{
                "system": "http://clinic-ops/appeal-confirmation",
                "value": confirmation_number
            }]
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{base_url}/Communication",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/fhir+json"
                    },
                    json=communication
                ) as resp:
                    response_text = await resp.text()
                    
                    if resp.status in [200, 201]:
                        data = json.loads(response_text)
                        return FHIRWritebackResult(
                            success=True,
                            resource_type="Communication",
                            resource_id=data.get("id"),
                            status_code=resp.status,
                            message="Appeal confirmation written successfully",
                            timestamp=datetime.utcnow(),
                            validation_errors=[]
                        )
                    else:
                        return FHIRWritebackResult(
                            success=False,
                            resource_type="Communication",
                            resource_id=None,
                            status_code=resp.status,
                            message=f"Write failed: {response_text}",
                            timestamp=datetime.utcnow(),
                            validation_errors=[f"HTTP {resp.status}: {response_text[:200]}"]
                        )
                        
        except Exception as e:
            return FHIRWritebackResult(
                success=False,
                resource_type="Communication",
                resource_id=None,
                status_code=500,
                message=f"Exception: {str(e)}",
                timestamp=datetime.utcnow(),
                validation_errors=[str(e)]
            )
    
    async def batch_write_updates(
        self,
        ehr_type: str,
        updates: List[Dict[str, Any]]
    ) -> List[FHIRWritebackResult]:
        """
        Batch write multiple updates
        More efficient than individual writes
        """
        results = []
        
        # Process in parallel (with reasonable concurrency limit)
        semaphore = asyncio.Semaphore(5)
        
        async def write_with_limit(update):
            async with semaphore:
                update_type = update.get("type")
                
                if update_type == "prior_auth_approval":
                    return await self.write_prior_auth_approval(
                        ehr_type=ehr_type,
                        patient_id=update["patient_id"],
                        auth_number=update["auth_number"],
                        procedure_code=update["procedure_code"],
                        approved_units=update["approved_units"],
                        effective_date=update["effective_date"],
                        expiration_date=update.get("expiration_date"),
                        notes=update.get("notes")
                    )
                elif update_type == "denial":
                    return await self.write_denial_status(
                        ehr_type=ehr_type,
                        patient_id=update["patient_id"],
                        claim_id=update["claim_id"],
                        denial_reason=update["denial_reason"],
                        denial_code=update["denial_code"],
                        service_date=update["service_date"],
                        appeal_deadline=update.get("appeal_deadline"),
                        appeal_instructions=update.get("appeal_instructions")
                    )
                elif update_type == "appeal":
                    return await self.write_appeal_confirmation(
                        ehr_type=ehr_type,
                        patient_id=update["patient_id"],
                        appeal_id=update["appeal_id"],
                        original_claim_id=update["original_claim_id"],
                        appeal_status=update["appeal_status"],
                        appeal_date=update["appeal_date"],
                        confirmation_number=update.get("confirmation_number"),
                        notes=update.get("notes")
                    )
                else:
                    return FHIRWritebackResult(
                        success=False,
                        resource_type="Unknown",
                        resource_id=None,
                        status_code=400,
                        message=f"Unknown update type: {update_type}",
                        timestamp=datetime.utcnow(),
                        validation_errors=["Invalid update type"]
                    )
        
        # Execute all writes
        tasks = [write_with_limit(u) for u in updates]
        results = await asyncio.gather(*tasks)
        
        return list(results)


# Global instance
fhir_writeback_engine = FHIRWritebackEngine()
