"""
HIPAA-Compliant Audit Logging with Tamper-Evident Chain
Axiom integration for external audit storage
"""

import os
import hashlib
import json
from datetime import datetime
from typing import Dict, Any, Optional
from dataclasses import asdict
import aiohttp


class AuditLogger:
    """
    HIPAA-compliant audit logger with tamper-evident chain
    Dual logging: MongoDB (hot) + Axiom (cold/archive)
    """
    
    def __init__(
        self,
        db,
        axiom_api_key: Optional[str] = None,
        axiom_dataset: str = "clinic-ops-audit"
    ):
        self.db = db
        self.axiom_api_key = axiom_api_key or os.getenv("AXIOM_API_KEY")
        self.axiom_dataset = axiom_dataset
        self.axiom_url = "https://api.axiom.co/v1/datasets"
        self._last_hash: str = "0" * 64  # Genesis hash
    
    async def log_action(
        self,
        actor_type: str,
        actor_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        changes: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> str:
        """
        Log an audit event with tamper-evident hashing
        """
        timestamp = datetime.utcnow()
        
        # Build audit entry
        audit_entry = {
            "timestamp": timestamp,
            "action": action,
            "actor_type": actor_type,
            "actor_id": actor_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "changes": changes or {},
            "ip_address": ip_address,
            "session_id": session_id,
        }
        
        # Calculate hash chain
        audit_entry["hash_chain"] = self._calculate_hash(audit_entry)
        self._last_hash = audit_entry["hash_chain"]
        
        # Store in MongoDB (hot storage)
        result = await self.db.audit_logs.insert_one(audit_entry)
        audit_id = str(result.inserted_id)
        
        # Send to Axiom (cold storage for compliance)
        await self._send_to_axiom({
            "audit_id": audit_id,
            **audit_entry
        })
        
        return audit_id
    
    def _calculate_hash(self, entry: Dict[str, Any]) -> str:
        """
        Calculate tamper-evident hash for the audit entry
        Includes previous hash for chain integrity
        """
        # Create string to hash
        hash_input = {
            "timestamp": entry["timestamp"].isoformat() if isinstance(entry["timestamp"], datetime) else entry["timestamp"],
            "action": entry["action"],
            "actor_id": entry["actor_id"],
            "resource_id": entry["resource_id"],
            "changes": json.dumps(entry.get("changes", {}), sort_keys=True),
            "previous_hash": self._last_hash
        }
        
        # Calculate SHA-256 hash
        hash_string = json.dumps(hash_input, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()
    
    async def _send_to_axiom(self, audit_entry: Dict[str, Any]):
        """
        Send audit entry to Axiom for long-term storage
        """
        if not self.axiom_api_key:
            return  # Skip if no Axiom API key
        
        headers = {
            "Authorization": f"Bearer {self.axiom_api_key}",
            "Content-Type": "application/json"
        }
        
        # Convert datetime to ISO format for JSON serialization
        payload = {k: self._serialize(v) for k, v in audit_entry.items()}
        
        url = f"{self.axiom_url}/{self.axiom_dataset}/ingest"
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=payload,
                    headers=headers
                ) as resp:
                    if resp.status not in (200, 204):
                        print(f"⚠️  Axiom logging failed: {resp.status}")
        except Exception as e:
            print(f"⚠️  Axiom logging error: {e}")
            # Don't raise - audit logging should not break the application
    
    def _serialize(self, value: Any) -> Any:
        """Serialize values for JSON"""
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, dict):
            return {k: self._serialize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._serialize(v) for v in value]
        return value
    
    async def verify_chain_integrity(
        self,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Verify tamper-evident chain integrity
        Returns verification report
        """
        # Build query
        query = {}
        if resource_type:
            query["resource_type"] = resource_type
        if resource_id:
            query["resource_id"] = resource_id
        if start_time or end_time:
            query["timestamp"] = {}
            if start_time:
                query["timestamp"]["$gte"] = start_time
            if end_time:
                query["timestamp"]["$lte"] = end_time
        
        # Fetch audit entries
        cursor = self.db.audit_logs.find(query).sort("timestamp", 1)
        entries = await cursor.to_list(length=None)
        
        if not entries:
            return {"status": "no_entries", "verified": True}
        
        # Verify chain
        violations = []
        previous_hash = "0" * 64
        
        for i, entry in enumerate(entries):
            # Verify hash
            hash_input = {
                "timestamp": entry["timestamp"].isoformat(),
                "action": entry["action"],
                "actor_id": entry["actor_id"],
                "resource_id": entry["resource_id"],
                "changes": json.dumps(entry.get("changes", {}), sort_keys=True),
                "previous_hash": previous_hash
            }
            
            expected_hash = hashlib.sha256(
                json.dumps(hash_input, sort_keys=True).encode()
            ).hexdigest()
            
            if entry.get("hash_chain") != expected_hash:
                violations.append({
                    "index": i,
                    "entry_id": str(entry.get("_id")),
                    "expected_hash": expected_hash,
                    "actual_hash": entry.get("hash_chain"),
                    "timestamp": entry["timestamp"]
                })
            
            previous_hash = entry.get("hash_chain", "0" * 64)
        
        return {
            "status": "verified" if not violations else "tampered",
            "verified": not violations,
            "total_entries": len(entries),
            "violations": violations,
            "time_range": {
                "start": entries[0]["timestamp"] if entries else None,
                "end": entries[-1]["timestamp"] if entries else None
            }
        }
    
    async def get_audit_trail(
        self,
        resource_type: str,
        resource_id: str,
        limit: int = 100
    ) -> list:
        """
        Get complete audit trail for a resource
        """
        cursor = self.db.audit_logs.find({
            "resource_type": resource_type,
            "resource_id": resource_id
        }).sort("timestamp", -1).limit(limit)
        
        entries = await cursor.to_list(length=limit)
        
        return [
            {
                "audit_id": str(entry.get("_id")),
                "timestamp": entry["timestamp"],
                "action": entry["action"],
                "actor_type": entry["actor_type"],
                "actor_id": entry["actor_id"],
                "changes": entry.get("changes"),
                "hash_chain": entry.get("hash_chain")
            }
            for entry in entries
        ]


class HIPAACompliance:
    """
    HIPAA compliance utilities
    """
    
    @staticmethod
    def validate_phi_handling(data: Dict[str, Any]) -> list:
        """
        Validate PHI fields are marked for encryption
        """
        phi_indicators = [
            "ssn", "social_security", "dob", "date_of_birth",
            "mrn", "medical_record", "member_id", "insurance_id",
            "diagnosis", "procedure", "provider", "patient_name",
            "phone", "email", "address"
        ]
        
        violations = []
        
        def check_field(key: str, value: Any, path: str = ""):
            full_path = f"{path}.{key}" if path else key
            
            # Check if key contains PHI indicator
            if any(indicator in key.lower() for indicator in phi_indicators):
                if isinstance(value, str) and not value.startswith("[ENCRYPTED]"):
                    violations.append({
                        "field": full_path,
                        "issue": "PHI field not encrypted",
                        "value_preview": value[:20] + "..." if len(value) > 20 else value
                    })
            
            # Recurse into nested dicts
            if isinstance(value, dict):
                for k, v in value.items():
                    check_field(k, v, full_path)
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        for k, v in item.items():
                            check_field(k, v, f"{full_path}[{i}]")
        
        for key, value in data.items():
            check_field(key, value)
        
        return violations
    
    @staticmethod
    def calculate_retention_date(
        created_at: datetime,
        retention_years: int = 7
    ) -> datetime:
        """
        Calculate HIPAA retention expiration date
        """
        from dateutil.relativedelta import relativedelta
        return created_at + relativedelta(years=retention_years)
    
    @staticmethod
    def generate_baa_clause(organization_name: str) -> str:
        """
        Generate standard Business Associate Agreement clause
        """
        return f"""
BUSINESS ASSOCIATE AGREEMENT

{organization_name} ("Covered Entity") and Clinic Ops Agent ("Business Associate")

1. PERMITTED USES AND DISCLOSURES
Business Associate may use or disclose Protected Health Information (PHI) only as:
- Necessary to perform denial management services
- Required by law
- Agreed to in writing by Covered Entity

2. SAFEGUARDS
Business Associate shall implement and maintain appropriate administrative, physical, 
and technical safeguards to prevent unauthorized use or disclosure of PHI.

3. REPORTING
Business Associate shall report any use or disclosure of PHI not permitted by this 
Agreement to Covered Entity within 24 hours of discovery.

4. AUDIT
Business Associate shall maintain audit logs of all PHI access for minimum 6 years 
and make available to Covered Entity upon request.

5. RETURN/DESTRUCTION
Upon termination, Business Associate shall return or destroy all PHI and retain no copies.
"""


class AgentOpsMonitor:
    """
    AgentOps integration for agent monitoring and observability
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("AGENTOPS_API_KEY")
        self.base_url = "https://api.agentops.ai/v1"
    
    async def record_agent_run(
        self,
        agent_role: str,
        workflow_id: str,
        start_time: datetime,
        end_time: datetime,
        status: str,
        inputs: Dict[str, Any],
        outputs: Dict[str, Any],
        errors: Optional[list] = None
    ):
        """
        Record agent run to AgentOps
        """
        if not self.api_key:
            return
        
        payload = {
            "agent_role": agent_role,
            "workflow_id": workflow_id,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "duration_seconds": (end_time - start_time).total_seconds(),
            "status": status,
            "inputs": self._sanitize_payload(inputs),
            "outputs": self._sanitize_payload(outputs),
            "errors": errors or []
        }
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/runs",
                    json=payload,
                    headers=headers
                ) as resp:
                    if resp.status not in (200, 201):
                        print(f"⚠️  AgentOps recording failed: {resp.status}")
        except Exception as e:
            print(f"⚠️  AgentOps error: {e}")
    
    def _sanitize_payload(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Remove PHI from payloads before sending to AgentOps
        """
        phi_keys = ["mrn", "first_name", "last_name", "date_of_birth", 
                    "insurance_member_id", "ssn", "email", "phone"]
        
        sanitized = {}
        for key, value in data.items():
            if any(phi_key in key.lower() for phi_key in phi_keys):
                sanitized[key] = "[REDACTED]"
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_payload(value)
            elif isinstance(value, list):
                sanitized[key] = [
                    self._sanitize_payload(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                sanitized[key] = value
        
        return sanitized
