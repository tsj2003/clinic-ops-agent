"""
Hardcore Integration Tests
End-to-end testing across all modules
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock

# Import all modules for integration testing
from compliance.abac_engine import ABACPolicyEngine, OperationLevelAuditLogger, UserAttributes, ResourceAttributes, EnvironmentAttributes, OperationType
from orchestrator.agentic_rag import AgenticRAGOrchestrator
from ehr_integration.fhir_writeback import FHIRWritebackEngine
from self_healing.pre_submission_engine import PreSubmissionEngine
from stealth.browser_hardening import BrowserHardeningEngine, ServerlessSessionManager


class TestFullWorkflowIntegration:
    """End-to-end workflow testing"""
    
    @pytest.fixture
    async def full_system(self):
        """Initialize all system components"""
        return {
            "abac": ABACPolicyEngine(),
            "audit_logger": OperationLevelAuditLogger(db=None),
            "agentic_rag": AgenticRAGOrchestrator(),
            "fhir_writeback": FHIRWritebackEngine(),
            "pre_submission": PreSubmissionEngine(db=None),
            "browser_hardening": BrowserHardeningEngine(),
            "session_manager": ServerlessSessionManager()
        }
    
    @pytest.mark.asyncio
    async def test_complete_claim_lifecycle(self):
        """Test complete claim lifecycle from analysis to write-back"""
        
        # 1. Pre-submission analysis
        pre_submission_engine = PreSubmissionEngine(db=None)
        claim_data = {
            "claim_id": "CLM-INTEGRATION-001",
            "procedure_code": "99213",
            "procedure_description": "Office visit, established patient",
            "diagnosis_codes": ["I10", "E11.9"],
            "payer_id": "aetna",
            "billed_amount": 150.00
        }
        patient_data = {
            "id": "PAT-001",
            "name": "John Doe",
            "clinical_notes": """
            Chief Complaint: Follow-up for hypertension and diabetes
            
            History: Patient doing well on current medications.
            BP 128/82 today. Continue lisinopril and metformin.
            
            Assessment: Well-controlled HTN and T2DM
            Plan: Continue current regimen, f/u 3 months
            """
        }
        
        pre_report = await pre_submission_engine.analyze_claim_pre_submission(
            claim_data=claim_data,
            patient_data=patient_data,
            clinical_notes=patient_data["clinical_notes"]
        )
        
        assert pre_report is not None
        
        # 2. Agentic RAG analysis (if pre-submission allows)
        if pre_report.can_submit:
            rag_orchestrator = AgenticRAGOrchestrator()
            rag_result = await rag_orchestrator.execute_claim_analysis(
                claim_data=claim_data,
                patient_data=patient_data
            )
            
            assert rag_result is not None
        
        # 3. ABAC access check
        abac = ABACPolicyEngine()
        user = UserAttributes(
            user_id="billing-user-001",
            roles=["billing_staff"],
            is_authenticated=True,
            mfa_verified=True,
            work_hours_only=False
        )
        resource = ResourceAttributes(
            resource_type="claim",
            resource_id=claim_data["claim_id"],
            owner_organization="clinic-001",
            sensitivity_level="standard"
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True,
            device_trust_level="high"
        )
        
        access_result = abac.evaluate_access(user, resource, env, OperationType.SUBMIT)
        assert access_result["decision"] == "permit"
        
        # 4. Audit logging
        audit_logger = OperationLevelAuditLogger(db=None)
        log_id = await audit_logger.log_operation(
            ai_agent_id="integration-agent",
            ai_workflow_credential="wf-lifecycle-001",
            human_operator_id="billing-user-001",
            human_operator_role="billing_staff",
            human_auth_token="jwt-token",
            human_session_id="sess-001",
            phi_fields_accessed=[
                {"field": "procedure_code", "category": "clinical", "action": "read"},
                {"field": "diagnosis_codes", "category": "clinical", "action": "read"}
            ],
            operation=OperationType.SUBMIT,
            operation_context={"claim_id": claim_data["claim_id"], "pre_submission_score": pre_report.overall_risk_score},
            resource_type="claim",
            resource_id=claim_data["claim_id"],
            resource_owner="clinic-001"
        )
        
        assert log_id is not None
    
    @pytest.mark.asyncio
    async def test_denial_workflow_integration(self):
        """Test denial detection to appeal workflow"""
        
        from denial_management.denial_detector import DenialCategory, denial_detector
        
        # 1. Detect denial
        denial_data = {
            "claim_id": "CLM-DENIED-001",
            "denial_code": "CO-50",
            "denial_reason": "Not medically necessary",
            "procedure_code": "99285",
            "payer_id": "aetna"
        }
        
        category = denial_detector.categorize_denial(denial_data["denial_code"])
        assert category in [DenialCategory.MEDICAL_NECESSITY, DenialCategory.CODE_ISSUE]
        
        # 2. Analyze for appeal
        # 3. Write appeal to EHR
        # (Would need actual API keys for full test)
    
    @pytest.mark.asyncio
    async def test_session_security_integration(self):
        """Test browser hardening with session management"""
        
        session_manager = ServerlessSessionManager()
        hardening = BrowserHardeningEngine()
        
        # Create isolated session
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-sensitive-001"
        )
        
        # Get hardened profile
        profile = hardening.generate_hardened_profile("aetna")
        
        # Verify isolation
        session = session_manager.active_sessions[session_id]
        assert "hardened_profile" in session
        assert session["isolation"]["storage_partition"] is not None
        
        # Simulate detection and mitigation
        blocking_signals = {
            "captcha_detected": True,
            "rate_limited": False
        }
        
        mitigation = await session_manager.detect_and_mitigate_blocking(session_id, blocking_signals)
        
        assert mitigation["detection_score"] > 0
        assert len(mitigation["actions_taken"]) > 0
        
        # Cleanup
        await session_manager.terminate_session(session_id)


class TestDataFlowIntegration:
    """Test data flows between modules"""
    
    @pytest.mark.asyncio
    async def test_pre_submission_to_rag_flow(self):
        """Test claim flows from pre-submission to RAG analysis"""
        
        pre_submission = PreSubmissionEngine(db=None)
        agentic_rag = AgenticRAGOrchestrator()
        
        claim = {
            "claim_id": "FLOW-001",
            "procedure_code": "99285",
            "diagnosis_codes": ["I21.3", "I10"],
            "payer_id": "uhc"
        }
        patient = {
            "clinical_notes": "STEMI presentation. Emergency angiography performed."
        }
        
        # Pre-submission analysis
        pre_report = await pre_submission.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=patient,
            clinical_notes=patient["clinical_notes"]
        )
        
        # If acceptable, do deeper RAG analysis
        if pre_report.overall_risk_score > 0.5:
            rag_result = await agentic_rag.execute_claim_analysis(claim, patient)
            
            # Data should flow through
            assert rag_result.confidence > 0
            assert rag_result.execution_time_ms > 0
    
    @pytest.mark.asyncio
    async def test_abac_to_audit_chain(self):
        """Test ABAC decisions flow to audit logs"""
        
        abac = ABACPolicyEngine()
        audit = OperationLevelAuditLogger(db=None)
        
        user = UserAttributes(
            user_id="test-user",
            roles=["billing_staff"],
            is_authenticated=True,
            mfa_verified=True,
            work_hours_only=False
        )
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="PAT-001",
            owner_organization="clinic-001",
            sensitivity_level="high"
        )
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True
        )
        
        # Evaluate access
        access = abac.evaluate_access(user, resource, env, OperationType.READ)
        
        # Log the access attempt
        log_id = await audit.log_operation(
            ai_agent_id="access-control",
            ai_workflow_credential="abac-check",
            human_operator_id=user.user_id,
            human_operator_role=user.roles[0],
            human_auth_token="access-token",
            human_session_id=user.session_id or "unknown",
            phi_fields_accessed=[],
            operation=OperationType.READ,
            operation_context={"abac_result": access},
            resource_type=resource.resource_type,
            resource_id=resource.resource_id,
            resource_owner=resource.owner_organization
        )
        
        assert log_id is not None
        assert audit.previous_hash is not None


class TestConcurrencyIntegration:
    """Test concurrent operations across modules"""
    
    @pytest.mark.asyncio
    async def test_concurrent_claim_processing(self):
        """Test processing multiple claims concurrently"""
        
        pre_submission = PreSubmissionEngine(db=None)
        
        async def process_claim(claim_num):
            claim = {
                "claim_id": f"CONCURRENT-{claim_num}",
                "procedure_code": "99213",
                "diagnosis_codes": ["I10"]
            }
            patient = {"clinical_notes": f"Visit {claim_num}"}
            
            return await pre_submission.analyze_claim_pre_submission(
                claim_data=claim,
                patient_data=patient,
                clinical_notes=patient["clinical_notes"]
            )
        
        # Process 20 claims concurrently
        tasks = [process_claim(i) for i in range(20)]
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 20
        assert all(r is not None for r in results)
    
    @pytest.mark.asyncio
    async def test_concurrent_session_management(self):
        """Test creating multiple sessions concurrently"""
        
        session_manager = ServerlessSessionManager()
        
        async def create_session(session_num):
            return await session_manager.create_isolated_session(
                payer_id=f"payer-{session_num % 5}",
                patient_id=f"patient-{session_num}"
            )
        
        # Create 50 sessions concurrently
        tasks = [create_session(i) for i in range(50)]
        session_ids = await asyncio.gather(*tasks)
        
        assert len(session_ids) == 50
        assert len(set(session_ids)) == 50  # All unique
        assert len(session_manager.active_sessions) == 50
        
        # Cleanup
        for session_id in session_ids:
            await session_manager.terminate_session(session_id)


class TestErrorHandlingIntegration:
    """Test error handling across module boundaries"""
    
    @pytest.mark.asyncio
    async def test_graceful_degradation_no_api_keys(self):
        """Test system degrades gracefully without API keys"""
        
        # All components should work without API keys (mock/fallback mode)
        rag = AgenticRAGOrchestrator(
            mixedbread_api_key=None,
            fireworks_api_key=None
        )
        
        claim = {"procedure_code": "99213", "diagnosis_codes": ["I10"]}
        patient = {"clinical_notes": "Office visit"}
        
        result = await rag.execute_claim_analysis(claim, patient)
        
        # Should still return result, even if limited
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_invalid_data_handling(self):
        """Test handling of invalid data across modules"""
        
        pre_submission = PreSubmissionEngine(db=None)
        
        # Invalid/empty data
        report = await pre_submission.analyze_claim_pre_submission(
            claim_data={},
            patient_data={},
            clinical_notes=""
        )
        
        # Should not crash, should flag as high risk
        assert report is not None
        assert report.risk_level is not None


class TestSecurityIntegration:
    """Security-focused integration tests"""
    
    @pytest.mark.asyncio
    async def test_phi_protection_chain(self):
        """Test PHI protection across the entire chain"""
        
        abac = ABACPolicyEngine()
        audit = OperationLevelAuditLogger(db=None)
        
        # High-sensitivity PHI
        resource = ResourceAttributes(
            resource_type="patient",
            resource_id="PAT-PHI-001",
            owner_organization="clinic-001",
            sensitivity_level="critical",
            phi_fields=["ssn", "dob", "medical_record_number", "diagnoses"]
        )
        
        # Standard user should be denied
        standard_user = UserAttributes(
            user_id="standard-user",
            roles=["billing_staff"],
            is_authenticated=True,
            mfa_verified=True,
            clearance_level="standard"
        )
        
        env = EnvironmentAttributes(
            timestamp=datetime.utcnow(),
            is_business_hours=True
        )
        
        access = abac.evaluate_access(standard_user, resource, env, OperationType.READ)
        
        # Critical PHI should require admin
        assert access["decision"] == AccessDecision.DENY.value
        
        # Log the denied access
        log_id = await audit.log_operation(
            ai_agent_id="security-test",
            ai_workflow_credential="phi-protection-test",
            human_operator_id=standard_user.user_id,
            human_operator_role=standard_user.roles[0],
            human_auth_token="denied-access",
            human_session_id="test-sess",
            phi_fields_accessed=[{"field": f, "category": "identifiers"} for f in resource.phi_fields],
            operation=OperationType.READ,
            operation_context={"access_denied": True, "reason": "insufficient_clearance"},
            resource_type=resource.resource_type,
            resource_id=resource.resource_id,
            resource_owner=resource.owner_organization
        )
        
        assert log_id is not None
    
    def test_session_isolation(self):
        """Test that sessions are properly isolated"""
        
        session_manager = ServerlessSessionManager()
        
        # Create sessions for different patients
        # (Using asyncio.run since we're in a sync test)
        async def create_sessions():
            session1 = await session_manager.create_isolated_session("aetna", "patient-001")
            session2 = await session_manager.create_isolated_session("aetna", "patient-002")
            
            s1 = session_manager.active_sessions[session1]
            s2 = session_manager.active_sessions[session2]
            
            # Storage partitions should be different
            assert s1["isolation"]["storage_partition"] != s2["isolation"]["storage_partition"]
            
            # Cookie jars should be different
            assert s1["isolation"]["cookie_jar"] != s2["isolation"]["cookie_jar"]
            
            await session_manager.terminate_session(session1)
            await session_manager.terminate_session(session2)
        
        asyncio.run(create_sessions())


class TestPerformanceIntegration:
    """Performance testing across modules"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_performance(self):
        """Test complete workflow performance"""
        
        import time
        
        pre_submission = PreSubmissionEngine(db=None)
        rag = AgenticRAGOrchestrator()
        
        claim = {
            "claim_id": "PERF-001",
            "procedure_code": "99213",
            "diagnosis_codes": ["I10"]
        }
        patient = {"clinical_notes": "Office visit for HTN follow-up"}
        
        start = time.time()
        
        # Pre-submission
        pre_report = await pre_submission.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=patient,
            clinical_notes=patient["clinical_notes"]
        )
        
        # RAG analysis
        rag_result = await rag.execute_claim_analysis(claim, patient)
        
        elapsed = time.time() - start
        
        # Complete workflow should be under 15 seconds
        assert elapsed < 15.0
