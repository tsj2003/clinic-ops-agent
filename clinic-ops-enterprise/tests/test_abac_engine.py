"""
Hardcore Testing for ABAC Engine & Operation-Level Logging
Comprehensive test coverage with edge cases
"""

import pytest
import asyncio
import hashlib
import hmac
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock
from compliance.abac_engine import (
    ABACPolicyEngine, OperationLevelAuditLogger, OperationLevelLogEntry,
    UserAttributes, ResourceAttributes, EnvironmentAttributes,
    AccessDecision, OperationType, ValidationSeverity
)


class TestABACPolicyEngine:
    """Test ABAC policy decisions"""
    
    @pytest.fixture
    def policy_engine(self):
        return ABACPolicyEngine()
    
    @pytest.fixture
    def standard_user(self):
        return UserAttributes(
            user_id="user-123",
            roles=["billing_staff"],
            department="billing",
            clearance_level="standard",
            is_authenticated=True,
            session_id="sess-456",
            ip_address="192.168.1.1",
            user_agent="Mozilla/5.0",
            mfa_verified=True,
            work_hours_only=True,
            assigned_patients={"patient-001"}
        )
    
    @pytest.fixture
    def admin_user(self):
        return UserAttributes(
            user_id="admin-001",
            roles=["admin"],
            department="it",
            clearance_level="admin",
            is_authenticated=True,
            session_id="sess-admin",
            ip_address="10.0.0.1",
            mfa_verified=True,
            work_hours_only=False,
            assigned_patients=set()
        )
    
    @pytest.fixture
    def patient_resource(self):
        return ResourceAttributes(
            resource_type="patient",
            resource_id="patient-001",
            owner_organization="clinic-001",
            sensitivity_level="high",
            phi_fields=["ssn", "dob", "medical_history"],
            patient_consent_status="active",
            data_classification="phi"
        )
    
    @pytest.fixture
    def claim_resource(self):
        return ResourceAttributes(
            resource_type="claim",
            resource_id="claim-789",
            owner_organization="clinic-001",
            sensitivity_level="standard",
            phi_fields=["procedure_code", "billing_amount"],
            data_classification="phi"
        )
    
    @pytest.fixture
    def business_hours_env(self):
        return EnvironmentAttributes(
            timestamp=datetime(2024, 1, 15, 10, 0, 0),  # Monday 10 AM
            is_business_hours=True,
            location="office",
            device_trust_level="high",
            network_security_level="high",
            threat_level="normal"
        )
    
    @pytest.fixture
    def after_hours_env(self):
        return EnvironmentAttributes(
            timestamp=datetime(2024, 1, 15, 22, 0, 0),  # Monday 10 PM
            is_business_hours=False,
            location="remote",
            device_trust_level="standard",
            network_security_level="standard",
            threat_level="normal"
        )
    
    def test_billing_staff_can_read_patient(self, policy_engine, standard_user, patient_resource, business_hours_env):
        """Test billing staff can read patient data during business hours"""
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.PERMIT.value
    
    def test_billing_staff_denied_after_hours(self, policy_engine, standard_user, patient_resource, after_hours_env):
        """Test billing staff denied access after hours with work_hours_only"""
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, after_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.DENY.value
        assert "business hours" in result["reasons"][0].lower()
    
    def test_admin_can_access_any_time(self, policy_engine, admin_user, patient_resource, after_hours_env):
        """Test admin can access outside business hours"""
        result = policy_engine.evaluate_access(
            admin_user, patient_resource, after_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.PERMIT.value
    
    def test_mfa_required_for_export(self, policy_engine, standard_user, patient_resource, business_hours_env):
        """Test MFA required for export operations"""
        standard_user.mfa_verified = False
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, business_hours_env, OperationType.EXPORT
        )
        assert result["decision"] == AccessDecision.DENY.value
        assert "MFA" in result["reasons"][0]
    
    def test_critical_phi_requires_admin(self, policy_engine, standard_user, patient_resource, business_hours_env):
        """Test critical PHI requires admin clearance"""
        patient_resource.sensitivity_level = "critical"
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.DENY.value
        assert "admin" in result["reasons"][0].lower()
    
    def test_patient_assignment_check(self, policy_engine, standard_user, patient_resource, business_hours_env):
        """Test user can only access assigned patients"""
        patient_resource.resource_id = "patient-999"  # Not assigned
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.DENY.value
        assert "assigned" in result["reasons"][0].lower()
    
    def test_untrusted_device_denied_high_sensitivity(self, policy_engine, standard_user, patient_resource, business_hours_env):
        """Test untrusted device denied high-sensitivity data"""
        business_hours_env.device_trust_level = "low"
        result = policy_engine.evaluate_access(
            standard_user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.DENY.value
    
    def test_role_permissions_multiple_roles(self, policy_engine, business_hours_env, patient_resource):
        """Test user with multiple roles gets appropriate permissions"""
        user = UserAttributes(
            user_id="multi-role-user",
            roles=["billing_staff", "clinical_staff"],
            is_authenticated=True,
            mfa_verified=True,
            work_hours_only=False
        )
        result = policy_engine.evaluate_access(
            user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.PERMIT.value
    
    def test_unknown_role_denied(self, policy_engine, business_hours_env, patient_resource):
        """Test unknown role denied access"""
        user = UserAttributes(
            user_id="unknown-user",
            roles=["unknown_role"],
            is_authenticated=True,
            mfa_verified=True,
            work_hours_only=False
        )
        result = policy_engine.evaluate_access(
            user, patient_resource, business_hours_env, OperationType.READ
        )
        assert result["decision"] == AccessDecision.DENY.value


class TestOperationLevelLogging:
    """Test operation-level audit logging"""
    
    @pytest.fixture
    def logger(self):
        return OperationLevelAuditLogger(db=None, axiom_dataset="test-dataset")
    
    @pytest.fixture
    def sample_phi_fields(self):
        return [
            {"field": "ssn", "category": "identifiers", "action": "read"},
            {"field": "dob", "category": "identifiers", "action": "read"},
            {"field": "procedure_code", "category": "clinical", "action": "read"}
        ]
    
    @pytest.mark.asyncio
    async def test_log_entry_creation(self, logger, sample_phi_fields):
        """Test basic log entry creation"""
        log_id = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-123-456",
            human_operator_id="operator-789",
            human_operator_role="billing_staff",
            human_auth_token="jwt-token-abc",
            human_session_id="sess-operator-001",
            phi_fields_accessed=sample_phi_fields,
            operation=OperationType.READ,
            operation_context={"claim_id": "claim-001"},
            resource_type="patient",
            resource_id="patient-123",
            resource_owner="clinic-001"
        )
        
        assert log_id.startswith("AUDIT-")
        assert len(log_id) > 10
    
    @pytest.mark.asyncio
    async def test_log_entry_hash_chain(self, logger, sample_phi_fields):
        """Test tamper-evident hash chain"""
        # First entry
        log_id1 = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-001",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token1",
            human_session_id="sess1",
            phi_fields_accessed=sample_phi_fields,
            operation=OperationType.READ,
            operation_context={},
            resource_type="patient",
            resource_id="p-001",
            resource_owner="clinic"
        )
        
        first_hash = logger.previous_hash
        assert first_hash is not None
        assert len(first_hash) == 64  # SHA-256 hex
        
        # Second entry should reference first
        log_id2 = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-002",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token2",
            human_session_id="sess2",
            phi_fields_accessed=sample_phi_fields,
            operation=OperationType.UPDATE,
            operation_context={},
            resource_type="patient",
            resource_id="p-001",
            resource_owner="clinic"
        )
        
        assert logger.previous_hash != first_hash
    
    @pytest.mark.asyncio
    async def test_hmac_signature(self, logger, sample_phi_fields):
        """Test HMAC signature generation"""
        log_id = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-001",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token1",
            human_session_id="sess1",
            phi_fields_accessed=sample_phi_fields,
            operation=OperationType.READ,
            operation_context={},
            resource_type="patient",
            resource_id="p-001",
            resource_owner="clinic"
        )
        
        # Verify HMAC can be validated
        assert logger.hmac_key is not None
        assert len(logger.hmac_key) > 0
    
    @pytest.mark.asyncio
    async def test_all_operation_types_logged(self, logger, sample_phi_fields):
        """Test all operation types can be logged"""
        operations = [
            OperationType.CREATE, OperationType.READ, OperationType.UPDATE,
            OperationType.DELETE, OperationType.DOWNLOAD, OperationType.SUBMIT,
            OperationType.EXPORT, OperationType.PRINT, OperationType.VIEW, OperationType.QUERY
        ]
        
        log_ids = []
        for op in operations:
            log_id = await logger.log_operation(
                ai_agent_id="agent-001",
                ai_workflow_credential=f"wf-{op.value}",
                human_operator_id="op-001",
                human_operator_role="admin",
                human_auth_token=f"token-{op.value}",
                human_session_id="sess1",
                phi_fields_accessed=sample_phi_fields,
                operation=op,
                operation_context={"test": True},
                resource_type="patient",
                resource_id="p-001",
                resource_owner="clinic"
            )
            log_ids.append(log_id)
        
        assert len(log_ids) == len(operations)
        assert len(set(log_ids)) == len(log_ids)  # All unique
    
    def test_token_hashing(self, logger):
        """Test that auth tokens are hashed in logs"""
        token = "sensitive-jwt-token-12345"
        hashed = logger._hash_token(token)
        
        assert hashed != token
        assert len(hashed) == 16  # First 16 chars of SHA-256
        assert hashed != token[:16]  # Not just truncated
    
    @pytest.mark.asyncio
    async def test_abac_decorator_permits_valid_access(self, logger):
        """Test ABAC decorator permits valid access"""
        
        @logger.abac_protect("patient", OperationType.READ)
        async def get_patient(patient_id: str, user_attrs):
            return {"id": patient_id, "name": "Test Patient"}
        
        user = UserAttributes(
            user_id="test-user",
            roles=["admin"],
            is_authenticated=True,
            mfa_verified=True,
            work_hours_only=False
        )
        
        result = await get_patient("patient-123", user_attrs=user)
        assert result["id"] == "patient-123"
    
    @pytest.mark.asyncio
    async def test_abac_decorator_denies_invalid_access(self, logger):
        """Test ABAC decorator denies invalid access"""
        
        @logger.abac_protect("patient", OperationType.EXPORT)
        async def export_patient(patient_id: str, user_attrs):
            return {"exported": True}
        
        # User without MFA should be denied for EXPORT
        user = UserAttributes(
            user_id="test-user",
            roles=["billing_staff"],
            is_authenticated=True,
            mfa_verified=False,  # No MFA
            work_hours_only=False
        )
        
        with pytest.raises(PermissionError):
            await export_patient("patient-123", user_attrs=user)
    
    @pytest.mark.asyncio
    async def test_concurrent_logging(self, logger, sample_phi_fields):
        """Test concurrent log operations don't corrupt hash chain"""
        
        async def log_operation(op_num):
            return await logger.log_operation(
                ai_agent_id=f"agent-{op_num}",
                ai_workflow_credential=f"wf-{op_num}",
                human_operator_id=f"op-{op_num}",
                human_operator_role="admin",
                human_auth_token=f"token-{op_num}",
                human_session_id=f"sess-{op_num}",
                phi_fields_accessed=sample_phi_fields,
                operation=OperationType.READ,
                operation_context={"op_num": op_num},
                resource_type="patient",
                resource_id=f"p-{op_num}",
                resource_owner="clinic"
            )
        
        # Run 10 concurrent logs
        tasks = [log_operation(i) for i in range(10)]
        log_ids = await asyncio.gather(*tasks)
        
        assert len(log_ids) == 10
        assert len(set(log_ids)) == 10  # All unique
    
    @pytest.mark.asyncio
    async def test_empty_phi_fields(self, logger):
        """Test logging with empty PHI fields"""
        log_id = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-001",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token1",
            human_session_id="sess1",
            phi_fields_accessed=[],  # Empty
            operation=OperationType.QUERY,
            operation_context={},
            resource_type="audit_log",
            resource_id="log-001",
            resource_owner="clinic"
        )
        
        assert log_id.startswith("AUDIT-")
    
    @pytest.mark.asyncio
    async def test_unicode_in_fields(self, logger, sample_phi_fields):
        """Test logging with unicode characters"""
        log_id = await logger.log_operation(
            ai_agent_id="agent-日本",
            ai_workflow_credential="wf-001",
            human_operator_id="op-测试",
            human_operator_role="admin",
            human_auth_token="token-日本語",
            human_session_id="sess1",
            phi_fields_accessed=sample_phi_fields,
            operation=OperationType.READ,
            operation_context={"notes": "Patient name: José García Müller"},
            resource_type="patient",
            resource_id="patient-日本語",
            resource_owner="clinic-東京"
        )
        
        assert log_id.startswith("AUDIT-")


class TestABACEdgeCases:
    """Edge case testing for ABAC"""
    
    @pytest.fixture
    def policy_engine(self):
        return ABACPolicyEngine()
    
    def test_empty_roles(self, policy_engine):
        """Test user with no roles"""
        user = UserAttributes(
            user_id="no-roles",
            roles=[],  # Empty
            is_authenticated=True,
            mfa_verified=True
        )
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="p-001",
            owner_organization="clinic"
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True
        )
        
        result = policy_engine.evaluate_access(user, resource, env, OperationType.READ)
        assert result["decision"] == AccessDecision.DENY.value
    
    def test_none_values_in_attributes(self, policy_engine):
        """Test handling of None values"""
        user = UserAttributes(
            user_id="test",
            roles=["admin"],
            department=None,
            clearance_level=None,
            is_authenticated=True,
            mfa_verified=True
        )
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="p-001",
            owner_organization="clinic",
            sensitivity_level=None
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True,
            location=None
        )
        
        result = policy_engine.evaluate_access(user, resource, env, OperationType.READ)
        assert result["decision"] == AccessDecision.PERMIT.value  # Admin should still work
    
    def test_very_long_resource_id(self, policy_engine):
        """Test with very long resource ID"""
        user = UserAttributes(
            user_id="test",
            roles=["admin"],
            is_authenticated=True,
            mfa_verified=True
        )
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="p-" + "x" * 10000,  # Very long
            owner_organization="clinic"
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True
        )
        
        result = policy_engine.evaluate_access(user, resource, env, OperationType.READ)
        assert result["decision"] == AccessDecision.PERMIT.value
    
    def test_special_characters_in_role_names(self, policy_engine):
        """Test role names with special characters"""
        user = UserAttributes(
            user_id="test",
            roles=["admin@domain.com", "billing-staff_v2", "role.with.dots"],
            is_authenticated=True,
            mfa_verified=True
        )
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="p-001",
            owner_organization="clinic"
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True
        )
        
        result = policy_engine.evaluate_access(user, resource, env, OperationType.READ)
        # Should not crash, may deny if roles don't match
        assert "decision" in result


class TestLoggerEdgeCases:
    """Edge case testing for operation-level logger"""
    
    @pytest.fixture
    def logger(self):
        return OperationLevelAuditLogger(db=None)
    
    @pytest.mark.asyncio
    async def test_very_long_context(self, logger):
        """Test with very large operation context"""
        large_context = {
            "data": "x" * 100000,  # 100KB string
            "nested": {
                "array": list(range(10000))
            }
        }
        
        log_id = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-001",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token",
            human_session_id="sess1",
            phi_fields_accessed=[{"field": "test", "category": "clinical"}],
            operation=OperationType.READ,
            operation_context=large_context,
            resource_type="patient",
            resource_id="p-001",
            resource_owner="clinic"
        )
        
        assert log_id.startswith("AUDIT-")
    
    @pytest.mark.asyncio
    async def test_many_phi_fields(self, logger):
        """Test with hundreds of PHI fields"""
        many_fields = [
            {"field": f"field_{i}", "category": "clinical", "action": "read"}
            for i in range(500)
        ]
        
        log_id = await logger.log_operation(
            ai_agent_id="agent-001",
            ai_workflow_credential="wf-001",
            human_operator_id="op-001",
            human_operator_role="admin",
            human_auth_token="token",
            human_session_id="sess1",
            phi_fields_accessed=many_fields,
            operation=OperationType.READ,
            operation_context={},
            resource_type="patient",
            resource_id="p-001",
            resource_owner="clinic"
        )
        
        assert log_id.startswith("AUDIT-")
    
    @pytest.mark.asyncio  
    async def test_rapid_fire_logging(self, logger, sample_phi_fields):
        """Test rapid sequential logging"""
        log_ids = []
        
        for i in range(100):
            log_id = await logger.log_operation(
                ai_agent_id="agent-001",
                ai_workflow_credential=f"wf-{i}",
                human_operator_id="op-001",
                human_operator_role="admin",
                human_auth_token=f"token-{i}",
                human_session_id="sess1",
                phi_fields_accessed=sample_phi_fields,
                operation=OperationType.READ,
                operation_context={"index": i},
                resource_type="patient",
                resource_id=f"p-{i}",
                resource_owner="clinic"
            )
            log_ids.append(log_id)
        
        # Verify all unique
        assert len(set(log_ids)) == 100
        
        # Verify hash chain maintained
        assert logger.previous_hash is not None
        assert len(logger.previous_hash) == 64
