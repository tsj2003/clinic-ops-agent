"""
Operation-Level Logging & Attribute-Based Access Control (ABAC)
HIPAA-compliant granular access control with detailed audit logging
"""

import os
import json
import hashlib
import hmac
from datetime import datetime
from typing import Dict, List, Optional, Any, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
import asyncio
from functools import wraps


class AccessDecision(str, Enum):
    """ABAC access decisions"""
    PERMIT = "permit"
    DENY = "deny"
    INDETERMINATE = "indeterminate"


class OperationType(str, Enum):
    """HIPAA operation-level logging operations"""
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    DOWNLOAD = "download"
    SUBMIT = "submit"
    EXPORT = "export"
    PRINT = "print"
    VIEW = "view"
    QUERY = "query"


class ValidationSeverity(str, Enum):
    """Validation severity levels for ABAC policy violations"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class PHIFieldCategory(str, Enum):
    """Categories of PHI fields"""
    IDENTIFIERS = "identifiers"  # Name, DOB, SSN, MRN
    CONTACT = "contact"  # Address, phone, email
    DEMOGRAPHIC = "demographic"  # Race, ethnicity, gender
    FINANCIAL = "financial"  # Insurance, billing, payment
    CLINICAL = "clinical"  # Diagnoses, procedures, meds
    ADMINISTRATIVE = "administrative"  # Appointments, authorizations


@dataclass
class UserAttributes:
    """User attributes for ABAC decisions"""
    user_id: str
    roles: List[str]
    department: Optional[str] = None
    clearance_level: str = "standard"
    is_authenticated: bool = False
    session_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    mfa_verified: bool = False
    work_hours_only: bool = True
    assigned_patients: Set[str] = field(default_factory=set)


@dataclass
class ResourceAttributes:
    """Resource attributes for ABAC decisions"""
    resource_type: str  # "patient", "claim", "audit_log", etc.
    resource_id: str
    owner_organization: str
    sensitivity_level: str = "standard"  # "low", "standard", "high", "critical"
    phi_fields: List[str] = field(default_factory=list)
    patient_consent_status: str = "active"
    data_classification: str = "phi"


@dataclass
class EnvironmentAttributes:
    """Environmental context for ABAC decisions"""
    timestamp: datetime
    is_business_hours: bool
    location: Optional[str] = None  # "office", "remote", "vpn"
    device_trust_level: str = "standard"  # "low", "standard", "high"
    network_security_level: str = "standard"
    threat_level: str = "normal"  # "normal", "elevated", "high"


@dataclass
class OperationLevelLogEntry:
    """
    HIPAA operation-level audit log entry
    Captures: workflow credential, human identity, PHI fields, operation
    """
    # Unique identifiers
    log_id: str
    timestamp: datetime
    
    # Workflow credential of AI agent
    ai_agent_id: str
    ai_agent_workflow_credential: str  # Unique workflow instance ID
    ai_model_version: Optional[str]
    
    # Authenticated human identity
    human_operator_id: str
    human_operator_role: str
    human_authorization_token: str  # JWT or signed auth
    human_session_id: str
    
    # PHI fields accessed
    phi_fields_accessed: List[Dict[str, str]]  # [{"field": "ssn", "category": "identifiers"}]
    phi_data_classification: str
    
    # Exact operation performed
    operation: OperationType
    operation_context: Dict[str, Any]  # Additional operation details
    
    # Resource information
    resource_type: str
    resource_id: str
    resource_owner: str
    
    # Security context
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    mfa_verified: bool = False
    
    # Tamper-evident
    previous_hash: Optional[str] = None
    entry_hash: Optional[str] = None
    hmac_signature: Optional[str] = None


class ABACPolicyEngine:
    """
    Attribute-Based Access Control Policy Engine
    Dynamic access decisions based on user, resource, and environment attributes
    """
    
    def __init__(self):
        self.policies: List[Callable] = []
        self.role_permissions: Dict[str, Dict[str, List[str]]] = {}
        self._load_default_policies()
    
    def _load_default_policies(self):
        """Load default ABAC policies"""
        # Role-based permissions
        self.role_permissions = {
            "billing_staff": {
                "patient": [OperationType.READ.value, OperationType.UPDATE.value],
                "claim": [OperationType.CREATE.value, OperationType.READ.value, OperationType.UPDATE.value, OperationType.SUBMIT.value],
                "audit_log": [OperationType.READ.value],
            },
            "clinical_staff": {
                "patient": [OperationType.READ.value, OperationType.UPDATE.value, OperationType.CREATE.value],
                "clinical_note": [OperationType.CREATE.value, OperationType.READ.value, OperationType.UPDATE.value],
                "audit_log": [OperationType.READ.value],
            },
            "admin": {
                "patient": [op.value for op in OperationType],
                "claim": [op.value for op in OperationType],
                "audit_log": [op.value for op in OperationType],
                "user": [op.value for op in OperationType],
            },
            "auditor": {
                "audit_log": [OperationType.READ.value, OperationType.EXPORT.value, OperationType.DOWNLOAD.value],
                "patient": [OperationType.READ.value],
            },
            "ai_agent": {
                "patient": [OperationType.READ.value, OperationType.QUERY.value],
                "claim": [OperationType.READ.value, OperationType.UPDATE.value, OperationType.SUBMIT.value],
                "clinical_note": [OperationType.READ.value],
            }
        }
        
        # Add policy functions
        self.policies.extend([
            self._check_role_permissions,
            self._check_phi_sensitivity,
            self._check_business_hours,
            self._check_mfa_requirement,
            self._check_device_trust,
            self._check_patient_assignment,
        ])
    
    def evaluate_access(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        requested_operation: OperationType
    ) -> Dict[str, Any]:
        """
        Evaluate ABAC access decision
        Returns detailed decision with reasoning
        """
        decisions = []
        
        # Evaluate all policies
        for policy in self.policies:
            result = policy(user_attrs, resource_attrs, env_attrs, requested_operation)
            decisions.append(result)
        
        # Combine decisions (deny overrides)
        final_decision = AccessDecision.PERMIT
        reasons = []
        
        for decision in decisions:
            if decision["decision"] == AccessDecision.DENY:
                final_decision = AccessDecision.DENY
                reasons.append(decision["reason"])
            elif decision["decision"] == AccessDecision.INDETERMINATE:
                if final_decision != AccessDecision.DENY:
                    final_decision = AccessDecision.INDETERMINATE
        
        # If no denies and no permits, default to deny
        if final_decision == AccessDecision.INDETERMINATE:
            final_decision = AccessDecision.DENY
            reasons.append("No applicable policy found - default deny")
        
        return {
            "decision": final_decision.value,
            "user_id": user_attrs.user_id,
            "resource_type": resource_attrs.resource_type,
            "resource_id": resource_attrs.resource_id,
            "operation": requested_operation.value,
            "reasons": reasons if reasons else ["Access permitted by policy"],
            "timestamp": datetime.utcnow().isoformat(),
            "policy_evaluations": decisions
        }
    
    def _check_role_permissions(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check if user's role permits the operation on resource"""
        resource_type = resource_attrs.resource_type
        operation_str = operation.value
        
        for role in user_attrs.roles:
            if role in self.role_permissions:
                perms = self.role_permissions[role].get(resource_type, [])
                if operation_str in perms or "*" in perms:
                    return {
                        "policy": "role_permissions",
                        "decision": AccessDecision.PERMIT,
                        "reason": f"Role '{role}' permits {operation_str} on {resource_type}"
                    }
        
        return {
            "policy": "role_permissions",
            "decision": AccessDecision.DENY,
            "reason": f"No role permits {operation_str} on {resource_type}"
        }
    
    def _check_phi_sensitivity(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check PHI sensitivity level restrictions"""
        sensitivity = resource_attrs.sensitivity_level
        
        # Critical PHI requires admin or specific clearance
        if sensitivity == "critical":
            if "admin" not in user_attrs.roles and user_attrs.clearance_level != "admin":
                return {
                    "policy": "phi_sensitivity",
                    "decision": AccessDecision.DENY,
                    "reason": "Critical PHI requires admin clearance"
                }
        
        # High sensitivity requires MFA
        if sensitivity == "high" and not user_attrs.mfa_verified:
            return {
                "policy": "phi_sensitivity",
                "decision": AccessDecision.DENY,
                "reason": "High-sensitivity PHI requires MFA verification"
            }
        
        return {
            "policy": "phi_sensitivity",
            "decision": AccessDecision.PERMIT,
            "reason": "PHI sensitivity level permits access"
        }
    
    def _check_business_hours(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check if user is restricted to business hours"""
        if user_attrs.work_hours_only and not env_attrs.is_business_hours:
            return {
                "policy": "business_hours",
                "decision": AccessDecision.DENY,
                "reason": "Access restricted to business hours (8AM-6PM)"
            }
        
        return {
            "policy": "business_hours",
            "decision": AccessDecision.PERMIT,
            "reason": "Access permitted outside business hours or user not restricted"
        }
    
    def _check_mfa_requirement(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check MFA requirements for sensitive operations"""
        sensitive_ops = [OperationType.EXPORT, OperationType.DOWNLOAD, OperationType.DELETE]
        
        if operation in sensitive_ops and not user_attrs.mfa_verified:
            return {
                "policy": "mfa_requirement",
                "decision": AccessDecision.DENY,
                "reason": f"MFA required for {operation.value} operations"
            }
        
        return {
            "policy": "mfa_requirement",
            "decision": AccessDecision.PERMIT,
            "reason": "MFA requirement satisfied"
        }
    
    def _check_device_trust(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check device trust level for high-risk operations"""
        if env_attrs.device_trust_level == "low":
            if resource_attrs.sensitivity_level in ["high", "critical"]:
                return {
                    "policy": "device_trust",
                    "decision": AccessDecision.DENY,
                    "reason": "Untrusted device cannot access high-sensitivity data"
                }
        
        return {
            "policy": "device_trust",
            "decision": AccessDecision.PERMIT,
            "reason": "Device trust level acceptable"
        }
    
    def _check_patient_assignment(
        self,
        user_attrs: UserAttributes,
        resource_attrs: ResourceAttributes,
        env_attrs: EnvironmentAttributes,
        operation: OperationType
    ) -> Dict[str, Any]:
        """Check if user is assigned to the patient"""
        # Only apply to patient resources
        if resource_attrs.resource_type != "patient":
            return {
                "policy": "patient_assignment",
                "decision": AccessDecision.PERMIT,
                "reason": "Not a patient resource"
            }
        
        # Admin and certain roles bypass
        if "admin" in user_attrs.roles or "supervisor" in user_attrs.roles:
            return {
                "policy": "patient_assignment",
                "decision": AccessDecision.PERMIT,
                "reason": "Admin/supervisor role bypasses patient assignment"
            }
        
        # Check if user is assigned to this patient
        if resource_attrs.resource_id in user_attrs.assigned_patients:
            return {
                "policy": "patient_assignment",
                "decision": AccessDecision.PERMIT,
                "reason": "User assigned to patient"
            }
        
        return {
            "policy": "patient_assignment",
            "decision": AccessDecision.DENY,
            "reason": "User not assigned to this patient"
        }


class OperationLevelAuditLogger:
    """
    HIPAA-compliant operation-level audit logging
    Captures all required elements for forensic analysis
    """
    
    def __init__(self, db=None, axiom_dataset: Optional[str] = None):
        self.db = db
        self.axiom_dataset = axiom_dataset or os.getenv("AXIOM_DATASET", "clinic-ops-hipaa-audit")
        self.axiom_api_key = os.getenv("AXIOM_API_KEY")
        self.hmac_key = os.getenv("HIPAA_HMAC_KEY", os.urandom(32).hex())
        self.previous_hash: Optional[str] = None
        self.abac_engine = ABACPolicyEngine()
    
    async def log_operation(
        self,
        # AI Agent credentials (required)
        ai_agent_id: str,
        ai_workflow_credential: str,
        # Human identity (required)
        human_operator_id: str,
        human_operator_role: str,
        human_auth_token: str,
        human_session_id: str,
        # PHI fields (required)
        phi_fields_accessed: List[Dict[str, str]],
        # Operation details (required)
        operation: OperationType,
        operation_context: Dict[str, Any],
        # Resource (required)
        resource_type: str,
        resource_id: str,
        resource_owner: str,
        # AI Agent credentials (optional)
        ai_model_version: Optional[str] = None,
        # Security context (optional)
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        mfa_verified: bool = False
    ) -> str:
        """
        Create operation-level audit log entry
        Returns the log entry ID
        """
        # Generate unique log ID
        timestamp = datetime.utcnow()
        log_id = f"AUDIT-{timestamp.strftime('%Y%m%d%H%M%S')}-{hashlib.sha256(f'{ai_agent_id}{timestamp}'.encode()).hexdigest()[:8]}"
        
        # Create entry
        entry = OperationLevelLogEntry(
            log_id=log_id,
            timestamp=timestamp,
            ai_agent_id=ai_agent_id,
            ai_agent_workflow_credential=ai_workflow_credential,
            ai_model_version=ai_model_version,
            human_operator_id=human_operator_id,
            human_operator_role=human_operator_role,
            human_authorization_token=self._hash_token(human_auth_token),
            human_session_id=human_session_id,
            phi_fields_accessed=phi_fields_accessed,
            phi_data_classification="phi",
            operation=operation,
            operation_context=operation_context,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_owner=resource_owner,
            ip_address=ip_address,
            user_agent=user_agent,
            mfa_verified=mfa_verified,
            previous_hash=self.previous_hash
        )
        
        # Calculate tamper-evident hash
        entry.entry_hash = self._calculate_entry_hash(entry)
        entry.hmac_signature = self._sign_entry(entry)
        
        # Update chain
        self.previous_hash = entry.entry_hash
        
        # Store
        await self._store_entry(entry)
        
        return log_id
    
    def _hash_token(self, token: str) -> str:
        """Hash authorization token for audit log"""
        return hashlib.sha256(token.encode()).hexdigest()[:16]
    
    def _calculate_entry_hash(self, entry: OperationLevelLogEntry) -> str:
        """Calculate tamper-evident hash for log entry"""
        data = {
            "log_id": entry.log_id,
            "timestamp": entry.timestamp.isoformat(),
            "ai_agent_id": entry.ai_agent_id,
            "ai_workflow_credential": entry.ai_agent_workflow_credential,
            "human_operator_id": entry.human_operator_id,
            "operation": entry.operation.value,
            "resource_id": entry.resource_id,
            "previous_hash": entry.previous_hash
        }
        
        data_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(data_str.encode()).hexdigest()
    
    def _sign_entry(self, entry: OperationLevelLogEntry) -> str:
        """Create HMAC signature for entry"""
        message = f"{entry.log_id}:{entry.entry_hash}:{entry.timestamp.isoformat()}"
        signature = hmac.new(
            self.hmac_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    async def _store_entry(self, entry: OperationLevelLogEntry):
        """Store entry to database and Axiom"""
        # Convert to dict for storage
        entry_dict = {
            "_id": entry.log_id,
            "timestamp": entry.timestamp,
            "ai_credential": {
                "agent_id": entry.ai_agent_id,
                "workflow_credential": entry.ai_agent_workflow_credential,
                "model_version": entry.ai_model_version
            },
            "human_identity": {
                "operator_id": entry.human_operator_id,
                "role": entry.human_operator_role,
                "auth_token_hash": entry.human_authorization_token,
                "session_id": entry.human_session_id
            },
            "phi_access": {
                "fields": entry.phi_fields_accessed,
                "classification": entry.phi_data_classification
            },
            "operation": {
                "type": entry.operation.value,
                "context": entry.operation_context
            },
            "resource": {
                "type": entry.resource_type,
                "id": entry.resource_id,
                "owner": entry.resource_owner
            },
            "security_context": {
                "ip_address": entry.ip_address,
                "user_agent": entry.user_agent,
                "mfa_verified": entry.mfa_verified
            },
            "integrity": {
                "previous_hash": entry.previous_hash,
                "entry_hash": entry.entry_hash,
                "hmac_signature": entry.hmac_signature
            }
        }
        
        # Store to MongoDB
        if self.db:
            await self.db.operation_level_audit.insert_one(entry_dict)
        
        # Send to Axiom (immutable cold storage)
        if self.axiom_api_key:
            await self._send_to_axiom(entry_dict)
    
    async def _send_to_axiom(self, entry_dict: Dict):
        """Send entry to Axiom for immutable storage"""
        import aiohttp
        
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"https://api.axiom.co/v1/datasets/{self.axiom_dataset}/ingest",
                    headers={
                        "Authorization": f"Bearer {self.axiom_api_key}",
                        "Content-Type": "application/json"
                    },
                    json=[entry_dict]
                )
        except Exception:
            pass  # Fail silently - MongoDB has primary copy
    
    def abac_protect(
        self,
        resource_type: str,
        operation: OperationType,
        get_resource_attrs: Optional[Callable] = None
    ):
        """
        Decorator to add ABAC protection to functions
        Usage:
            @logger.abac_protect("patient", OperationType.READ)
            async def get_patient(patient_id: str, user: UserAttributes):
                ...
        """
        def decorator(func):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # Extract user attributes from kwargs
                user_attrs = kwargs.get("user_attrs")
                if not user_attrs:
                    raise ValueError("ABAC protection requires 'user_attrs' parameter")
                
                # Get resource attributes
                if get_resource_attrs:
                    resource_attrs = get_resource_attrs(*args, **kwargs)
                else:
                    # Default resource attrs
                    resource_id = args[0] if args else kwargs.get("resource_id", "unknown")
                    resource_attrs = ResourceAttributes(
                        resource_type=resource_type,
                        resource_id=str(resource_id),
                        owner_organization="default",
                        sensitivity_level="standard"
                    )
                
                # Build environment attributes
                env_attrs = EnvironmentAttributes(
                    timestamp=datetime.utcnow(),
                    is_business_hours=self._is_business_hours(),
                    device_trust_level="standard"
                )
                
                # Evaluate access
                decision = self.abac_engine.evaluate_access(
                    user_attrs, resource_attrs, env_attrs, operation
                )
                
                if decision["decision"] != AccessDecision.PERMIT.value:
                    # Log denied access
                    asyncio.create_task(self.log_operation(
                        ai_agent_id="access_control",
                        ai_workflow_credential="abac_enforcement",
                        human_operator_id=user_attrs.user_id,
                        human_operator_role=user_attrs.roles[0] if user_attrs.roles else "unknown",
                        human_auth_token="denied",
                        human_session_id=user_attrs.session_id or "unknown",
                        phi_fields_accessed=[],
                        operation=operation,
                        operation_context={"abac_decision": decision, "access_denied": True},
                        resource_type=resource_type,
                        resource_id=resource_attrs.resource_id,
                        resource_owner=resource_attrs.owner_organization,
                        ip_address=user_attrs.ip_address,
                        user_agent=user_attrs.user_agent,
                        mfa_verified=user_attrs.mfa_verified
                    ))
                    
                    raise PermissionError(f"Access denied: {decision['reasons']}")
                
                # Log permitted access (async, don't wait)
                asyncio.create_task(self.log_operation(
                    ai_agent_id="access_control",
                    ai_workflow_credential="abac_enforcement",
                    human_operator_id=user_attrs.user_id,
                    human_operator_role=user_attrs.roles[0] if user_attrs.roles else "unknown",
                    human_auth_token="permitted",
                    human_session_id=user_attrs.session_id or "unknown",
                    phi_fields_accessed=[],
                    operation=operation,
                    operation_context={"abac_decision": decision, "access_permitted": True},
                    resource_type=resource_type,
                    resource_id=resource_attrs.resource_id,
                    resource_owner=resource_attrs.owner_organization,
                    ip_address=user_attrs.ip_address,
                    user_agent=user_attrs.user_agent,
                    mfa_verified=user_attrs.mfa_verified
                ))
                
                # Execute function
                return await func(*args, **kwargs)
            
            return wrapper
        return decorator
    
    def _is_business_hours(self) -> bool:
        """Check if current time is business hours"""
        now = datetime.utcnow()
        hour = now.hour
        weekday = now.weekday()
        
        # Business hours: 8 AM - 6 PM, Monday-Friday
        return weekday < 5 and 8 <= hour < 18
    
    async def verify_chain_integrity(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Verify tamper-evident chain integrity"""
        if not self.db:
            return {"error": "No database connection"}
        
        query = {}
        if start_time:
            query["timestamp"] = {"$gte": start_time}
        if end_time:
            query["timestamp"]["$lte"] = end_time if "timestamp" in query else {"$lte": end_time}
        
        entries = await self.db.operation_level_audit.find(query).sort("timestamp", 1).to_list(length=None)
        
        violations = []
        previous_hash = None
        
        for entry in entries:
            # Verify hash chain
            if previous_hash and entry.get("integrity", {}).get("previous_hash") != previous_hash:
                violations.append({
                    "log_id": entry["_id"],
                    "type": "hash_chain_broken",
                    "expected": previous_hash,
                    "found": entry.get("integrity", {}).get("previous_hash")
                })
            
            # Verify HMAC signature
            expected_hmac = self._verify_hmac(entry)
            if entry.get("integrity", {}).get("hmac_signature") != expected_hmac:
                violations.append({
                    "log_id": entry["_id"],
                    "type": "hmac_invalid",
                    "details": "Entry may have been tampered with"
                })
            
            previous_hash = entry.get("integrity", {}).get("entry_hash")
        
        return {
            "total_entries_checked": len(entries),
            "violations_found": len(violations),
            "violations": violations,
            "chain_integrity": "intact" if not violations else "compromised"
        }
    
    def _verify_hmac(self, entry: Dict) -> str:
        """Verify HMAC signature of entry"""
        message = f"{entry['_id']}:{entry['integrity']['entry_hash']}:{entry['timestamp']}"
        return hmac.new(
            self.hmac_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()


# Global instances
abac_engine = ABACPolicyEngine()
operation_level_logger = OperationLevelAuditLogger()
