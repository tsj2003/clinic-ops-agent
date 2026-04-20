"""
Hardcore Testing for Agentic RAG Framework
Comprehensive tests for multi-hop reasoning and concurrent agents
"""

import pytest
import asyncio
import json
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
from orchestrator.agentic_rag import (
    AgenticRAGOrchestrator, SpecializedRAGAgent, EligibilityVerificationAgent,
    MedicalNecessityAgent, PriorAuthRequirementsAgent, CodingAccuracyAgent,
    AgentTask, AgentState, RAGResult, RAGNode, RAGNodeType
)


class TestSpecializedAgents:
    """Test individual specialized agents"""
    
    @pytest.fixture
    def eligibility_agent(self):
        return EligibilityVerificationAgent()
    
    @pytest.fixture
    def medical_necessity_agent(self):
        return MedicalNecessityAgent()
    
    @pytest.fixture
    def prior_auth_agent(self):
        return PriorAuthRequirementsAgent()
    
    @pytest.fixture
    def coding_agent(self):
        return CodingAccuracyAgent()
    
    @pytest.mark.asyncio
    async def test_eligibility_agent_basic(self, eligibility_agent):
        """Test eligibility verification agent"""
        task = AgentTask(
            task_id="eligibility-001",
            agent_name="EligibilityVerificationAgent",
            agent_type="eligibility",
            query="Check eligibility",
            context={
                "patient_id": "patient-123",
                "insurance_id": "ins-aetna-001",
                "service_code": "99213"
            }
        )
        
        result = await eligibility_agent.execute(task)
        
        assert "agent" in result
        assert result["agent"] == "EligibilityVerificationAgent"
        assert "is_eligible" in result
        assert "verification_confidence" in result
    
    @pytest.mark.asyncio
    async def test_eligibility_agent_missing_data(self, eligibility_agent):
        """Test eligibility agent with missing data"""
        task = AgentTask(
            task_id="eligibility-002",
            agent_name="EligibilityVerificationAgent",
            agent_type="eligibility",
            query="Check eligibility",
            context={}  # Empty context
        )
        
        result = await eligibility_agent.execute(task)
        
        # Should still return result, may indicate issues found
        assert "agent" in result
    
    @pytest.mark.asyncio
    async def test_medical_necessity_agent_no_api(self, medical_necessity_agent):
        """Test medical necessity agent without API key"""
        task = AgentTask(
            task_id="med-nec-001",
            agent_name="MedicalNecessityAgent",
            agent_type="medical_necessity",
            query="Check medical necessity",
            context={
                "clinical_notes": "Patient presents with chest pain. EKG shows normal sinus rhythm.",
                "cpt_code": "93000",
                "diagnosis_codes": ["R07.9"]
            }
        )
        
        result = await medical_necessity_agent.execute(task)
        
        # Should gracefully handle missing API
        assert "adequate" in result or "error" in result
    
    @pytest.mark.asyncio
    async def test_medical_necessity_agent_with_notes(self, medical_necessity_agent):
        """Test with comprehensive clinical notes"""
        long_notes = """
        Chief Complaint: Chest pain for 2 hours
        
        History of Present Illness:
        Patient is a 45-year-old male who presents with sharp, substernal chest pain 
        radiating to left arm. Pain started at rest and is 8/10 severity. Associated 
        with shortness of breath and diaphoresis. No relief with rest.
        
        Past Medical History: Hypertension, hyperlipidemia
        Family History: Father had MI at age 50
        
        Physical Examination:
        BP 180/110, HR 98, RR 22, O2 sat 94% on room air
        Appears diaphoretic and in moderate distress
        Heart: RRR, no murmurs
        Lungs: Clear bilaterally
        
        Assessment: Acute chest pain, rule out ACS
        Plan: EKG, troponins, cardiology consult
        """
        
        task = AgentTask(
            task_id="med-nec-002",
            agent_name="MedicalNecessityAgent",
            agent_type="medical_necessity",
            query="Check medical necessity for EKG",
            context={
                "clinical_notes": long_notes,
                "cpt_code": "93000",
                "diagnosis_codes": ["R07.9", "I25.9"]
            }
        )
        
        result = await medical_necessity_agent.execute(task)
        
        assert "agent" in result
        assert result["agent"] == "MedicalNecessityAgent"
    
    @pytest.mark.asyncio
    async def test_prior_auth_agent(self, prior_auth_agent):
        """Test prior auth requirements agent"""
        task = AgentTask(
            task_id="prior-auth-001",
            agent_name="PriorAuthRequirementsAgent",
            agent_type="prior_auth",
            query="Check prior auth requirements",
            context={
                "cpt_code": "99285",
                "payer_id": "aetna"
            }
        )
        
        result = await prior_auth_agent.execute(task)
        
        assert "prior_auth_required" in result
        assert "confidence" in result
    
    @pytest.mark.asyncio
    async def test_coding_agent_valid_cpt(self, coding_agent):
        """Test coding accuracy with valid CPT"""
        task = AgentTask(
            task_id="coding-001",
            agent_name="CodingAccuracyAgent",
            agent_type="coding",
            query="Verify coding",
            context={
                "cpt_code": "99213",
                "diagnosis_codes": ["I10", "E11.9"],
                "clinical_notes": "Office visit for follow-up of hypertension and diabetes."
            }
        )
        
        result = await coding_agent.execute(task)
        
        assert "cpt_valid" in result
        assert "icd10_valid" in result
        assert result["cpt_valid"] == True
    
    @pytest.mark.asyncio
    async def test_coding_agent_invalid_cpt(self, coding_agent):
        """Test coding accuracy with invalid CPT"""
        task = AgentTask(
            task_id="coding-002",
            agent_name="CodingAccuracyAgent",
            agent_type="coding",
            query="Verify coding",
            context={
                "cpt_code": "ABCDE",  # Invalid
                "diagnosis_codes": ["INVALID"],
                "clinical_notes": ""
            }
        )
        
        result = await coding_agent.execute(task)
        
        assert result["cpt_valid"] == False
    
    def test_cpt_format_validation(self, coding_agent):
        """Test CPT format validation directly"""
        assert coding_agent._validate_cpt_format("99213") == True
        assert coding_agent._validate_cpt_format("12345") == True
        assert coding_agent._validate_cpt_format("ABCDE") == False
        assert coding_agent._validate_cpt_format("1234") == False  # Too short
        assert coding_agent._validate_cpt_format("123456") == False  # Too long
        assert coding_agent._validate_cpt_format("") == False
        assert coding_agent._validate_cpt_format(None) == False
    
    def test_icd10_format_validation(self, coding_agent):
        """Test ICD-10 format validation directly"""
        assert coding_agent._validate_icd10_format("I10") == True
        assert coding_agent._validate_icd10_format("E11.9") == True
        assert coding_agent._validate_icd10_format("A00.00") == True
        assert coding_agent._validate_icd10_format("123.4") == False  # Must start with letter
        assert coding_agent._validate_icd10_format("I") == False  # Too short
        assert coding_agent._validate_icd10_format("I10.123") == False  # Too many decimals
        assert coding_agent._validate_icd10_format("") == False


class TestAgenticRAGOrchestrator:
    """Test the main orchestrator"""
    
    @pytest.fixture
    def orchestrator(self):
        return AgenticRAGOrchestrator()
    
    @pytest.fixture
    def sample_claim_data(self):
        return {
            "claim_id": "claim-123",
            "procedure_code": "99213",
            "procedure_description": "Office visit, established patient",
            "diagnosis_codes": ["I10", "E11.9"],
            "payer_id": "aetna",
            "billed_amount": 150.00,
            "modifiers": ["25"]
        }
    
    @pytest.fixture
    def sample_patient_data(self):
        return {
            "id": "patient-456",
            "name": "John Doe",
            "clinical_notes": """
            Chief Complaint: Follow-up for hypertension
            
            History: Patient has well-controlled hypertension on lisinopril.
            BP today 128/82. No complaints. Continue current medications.
            
            Assessment: Essential hypertension, controlled
            Plan: Continue lisinopril, follow up in 3 months
            """,
            "insurance": {
                "id": "ins-aetna-001",
                "plan": "PPO"
            },
            "age": 55,
            "gender": "male"
        }
    
    @pytest.mark.asyncio
    async def test_execute_claim_analysis(self, orchestrator, sample_claim_data, sample_patient_data):
        """Test full claim analysis execution"""
        result = await orchestrator.execute_claim_analysis(
            claim_data=sample_claim_data,
            patient_data=sample_patient_data
        )
        
        assert isinstance(result, RAGResult)
        assert result.query == "claim_pre_submission_analysis"
        assert result.answer is not None
        assert len(result.reasoning_path) > 0
        assert result.confidence >= 0.0 and result.confidence <= 1.0
        assert result.execution_time_ms > 0
        assert "eligibility" in result.agent_contributions
    
    @pytest.mark.asyncio
    async def test_concurrent_agent_execution(self, orchestrator, sample_claim_data, sample_patient_data):
        """Test that agents execute concurrently"""
        import time
        
        start = time.time()
        result = await orchestrator.execute_claim_analysis(
            claim_data=sample_claim_data,
            patient_data=sample_patient_data
        )
        elapsed = (time.time() - start) * 1000
        
        # Should complete relatively quickly (all agents run in parallel)
        # If sequential, would take much longer
        assert elapsed < 5000  # Should complete in under 5 seconds
        
        # All 4 agents should have contributed
        assert len(result.agent_contributions) >= 4
    
    @pytest.mark.asyncio
    async def test_empty_claim_data(self, orchestrator):
        """Test with minimal/empty claim data"""
        result = await orchestrator.execute_claim_analysis(
            claim_data={},
            patient_data={}
        )
        
        # Should still return a result, even if incomplete
        assert isinstance(result, RAGResult)
    
    @pytest.mark.asyncio
    async def test_missing_clinical_notes(self, orchestrator, sample_claim_data):
        """Test with missing clinical notes"""
        patient_data = {"id": "patient-001", "clinical_notes": ""}
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=sample_claim_data,
            patient_data=patient_data
        )
        
        assert isinstance(result, RAGResult)
        # Medical necessity may flag missing documentation
    
    @pytest.mark.asyncio
    async def test_multiple_diagnosis_codes(self, orchestrator):
        """Test with many diagnosis codes"""
        claim_data = {
            "procedure_code": "99285",
            "diagnosis_codes": ["I10", "E11.9", "J44.1", "M79.1", "K21.9", "Z51.11"]
        }
        patient_data = {
            "clinical_notes": "Multiple chronic conditions. Emergency visit.",
            "age": 70
        }
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=claim_data,
            patient_data=patient_data
        )
        
        assert isinstance(result, RAGResult)


class TestRAGSynthesis:
    """Test result synthesis logic"""
    
    @pytest.fixture
    def orchestrator(self):
        return AgenticRAGOrchestrator()
    
    @pytest.mark.asyncio
    async def test_synthesize_all_approved(self, orchestrator):
        """Test synthesis when all agents approve"""
        results = {
            "eligibility": {"is_eligible": True, "verification_confidence": 0.9},
            "medical_necessity": {"documentation_adequate": True, "medical_necessity_score": 0.85},
            "prior_auth": {"prior_auth_required": False, "confidence": 0.9},
            "coding": {"overall_accuracy": 0.95, "cpt_valid": True, "icd10_valid": True}
        }
        
        synthesis = await orchestrator._synthesize_results(results)
        
        assert synthesis["recommendation"] == "Proceed with claim submission"
        assert synthesis["status"] == "approved"
        assert synthesis["confidence"] > 0.8
    
    @pytest.mark.asyncio
    async def test_synthesize_with_issues(self, orchestrator):
        """Test synthesis when some agents find issues"""
        results = {
            "eligibility": {"is_eligible": False, "verification_confidence": 0.4, "issues_found": ["Coverage expired"]},
            "medical_necessity": {"documentation_adequate": True, "medical_necessity_score": 0.85},
            "prior_auth": {"prior_auth_required": True, "confidence": 0.9},
            "coding": {"overall_accuracy": 0.6, "cpt_valid": True, "icd10_valid": True}
        }
        
        synthesis = await orchestrator._synthesize_results(results)
        
        assert synthesis["status"] == "blocked" or synthesis["status"] == "conditional"
        assert len(synthesis["issues"]) > 0
    
    @pytest.mark.asyncio
    async def test_synthesize_critical_mismatch(self, orchestrator):
        """Test synthesis with critical code-documentation mismatch"""
        results = {
            "eligibility": {"is_eligible": True, "verification_confidence": 0.9},
            "medical_necessity": {
                "documentation_adequate": False,
                "medical_necessity_score": 0.3,
                "missing": ["Chief complaint", "Exam findings"]
            },
            "prior_auth": {"prior_auth_required": False, "confidence": 0.9},
            "coding": {"overall_accuracy": 0.9, "cpt_valid": True}
        }
        
        synthesis = await orchestrator._synthesize_results(results)
        
        assert synthesis["status"] in ["blocked", "conditional"]
        assert synthesis["confidence"] < 0.7


class TestRAGExecutionGraph:
    """Test RAG execution graph structure"""
    
    @pytest.fixture
    def orchestrator(self):
        return AgenticRAGOrchestrator()
    
    def test_execution_graph_built(self, orchestrator):
        """Test execution graph is properly built"""
        assert len(orchestrator.execution_graph) > 0
        
        # Check for expected nodes
        assert "eligibility_check" in orchestrator.execution_graph
        assert "medical_necessity_check" in orchestrator.execution_graph
        assert "combine_results" in orchestrator.execution_graph
    
    def test_node_dependencies(self, orchestrator):
        """Test node dependency relationships"""
        combine_node = orchestrator.execution_graph.get("combine_results")
        assert combine_node is not None
        
        # Combine node should depend on agent nodes
        assert len(combine_node.inputs) > 0
        assert "eligibility_check" in combine_node.inputs
    
    def test_parallel_execution_marked(self, orchestrator):
        """Test that agent nodes are marked for parallel execution"""
        eligibility_node = orchestrator.execution_graph.get("eligibility_check")
        assert eligibility_node.parallel == True


class TestAgentTaskStates:
    """Test agent task state management"""
    
    def test_task_initial_state(self):
        """Test task starts in IDLE state"""
        task = AgentTask(
            task_id="test-001",
            agent_name="TestAgent",
            agent_type="test",
            query="Test query",
            context={}
        )
        
        assert task.state == AgentState.IDLE
        assert task.result is None
        assert task.error is None
    
    def test_task_with_dependencies(self):
        """Test task with dependencies"""
        task = AgentTask(
            task_id="test-002",
            agent_name="TestAgent",
            agent_type="test",
            query="Test query",
            context={},
            dependencies={"task-001", "task-003"}
        )
        
        assert "task-001" in task.dependencies
        assert "task-003" in task.dependencies


class TestRAGEdgeCases:
    """Edge case testing"""
    
    @pytest.fixture
    def orchestrator(self):
        return AgenticRAGOrchestrator()
    
    @pytest.mark.asyncio
    async def test_unicode_in_claim_data(self, orchestrator):
        """Test with unicode characters in data"""
        claim_data = {
            "procedure_code": "99213",
            "diagnosis_codes": ["Z00.00"],
            "payer_id": "aetna"
        }
        patient_data = {
            "name": "José García Müller",
            "clinical_notes": "Patient complains of dolor. Exam reveals normal findings."
        }
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=claim_data,
            patient_data=patient_data
        )
        
        assert isinstance(result, RAGResult)
    
    @pytest.mark.asyncio
    async def test_very_long_clinical_notes(self, orchestrator):
        """Test with very long clinical notes"""
        claim_data = {"procedure_code": "99285"}
        patient_data = {
            "clinical_notes": "Chief Complaint: " + "Patient has pain. " * 1000  # Very long
        }
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=claim_data,
            patient_data=patient_data
        )
        
        assert isinstance(result, RAGResult)
    
    @pytest.mark.asyncio
    async def test_special_characters_in_codes(self, orchestrator):
        """Test with special characters in medical codes"""
        claim_data = {
            "procedure_code": "99213-TC",  # With modifier
            "diagnosis_codes": ["E11.9", "I10 (essential hypertension)"],
            "payer_id": "aetna-special"
        }
        patient_data = {"clinical_notes": "Regular visit"}
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=claim_data,
            patient_data=patient_data
        )
        
        assert isinstance(result, RAGResult)
    
    @pytest.mark.asyncio
    async def test_missing_required_fields(self, orchestrator):
        """Test with missing required fields"""
        claim_data = {}  # Empty
        patient_data = {}  # Empty
        
        result = await orchestrator.execute_claim_analysis(
            claim_data=claim_data,
            patient_data=patient_data
        )
        
        # Should not crash
        assert isinstance(result, RAGResult)
    
    @pytest.mark.asyncio
    async def test_concurrent_orchestrator_calls(self, orchestrator):
        """Test multiple concurrent orchestrator calls"""
        tasks = []
        
        for i in range(5):
            claim = {"procedure_code": f"9921{i}", "diagnosis_codes": ["I10"]}
            patient = {"clinical_notes": f"Visit {i}"}
            tasks.append(orchestrator.execute_claim_analysis(claim, patient))
        
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 5
        for result in results:
            assert isinstance(result, RAGResult)


class TestRAGPerformance:
    """Performance and load testing"""
    
    @pytest.fixture
    def orchestrator(self):
        return AgenticRAGOrchestrator()
    
    @pytest.mark.asyncio
    async def test_execution_time_under_threshold(self, orchestrator):
        """Test that analysis completes within acceptable time"""
        import time
        
        claim_data = {
            "procedure_code": "99213",
            "diagnosis_codes": ["I10"],
            "payer_id": "aetna"
        }
        patient_data = {
            "clinical_notes": "Regular follow-up visit. BP stable."
        }
        
        start = time.time()
        result = await orchestrator.execute_claim_analysis(claim_data, patient_data)
        elapsed = (time.time() - start) * 1000
        
        # Should complete in under 10 seconds even with API calls
        assert elapsed < 10000
        assert result.execution_time_ms > 0
    
    @pytest.mark.asyncio
    async def test_memory_efficiency(self, orchestrator):
        """Test memory doesn't balloon with repeated calls"""
        import gc
        
        initial_count = len(gc.get_objects())
        
        for i in range(10):
            await orchestrator.execute_claim_analysis(
                claim_data={"procedure_code": "99213"},
                patient_data={"clinical_notes": "Visit"}
            )
        
        gc.collect()
        final_count = len(gc.get_objects())
        
        # Memory shouldn't grow excessively
        growth = final_count - initial_count
        assert growth < 10000  # Reasonable growth limit
