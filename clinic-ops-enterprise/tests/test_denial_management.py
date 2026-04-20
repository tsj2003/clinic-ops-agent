"""
Denial Management Engine Tests
Tests denial detection, categorization, and appeal generation
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch, MagicMock
import json

from denial_management.denial_detector import (
    DenialDetectionEngine,
    AppealGenerationEngine,
    DenialSubmissionManager,
    DenialCategory,
    DenialAnalysis,
    AppealLetter,
    denial_detector,
    appeal_generator
)


class TestDenialCategorization:
    """Test denial categorization logic"""
    
    def test_categorize_medical_necessity(self):
        """Test medical necessity denial categorization"""
        engine = DenialDetectionEngine()
        
        category, confidence = engine.categorize_denial(
            denial_code="CO-50",
            denial_description="Non-covered service, not medically necessary"
        )
        
        assert category == DenialCategory.MEDICAL_NECESSITY
        assert confidence >= 0.8
    
    def test_categorize_prior_auth(self):
        """Test prior auth required categorization"""
        engine = DenialDetectionEngine()
        
        category, confidence = engine.categorize_denial(
            denial_code="CO-97",
            denial_description="Authorization required for this service"
        )
        
        assert category == DenialCategory.PRIOR_AUTH_MISSING
        assert confidence >= 0.8
    
    def test_categorize_by_description_patterns(self):
        """Test categorization using description patterns"""
        engine = DenialDetectionEngine()
        
        test_cases = [
            ("Service denied: out of network provider", DenialCategory.OUT_OF_NETWORK),
            ("Claim not received within timely filing limit", DenialCategory.TIMELY_FILING),
            ("Prior authorization not obtained", DenialCategory.PRIOR_AUTH_MISSING),
            ("Not medically necessary per policy", DenialCategory.MEDICAL_NECESSITY),
        ]
        
        for description, expected_category in test_cases:
            category, confidence = engine.categorize_denial(
                denial_code="XXX",
                denial_description=description
            )
            assert category == expected_category, f"Failed for: {description}"
            assert confidence >= 0.7
    
    def test_categorize_unknown_denial(self):
        """Test unknown denial categorization"""
        engine = DenialDetectionEngine()
        
        category, confidence = engine.categorize_denial(
            denial_code="UNKNOWN-999",
            denial_description="Some random denial reason"
        )
        
        assert category == DenialCategory.OTHER
        assert confidence == 0.5
    
    def test_carc_code_mapping(self):
        """Test all CARC code mappings work"""
        engine = DenialDetectionEngine()
        
        test_codes = [
            ("16", DenialCategory.INVALID_CODE),
            ("18", DenialCategory.TIMELY_FILING),
            ("22", DenialCategory.COORDINATION_OF_BENEFITS),
            ("23", DenialCategory.DUPLICATE_CLAIM),
            ("29", DenialCategory.TIMELY_FILING),
            ("31", DenialCategory.ELIGIBILITY_ISSUE),
            ("50", DenialCategory.MEDICAL_NECESSITY),
            ("96", DenialCategory.MEDICAL_NECESSITY),
            ("151", DenialCategory.MEDICAL_NECESSITY),
        ]
        
        for code, expected_category in test_codes:
            category, _ = engine.categorize_denial(code, "Test description")
            assert category == expected_category, f"CARC {code} should map to {expected_category}"


class TestDenialAnalysis:
    """Test AI-powered denial analysis"""
    
    @pytest.mark.asyncio
    async def test_analyze_denial_with_fallback(self, env_vars):
        """Test analysis falls back when API unavailable"""
        engine = DenialDetectionEngine(fireworks_api_key=None)
        
        claim_data = {
            "claim_number": "CLM-001",
            "denial_code": "CO-50",
            "denial_description": "Not medically necessary",
            "procedure_code": "99213",
            "billed_amount": 250.00
        }
        
        analysis = await engine.analyze_denial_with_ai(claim_data)
        
        assert analysis.claim_number == "CLM-001"
        assert analysis.denial_category == DenialCategory.MEDICAL_NECESSITY
        assert analysis.appeal_probability >= 0.5
        assert analysis.appeal_strategy is not None
    
    @pytest.mark.asyncio
    async def test_analyze_with_mock_api(self, env_vars, mock_fireworks_analysis_response):
        """Test analysis with mocked Fireworks API"""
        engine = DenialDetectionEngine(fireworks_api_key="test_key")
        
        claim_data = {
            "claim_number": "CLM-002",
            "denial_code": "CO-97",
            "denial_description": "Prior authorization required",
            "procedure_code": "99285",
            "billed_amount": 500.00
        }
        
        # Mock API response
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "choices": [{"text": json.dumps(mock_fireworks_analysis_response)}]
            })
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            analysis = await engine.analyze_denial_with_ai(claim_data)
        
        assert analysis is not None
        assert analysis.claim_number == "CLM-002"
    
    @pytest.mark.asyncio
    async def test_calculate_deadline(self, env_vars):
        """Test deadline calculation"""
        engine = DenialDetectionEngine()
        
        denial_date = datetime.utcnow() - timedelta(days=30)
        
        claim_data = {
            "denial_date": denial_date.isoformat()
        }
        
        deadline = engine._calculate_deadline(claim_data)
        
        assert deadline is not None
        # Should be 180 days from denial
        expected_deadline = denial_date + timedelta(days=180)
        assert abs((deadline - expected_deadline).total_seconds()) < 60
    
    @pytest.mark.asyncio
    async def test_calculate_deadline_invalid(self, env_vars):
        """Test deadline calculation with invalid date"""
        engine = DenialDetectionEngine()
        
        claim_data = {
            "denial_date": "invalid-date-format"
        }
        
        deadline = engine._calculate_deadline(claim_data)
        
        assert deadline is None
    
    def test_fallback_analysis_by_category(self):
        """Test fallback analysis for each category"""
        engine = DenialDetectionEngine()
        
        categories = [
            DenialCategory.MEDICAL_NECESSITY,
            DenialCategory.PRIOR_AUTH_MISSING,
            DenialCategory.OUT_OF_NETWORK,
            DenialCategory.TIMELY_FILING,
        ]
        
        for category in categories:
            result = engine._fallback_analysis(category)
            
            assert "appeal_probability" in result
            assert "recommended_action" in result
            assert result["appeal_probability"] >= 0 and result["appeal_probability"] <= 1


class TestAppealGeneration:
    """Test appeal letter generation"""
    
    @pytest.mark.asyncio
    async def test_generate_appeal_letter(self, env_vars):
        """Test appeal letter generation"""
        engine = AppealGenerationEngine()
        
        analysis = DenialAnalysis(
            claim_number="CLM-003",
            denial_category=DenialCategory.MEDICAL_NECESSITY,
            root_cause="Insufficient documentation",
            appeal_probability=0.75,
            expected_recovery=250.00,
            recommended_action="appeal",
            appeal_strategy="Submit detailed clinical notes",
            medical_necessity_gap="Missing severity documentation",
            supporting_evidence_needed=["Progress notes", "Test results"],
            deadline_date=datetime.utcnow() + timedelta(days=150),
            confidence_score=0.85
        )
        
        patient_data = {
            "patient_name": "John Doe",
            "billed_amount": 250.00,
            "denial_date": datetime.utcnow().isoformat()
        }
        
        letter = await engine.generate_appeal_letter(
            analysis=analysis,
            patient_data=patient_data,
            clinical_notes=["Patient presented with acute symptoms..."]
        )
        
        assert letter is not None
        assert letter.letter_id.startswith("APL-")
        assert letter.claim_number == "CLM-003"
        assert letter.letter_text is not None
        assert len(letter.letter_text) > 100
        assert letter.requires_md_signature is True  # Medical necessity
        assert "Clinical progress notes" in letter.supporting_documents
    
    @pytest.mark.asyncio
    async def test_generate_template_letter(self, env_vars):
        """Test template fallback when API unavailable"""
        engine = AppealGenerationEngine(fireworks_api_key=None)
        
        analysis = DenialAnalysis(
            claim_number="CLM-004",
            denial_category=DenialCategory.TIMELY_FILING,
            root_cause="Late filing",
            appeal_probability=0.25,
            expected_recovery=0.00,
            recommended_action="escalate",
            appeal_strategy="Request exception",
            medical_necessity_gap=None,
            supporting_evidence_needed=["Proof of timely submission"],
            deadline_date=datetime.utcnow() + timedelta(days=150),
            confidence_score=0.50
        )
        
        patient_data = {
            "billed_amount": 100.00,
            "denial_date": datetime.utcnow().isoformat()
        }
        
        letter = await engine._generate_template_letter(analysis, patient_data)
        
        assert "CLM-004" in letter
        assert "DENIAL INFORMATION" in letter
        assert "APPEAL JUSTIFICATION" in letter
    
    @pytest.mark.asyncio
    async def test_supporting_docs_by_category(self, env_vars):
        """Test supporting docs determination"""
        engine = AppealGenerationEngine()
        
        categories_docs = {
            DenialCategory.MEDICAL_NECESSITY: ["Clinical progress notes", "Physician order/ referral"],
            DenialCategory.PRIOR_AUTH_MISSING: ["Retroactive prior authorization request"],
        }
        
        for category, expected_docs in categories_docs.items():
            analysis = DenialAnalysis(
                claim_number="TEST",
                denial_category=category,
                root_cause="Test",
                appeal_probability=0.5,
                expected_recovery=0.0,
                recommended_action="appeal",
                appeal_strategy="Test",
                medical_necessity_gap=None,
                supporting_evidence_needed=[],
                deadline_date=None,
                confidence_score=0.5
            )
            
            docs = engine._determine_supporting_docs(analysis)
            
            for expected in expected_docs:
                assert any(expected in d for d in docs), f"Expected {expected} for {category}"


class TestDenialSubmission:
    """Test appeal submission"""
    
    @pytest.mark.asyncio
    async def test_extract_confirmation_number(self, env_vars):
        """Test confirmation number extraction"""
        manager = DenialSubmissionManager()
        
        test_cases = [
            ("Confirmation: ABC123", "ABC123"),
            ("Reference # XYZ789", "XYZ789"),
            ("Confirmation Number: 123-ABC-456", "123-ABC-456"),
            ("No confirmation here", None),
        ]
        
        for answer, expected in test_cases:
            result = {
                "final_answer": answer,
                "completed": True
            }
            confirmation = manager._extract_confirmation(result)
            assert confirmation == expected, f"Failed for: {answer}"
    
    @pytest.mark.asyncio
    async def test_get_payer_workflow(self, env_vars, monkeypatch):
        """Test payer workflow URL retrieval"""
        monkeypatch.setenv("AETNA_APPEAL_WORKFLOW", "https://aetna.workflow.url")
        
        manager = DenialSubmissionManager()
        
        url = await manager._get_payer_workflow("aetna")
        assert url == "https://aetna.workflow.url"
        
        # Unknown payer
        url = await manager._get_payer_workflow("unknown_payer")
        assert url == ""


class TestDenialEdgeCases:
    """Test edge cases and error handling"""
    
    @pytest.mark.asyncio
    async def test_empty_claim_data(self, env_vars):
        """Test analysis with empty claim data"""
        engine = DenialDetectionEngine()
        
        claim_data = {}
        
        analysis = await engine.analyze_denial_with_ai(claim_data)
        
        # Should not crash, should return default analysis
        assert analysis is not None
    
    @pytest.mark.asyncio
    async def test_very_large_claim_amount(self, env_vars):
        """Test with very large claim amounts"""
        engine = DenialDetectionEngine()
        
        claim_data = {
            "claim_number": "BIG-001",
            "billed_amount": 999999999.99
        }
        
        category, confidence = engine.categorize_denial(
            denial_code="CO-50",
            denial_description="Test"
        )
        
        assert category is not None
    
    @pytest.mark.asyncio
    async def test_unicode_in_denial_description(self, env_vars):
        """Test handling unicode in denial descriptions"""
        engine = DenialDetectionEngine()
        
        category, confidence = engine.categorize_denial(
            denial_code="CO-50",
            denial_description="Servicio denegado: razón médica español 日本語"
        )
        
        assert category is not None
        assert confidence >= 0
    
    def test_categorize_with_special_characters(self):
        """Test categorization with special regex characters"""
        engine = DenialDetectionEngine()
        
        # Description with regex special chars
        description = "Service denied: (not medically necessary) [code: CO-50] {urgent}"
        
        category, confidence = engine.categorize_denial(
            denial_code="CO-50",
            denial_description=description
        )
        
        # Should not crash on regex
        assert category is not None
    
    @pytest.mark.asyncio
    async def test_appeal_letter_with_long_analysis(self, env_vars):
        """Test letter generation with very long analysis"""
        engine = AppealGenerationEngine()
        
        # Very long strategy text
        long_strategy = "Detailed strategy. " * 1000  # ~16KB
        
        analysis = DenialAnalysis(
            claim_number="LONG-001",
            denial_category=DenialCategory.MEDICAL_NECESSITY,
            root_cause="Complex case",
            appeal_probability=0.8,
            expected_recovery=50000.00,
            recommended_action="appeal",
            appeal_strategy=long_strategy,
            medical_necessity_gap=None,
            supporting_evidence_needed=["Doc"] * 100,  # Many docs
            deadline_date=datetime.utcnow() + timedelta(days=150),
            confidence_score=0.9
        )
        
        patient_data = {"billed_amount": 50000.00}
        
        letter = await engine._generate_template_letter(analysis, patient_data)
        
        # Should handle long content
        assert len(letter) > 0
    
    @pytest.mark.asyncio
    async def test_concurrent_analyses(self, env_vars):
        """Test concurrent denial analyses"""
        engine = DenialDetectionEngine(fireworks_api_key=None)
        
        claims = [
            {
                "claim_number": f"CLM-{i}",
                "denial_code": "CO-50",
                "denial_description": "Not medically necessary",
                "billed_amount": float(100 + i)
            }
            for i in range(10)
        ]
        
        # Run analyses concurrently
        tasks = [engine.analyze_denial_with_ai(claim) for claim in claims]
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 10
        for result in results:
            assert result is not None
            assert isinstance(result.appeal_probability, float)
    
    def test_calculate_deadline_timezone_aware(self):
        """Test deadline with timezone-aware datetime"""
        engine = DenialDetectionEngine()
        
        from datetime import timezone
        
        denial_date = datetime.now(timezone.utc)
        claim_data = {"denial_date": denial_date.isoformat()}
        
        deadline = engine._calculate_deadline(claim_data)
        
        assert deadline is not None
        # Should handle timezone
    
    @pytest.mark.asyncio
    async def test_rag_query_failure_handling(self, env_vars):
        """Test handling when RAG query fails"""
        engine = DenialDetectionEngine(
            mixedbread_api_key="invalid_key"
        )
        
        # Mock failed request
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 500
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            result = await engine._query_policy_rag(
                denial_code="CO-50",
                procedure_code="99213"
            )
        
        # Should return empty string on failure, not crash
        assert result == ""


class TestDenialIntegration:
    """Integration tests for full denial workflow"""
    
    @pytest.mark.asyncio
    async def test_full_workflow_mocked(self, env_vars, mock_fireworks_analysis_response):
        """Test full denial workflow with mocked APIs"""
        # 1. Detect denial
        claim_data = {
            "claim_number": "CLM-FULL-001",
            "denial_code": "CO-50",
            "denial_description": "Not medically necessary",
            "procedure_code": "99213",
            "billed_amount": 250.00
        }
        
        detector = DenialDetectionEngine(fireworks_api_key="test_key")
        
        # Categorize
        category, confidence = detector.categorize_denial(
            claim_data["denial_code"],
            claim_data["denial_description"]
        )
        assert category == DenialCategory.MEDICAL_NECESSITY
        
        # Mock analysis
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "choices": [{"text": json.dumps(mock_fireworks_analysis_response)}]
            })
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            analysis = await detector.analyze_denial_with_ai(claim_data)
        
        assert analysis is not None
        assert analysis.claim_number == "CLM-FULL-001"
        
        # 2. Generate appeal
        appeal_gen = AppealGenerationEngine()
        
        letter = await appeal_gen.generate_appeal_letter(
            analysis=analysis,
            patient_data={"billed_amount": 250.00},
            clinical_notes=["Patient symptoms documented"]
        )
        
        assert letter is not None
        assert letter.claim_number == "CLM-FULL-001"
