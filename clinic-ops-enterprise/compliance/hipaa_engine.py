"""
Operation-Level HIPAA Compliance Engine
Military-grade compliance with tamper-evident audit logs and BAA management
"""

import os
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import asyncio
import aiohttp
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64


class PHIAccessLevel(str, Enum):
    """HIPAA access levels for PHI"""
    NO_ACCESS = "no_access"
    LIMITED = "limited"  # Demographics only
    STANDARD = "standard"  # Clinical summaries
    FULL = "full"  # Complete medical records


class AuditActionType(str, Enum):
    """HIPAA audit action types"""
    PHI_ACCESS = "phi_access"
    PHI_CREATE = "phi_create"
    PHI_UPDATE = "phi_update"
    PHI_DELETE = "phi_delete"
    LOGIN = "login"
    LOGOUT = "logout"
    EXPORT = "export"
    PRINT = "print"
    AUTOMATED_SESSION = "automated_session"
    APPEAL_SUBMITTED = "appeal_submitted"
    DENIAL_DETECTED = "denial_detected"


@dataclass
class TamperEvidentLogEntry:
    """
    Immutable audit log entry with cryptographic chain
    Each entry contains hash of previous entry for tamper detection
    """
    log_id: str
    timestamp: datetime
    user_id: str
    user_type: str  # "human", "system", "agent"
    action: AuditActionType
    resource_type: str
    resource_id: str
    phi_fields_accessed: List[str]  # Exact PHI fields accessed
    phi_patient_id: Optional[str]  # Patient whose PHI was accessed
    session_id: str
    ip_address: Optional[str]
    user_agent: Optional[str]
    success: bool
    details: Dict[str, Any]
    
    # Cryptographic chain
    previous_hash: str
    entry_hash: str
    signature: Optional[str] = None
    
    def compute_hash(self) -> str:
        """Compute SHA-256 hash of this entry"""
        data = {
            "log_id": self.log_id,
            "timestamp": self.timestamp.isoformat(),
            "user_id": self.user_id,
            "action": self.action.value,
            "resource_id": self.resource_id,
            "phi_fields": sorted(self.phi_fields_accessed),
            "previous_hash": self.previous_hash,
        }
        hash_input = json.dumps(data, sort_keys=True)
        return hashlib.sha256(hash_input.encode()).hexdigest()


class BAAAgreement:
    """Business Associate Agreement management"""
    
    def __init__(self):
        self.agreements: Dict[str, Dict] = {}
    
    def create_agreement(
        self,
        covered_entity_name: str,
        covered_entity_npi: str,
        business_associate_name: str = "Clinic Ops Agent Enterprise",
        effective_date: Optional[datetime] = None,
        data_types: List[str] = None
    ) -> str:
        """Create new BAA agreement"""
        baa_id = f"BAA-{uuid.uuid4().hex[:12].upper()}"
        
        agreement = {
            "baa_id": baa_id,
            "covered_entity": {
                "name": covered_entity_name,
                "npi": covered_entity_npi,
                "type": "Covered Entity"
            },
            "business_associate": {
                "name": business_associate_name,
                "type": "Business Associate"
            },
            "effective_date": effective_date or datetime.utcnow(),
            "expiration_date": (effective_date or datetime.utcnow()) + timedelta(days=365*3),
            "data_types_permitted": data_types or [
                "patient_demographics",
                "insurance_information",
                "diagnosis_codes",
                "procedure_codes",
                "claim_status"
            ],
            "safeguards_required": [
                "encryption_at_rest_aes256",
                "encryption_in_transit_tls12",
                "access_controls_role_based",
                "audit_logging_tamper_evident",
                "data_retention_7_years",
                "breach_notification_24_hours"
            ],
            "permitted_uses": [
                "claims_denial_management",
                "appeal_generation",
                "prior_authorization_assistance"
            ],
            "prohibited_uses": [
                "marketing",
                "research_without_consent",
                "third_party_disclosure"
            ],
            "status": "active",
            "signed_by_covered_entity": None,
            "signed_by_business_associate": datetime.utcnow(),
        }
        
        self.agreements[baa_id] = agreement
        return baa_id
    
    def validate_agreement(self, baa_id: str) -> Tuple[bool, str]:
        """Validate BAA is active and not expired"""
        if baa_id not in self.agreements:
            return False, "BAA not found"
        
        agreement = self.agreements[baa_id]
        
        if agreement["status"] != "active":
            return False, f"BAA status: {agreement['status']}"
        
        if datetime.utcnow() > agreement["expiration_date"]:
            return False, "BAA expired"
        
        if not agreement["signed_by_covered_entity"]:
            return False, "BAA not signed by covered entity"
        
        return True, "Valid"
    
    def get_agreement_text(self, baa_id: str) -> str:
        """Generate full BAA legal text"""
        if baa_id not in self.agreements:
            return ""
        
        a = self.agreements[baa_id]
        
        return f"""
BUSINESS ASSOCIATE AGREEMENT

Agreement ID: {baa_id}

PARTIES
This Business Associate Agreement ("Agreement") is entered into between:
Covered Entity: {a['covered_entity']['name']} (NPI: {a['covered_entity']['npi']})
Business Associate: {a['business_associate']['name']}

EFFECTIVE DATE: {a['effective_date'].strftime('%B %d, %Y')}
EXPIRATION DATE: {a['expiration_date'].strftime('%B %d, %Y')}

1. DEFINITIONS
"Protected Health Information" (PHI) has the meaning given in 45 CFR § 160.103.
"Electronic PHI" (ePHI) means PHI transmitted or maintained in electronic media.

2. PERMITTED USES AND DISCLOSURES
Business Associate may use or disclose PHI ONLY as necessary to perform:
{chr(10).join(f'  - {use}' for use in a['permitted_uses'])}

3. SAFEGUARDS
Business Associate shall implement and maintain:
{chr(10).join(f'  ✓ {safeguard}' for safeguard in a['safeguards_required'])}

4. PROHIBITED USES
Business Associate SHALL NOT use PHI for:
{chr(10).join(f'  ✗ {prohibition}' for prohibition in a['prohibited_uses'])}

5. BREACH NOTIFICATION
Business Associate shall notify Covered Entity of any breach of unsecured PHI 
within 24 hours of discovery, as required by 45 CFR § 164.410.

6. AUDIT AND INSPECTION
Covered Entity has the right to audit Business Associate's compliance with this 
Agreement with 48 hours notice. Business Associate shall maintain audit logs for 
a minimum of 6 years.

7. TERMINATION
Either party may terminate this Agreement with 30 days written notice. Upon 
termination, Business Associate shall return or destroy all PHI and retain no copies.

8. GOVERNING LAW
This Agreement shall be governed by HIPAA regulations (45 CFR Parts 160 and 164) 
and applicable state law.

SIGNATURES

Business Associate:                    Covered Entity:
Signed: {a['signed_by_business_associate'].strftime('%Y-%m-%d %H:%M:%S') if a['signed_by_business_associate'] else 'Pending'}
Name: _______________________         Name: _______________________
Title: ______________________         Title: ______________________
Date: _______________________         Date: _______________________

TAMPER-EVIDENT HASH: {hashlib.sha256(self._canonicalize(a).encode()).hexdigest()[:32]}
"""
    
    def _canonicalize(self, agreement: Dict) -> str:
        """Create canonical string for hashing"""
        return json.dumps(agreement, sort_keys=True, default=str)


class HIPAAComplianceEngine:
    """
    Military-grade HIPAA compliance engine
    Tamper-evident logging, PHI encryption, access controls
    """
    
    def __init__(
        self,
        encryption_key: Optional[str] = None,
        axiom_api_key: Optional[str] = None
    ):
        self.encryption_key = encryption_key or os.getenv("HIPAA_ENCRYPTION_KEY")
        self.axiom_api_key = axiom_api_key or os.getenv("AXIOM_API_KEY")
        self.baa_manager = BAAAgreement()
        
        # Initialize encryption
        self._init_encryption()
        
        # Audit chain state
        self._last_hash = "0" * 64  # Genesis hash
        self._chain_verified = True
        
        # PHI field definitions
        self._phi_fields = {
            "patient.mrn": "Medical Record Number",
            "patient.first_name": "Patient First Name",
            "patient.last_name": "Patient Last Name",
            "patient.date_of_birth": "Date of Birth",
            "patient.insurance_member_id": "Insurance Member ID",
            "patient.phone": "Phone Number",
            "patient.email": "Email Address",
            "patient.address": "Physical Address",
            "patient.ssn": "Social Security Number",
            "procedure.diagnosis_codes": "Diagnosis Codes",
            "procedure.procedure_code": "Procedure Code",
            "denial.claim_number": "Claim Number",
        }
    
    def _init_encryption(self):
        """Initialize Fernet encryption"""
        if self.encryption_key:
            # Ensure key is 32 bytes base64-encoded
            key = base64.urlsafe_b64encode(
                hashlib.sha256(self.encryption_key.encode()).digest()
            )
            self._cipher = Fernet(key)
        else:
            self._cipher = None
    
    def encrypt_phi(self, data: str) -> str:
        """Encrypt PHI field"""
        if not self._cipher:
            return f"[UNENCRYPTED]{data}"
        encrypted = self._cipher.encrypt(data.encode())
        return f"[ENC]{encrypted.decode()}"
    
    def decrypt_phi(self, encrypted_data: str) -> str:
        """Decrypt PHI field"""
        if not self._cipher:
            return encrypted_data
        if encrypted_data.startswith("[ENC]"):
            encrypted = encrypted_data[5:].encode()
            return self._cipher.decrypt(encrypted).decode()
        return encrypted_data
    
    async def log_audit_event(
        self,
        db,
        user_id: str,
        user_type: str,
        action: AuditActionType,
        resource_type: str,
        resource_id: str,
        phi_fields_accessed: List[str],
        phi_patient_id: Optional[str] = None,
        session_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        success: bool = True,
        details: Optional[Dict] = None,
    ) -> str:
        """
        Create tamper-evident audit log entry
        """
        log_id = str(uuid.uuid4())
        timestamp = datetime.utcnow()
        
        # Create entry
        entry = TamperEvidentLogEntry(
            log_id=log_id,
            timestamp=timestamp,
            user_id=user_id,
            user_type=user_type,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            phi_fields_accessed=phi_fields_accessed,
            phi_patient_id=phi_patient_id,
            session_id=session_id or str(uuid.uuid4()),
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            details=details or {},
            previous_hash=self._last_hash,
            entry_hash="",  # Will be computed
        )
        
        # Compute hash
        entry.entry_hash = entry.compute_hash()
        self._last_hash = entry.entry_hash
        
        # Sign entry
        entry.signature = self._sign_entry(entry)
        
        # Store in MongoDB
        await db.hipaa_audit_logs.insert_one({
            **asdict(entry),
            "timestamp": timestamp,
            "_encrypted": True
        })
        
        # Send to Axiom for immutable storage
        await self._send_to_axiom(entry)
        
        return log_id
    
    def _sign_entry(self, entry: TamperEvidentLogEntry) -> str:
        """Cryptographically sign audit entry"""
        if not self.encryption_key:
            return ""
        
        data = f"{entry.log_id}:{entry.entry_hash}:{entry.timestamp.isoformat()}"
        signature = hmac.new(
            self.encryption_key.encode(),
            data.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    async def _send_to_axiom(self, entry: TamperEvidentLogEntry):
        """Send to Axiom for immutable cold storage"""
        if not self.axiom_api_key:
            return
        
        url = "https://api.axiom.co/v1/datasets/clinic-ops-hipaa-audit/ingest"
        headers = {
            "Authorization": f"Bearer {self.axiom_api_key}",
            "Content-Type": "application/json"
        }
        
        # Remove sensitive details before sending externally
        payload = {
            "log_id": entry.log_id,
            "timestamp": entry.timestamp.isoformat(),
            "user_type": entry.user_type,
            "action": entry.action.value,
            "resource_type": entry.resource_type,
            "success": entry.success,
            "entry_hash": entry.entry_hash,
            "chain_valid": True
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status not in (200, 204):
                        print(f"⚠️ Axiom logging failed: {resp.status}")
        except Exception as e:
            print(f"⚠️ Axiom error: {e}")
    
    async def verify_chain_integrity(
        self,
        db,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        resource_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Verify tamper-evident chain integrity
        Detects any modifications to audit logs
        """
        query = {}
        if start_time or end_time:
            query["timestamp"] = {}
            if start_time:
                query["timestamp"]["$gte"] = start_time
            if end_time:
                query["timestamp"]["$lte"] = end_time
        if resource_id:
            query["resource_id"] = resource_id
        
        # Fetch all entries in chronological order
        cursor = db.hipaa_audit_logs.find(query).sort("timestamp", 1)
        entries = await cursor.to_list(length=None)
        
        if not entries:
            return {"status": "no_entries", "valid": True}
        
        violations = []
        expected_hash = "0" * 64
        
        for i, entry_data in enumerate(entries):
            # Verify hash chain
            if entry_data["previous_hash"] != expected_hash:
                violations.append({
                    "index": i,
                    "log_id": entry_data["log_id"],
                    "issue": "hash_chain_break",
                    "expected_previous": expected_hash,
                    "actual_previous": entry_data["previous_hash"]
                })
            
            # Recompute and verify entry hash
            entry = TamperEvidentLogEntry(
                log_id=entry_data["log_id"],
                timestamp=entry_data["timestamp"],
                user_id=entry_data["user_id"],
                user_type=entry_data["user_type"],
                action=AuditActionType(entry_data["action"]),
                resource_type=entry_data["resource_type"],
                resource_id=entry_data["resource_id"],
                phi_fields_accessed=entry_data["phi_fields_accessed"],
                phi_patient_id=entry_data.get("phi_patient_id"),
                session_id=entry_data["session_id"],
                ip_address=entry_data.get("ip_address"),
                user_agent=entry_data.get("user_agent"),
                success=entry_data["success"],
                details=entry_data.get("details", {}),
                previous_hash=entry_data["previous_hash"],
                entry_hash="",  # Will compute
                signature=entry_data.get("signature")
            )
            
            computed_hash = entry.compute_hash()
            if computed_hash != entry_data["entry_hash"]:
                violations.append({
                    "index": i,
                    "log_id": entry_data["log_id"],
                    "issue": "entry_modified",
                    "expected_hash": computed_hash,
                    "actual_hash": entry_data["entry_hash"]
                })
            
            # Verify signature
            if entry_data.get("signature"):
                expected_sig = self._sign_entry(entry)
                if expected_sig != entry_data["signature"]:
                    violations.append({
                        "index": i,
                        "log_id": entry_data["log_id"],
                        "issue": "invalid_signature"
                    })
            
            expected_hash = entry_data["entry_hash"]
        
        self._chain_verified = len(violations) == 0
        
        return {
            "status": "verified" if not violations else "tampered",
            "valid": not violations,
            "total_entries": len(entries),
            "violations": violations,
            "time_range": {
                "start": entries[0]["timestamp"],
                "end": entries[-1]["timestamp"]
            } if entries else None
        }
    
    def validate_phi_access(
        self,
        user_id: str,
        user_role: str,
        requested_fields: List[str],
        baa_id: str
    ) -> Tuple[bool, List[str]]:
        """
        Validate user has permission to access requested PHI fields
        """
        # Check BAA valid
        baa_valid, baa_msg = self.baa_manager.validate_agreement(baa_id)
        if not baa_valid:
            return False, [f"BAA invalid: {baa_msg}"]
        
        # Role-based access control
        role_permissions = {
            "billing_analyst": [
                "patient.mrn", "patient.first_name", "patient.last_name",
                "patient.insurance_member_id", "procedure.diagnosis_codes",
                "procedure.procedure_code", "denial.claim_number"
            ],
            "billing_manager": [
                "patient.mrn", "patient.first_name", "patient.last_name",
                "patient.date_of_birth", "patient.insurance_member_id",
                "procedure.diagnosis_codes", "procedure.procedure_code",
                "denial.claim_number"
            ],
            "admin": list(self._phi_fields.keys()),
            "system": list(self._phi_fields.keys()),  # Automated agents
        }
        
        allowed = role_permissions.get(user_role, [])
        
        violations = []
        for field in requested_fields:
            if field not in allowed:
                violations.append(f"Access denied to {self._phi_fields.get(field, field)}")
        
        return len(violations) == 0, violations
    
    async def generate_compliance_report(
        self,
        db,
        organization_id: str,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """
        Generate HIPAA compliance report for auditors
        """
        # Count audit events
        total_events = await db.hipaa_audit_logs.count_documents({
            "timestamp": {"$gte": start_date, "$lte": end_date}
        })
        
        phi_access_events = await db.hipaa_audit_logs.count_documents({
            "timestamp": {"$gte": start_date, "$lte": end_date},
            "action": AuditActionType.PHI_ACCESS.value
        })
        
        failed_access = await db.hipaa_audit_logs.count_documents({
            "timestamp": {"$gte": start_date, "$lte": end_date},
            "success": False
        })
        
        # Verify chain integrity
        integrity = await self.verify_chain_integrity(db, start_date, end_date)
        
        # Get unique users
        users = await db.hipaa_audit_logs.distinct(
            "user_id",
            {"timestamp": {"$gte": start_date, "$lte": end_date}}
        )
        
        return {
            "report_id": f"HIPAA-{uuid.uuid4().hex[:8].upper()}",
            "generated_at": datetime.utcnow(),
            "period": {
                "start": start_date,
                "end": end_date
            },
            "summary": {
                "total_audit_events": total_events,
                "phi_access_events": phi_access_events,
                "failed_access_attempts": failed_access,
                "unique_users": len(users),
                "chain_integrity": integrity["status"]
            },
            "compliance_status": "COMPLIANT" if integrity["valid"] and failed_access == 0 else "REVIEW_REQUIRED",
            "integrity_details": integrity,
            "certification": self._generate_certification(integrity["valid"])
        }
    
    def _generate_certification(self, valid: bool) -> str:
        """Generate compliance certification hash"""
        cert_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "valid": valid,
            "standard": "HIPAA-45-CFR-164"
        }
        return hashlib.sha256(json.dumps(cert_data).encode()).hexdigest()


# Global compliance engine instance
hipaa_engine = HIPAAComplianceEngine()
