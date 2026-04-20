"""
Hardcore Testing for Pre-Submission Engine
Highest-ROI feature: catch errors BEFORE claim submission
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock
from self_healing.pre_submission_engine import (
    PreSubmissionEngine, NLPDocumentationAnalyzer, HistoricalPatternAnalyzer,
    PreSubmissionIssue, PreSubmissionReport, RiskLevel, IssueType
)


class TestNLPDocumentationAnalyzer:
    """Test NLP documentation analysis"""
    
    @pytest.fixture
    def nlp_analyzer(self):
        return NLPDocumentationAnalyzer()
    
    @pytest.mark.asyncio
    async def test_analyze_documentation_no_api(self, nlp_analyzer):
        """Test analysis without API key"""
        result = await nlp_analyzer.analyze_documentation(
            clinical_notes="Patient presents with chest pain.",
            cpt_code="99213",
            cpt_description="Office visit",
            icd10_codes=["R07.9"]
        )
        
        assert "adequate" in result
        assert "confidence" in result
        # Without API, should return conservative assessment
    
    @pytest.mark.asyncio
    async def test_analyze_documentation_empty_notes(self, nlp_analyzer):
        """Test analysis with empty clinical notes"""
        result = await nlp_analyzer.analyze_documentation(
            clinical_notes="",
            cpt_code="99213",
            cpt_description="Office visit",
            icd10_codes=["I10"]
        )
        
        assert result["adequate"] == False
        assert "No documentation available" in result.get("missing_elements", [])
    
    @pytest.mark.asyncio
    async def test_analyze_documentation_comprehensive_notes(self, nlp_analyzer):
        """Test analysis with comprehensive clinical notes"""
        comprehensive_notes = """
        Chief Complaint: Chest pain for 2 hours
        
        History of Present Illness:
        Patient is a 45-year-old male who presents with sharp, substernal chest pain 
        radiating to left arm. Pain started at rest and is 8/10 severity. 
        Associated with shortness of breath and diaphoresis. No relief with rest.
        
        Past Medical History: Hypertension, hyperlipidemia, smoker 20 pack-years
        Family History: Father had MI at age 50
        
        Physical Examination:
        BP 180/110, HR 98, RR 22, O2 sat 94% on room air
        Appears diaphoretic and in moderate distress
        Heart: RRR, no murmurs, no rubs
        Lungs: Clear bilaterally, no wheezes, no rales
        Abdomen: Soft, non-tender
        
        Diagnostic Studies:
        EKG: ST elevation in leads V1-V4
        Troponin I: 2.5 ng/mL (elevated)
        CXR: Clear
        
        Assessment: STEMI (ST-elevation myocardial infarction)
        Plan: Activate cath lab, aspirin 325mg, ticagrelor loading dose
        """
        
        result = await nlp_analyzer.analyze_documentation(
            clinical_notes=comprehensive_notes,
            cpt_code="99285",  # Emergency visit
            cpt_description="Emergency department visit",
            icd10_codes=["I21.3"],  # STEMI
            modifiers=["25"]
        )
        
        assert "agent" not in result  # This is a result, not an agent response
        assert "adequate" in result or "error" in result
    
    def test_extract_clinical_elements(self, nlp_analyzer):
        """Test extraction of key clinical elements"""
        notes = """
        Chief Complaint: Abdominal pain
        History: Patient has abdominal pain for 3 days
        Physical Exam: Abdomen soft, tender in RLQ
        Assessment: Rule out appendicitis
        Plan: CT abdomen/pelvis, surgical consult
        """
        
        elements = nlp_analyzer.extract_key_clinical_elements(notes)
        
        assert "chief_complaint" in elements
        assert "exam_findings" in elements
        assert len(elements["chief_complaint"]) > 0
    
    def test_extract_clinical_elements_empty(self, nlp_analyzer):
        """Test extraction with empty notes"""
        elements = nlp_analyzer.extract_key_clinical_elements("")
        
        assert elements["chief_complaint"] == []
        assert elements["exam_findings"] == []
    
    def test_fallback_parse(self, nlp_analyzer):
        """Test fallback parsing for non-JSON responses"""
        # Test with various malformed inputs
        text1 = "adequate: true, confidence: 0.8"
        result1 = nlp_analyzer._fallback_parse(text1)
        assert "adequate" in result1
        
        text2 = "This documentation is adequate with confidence 0.85"
        result2 = nlp_analyzer._fallback_parse(text2)
        assert result2["adequate"] == True


class TestHistoricalPatternAnalyzer:
    """Test historical denial pattern analysis"""
    
    @pytest.fixture
    def mock_db(self):
        return Mock()
    
    @pytest.fixture
    def pattern_analyzer(self, mock_db):
        return HistoricalPatternAnalyzer(db=mock_db)
    
    @pytest.mark.asyncio
    async def test_analyze_no_db(self):
        """Test analysis without database"""
        analyzer = HistoricalPatternAnalyzer(db=None)
        
        result = await analyzer.analyze_historical_patterns(
            claim_data={"procedure_code": "99213"},
            lookback_months=12
        )
        
        assert result["similar_claims_count"] == 0
        assert result["historical_denial_rate"] == 0.1  # Default
    
    def test_identify_risk_factors_high_denial(self, pattern_analyzer):
        """Test risk factor identification with high denial rate"""
        factors = pattern_analyzer._identify_risk_factors(
            denial_rate=0.45,
            common_reasons=[("Medical necessity not established", 10), ("Missing documentation", 5)]
        )
        
        assert len(factors) > 0
        assert any("45%" in f for f in factors)
    
    def test_identify_risk_factors_low_denial(self, pattern_analyzer):
        """Test risk factor identification with low denial rate"""
        factors = pattern_analyzer._identify_risk_factors(
            denial_rate=0.05,
            common_reasons=[]
        )
        
        assert len(factors) == 0  # No risk factors with low denial rate


class TestPreSubmissionEngine:
    """Test main pre-submission engine"""
    
    @pytest.fixture
    def engine(self):
        return PreSubmissionEngine(db=None)
    
    @pytest.fixture
    def sample_claim(self):
        return {
            "claim_id": "CLM-123",
            "procedure_code": "99213",
            "procedure_description": "Office visit, established patient",
            "diagnosis_codes": ["I10", "E11.9"],
            "payer_id": "aetna",
            "billed_amount": 150.00
        }
    
    @pytest.fixture
    def sample_patient(self):
        return {
            "id": "PAT-456",
            "name": "John Doe",
            "age": 55,
            "gender": "male"
        }
    
    @pytest.fixture
    def good_clinical_notes(self):
        return """
        Chief Complaint: Follow-up for hypertension and diabetes
        
        History of Present Illness:
        Patient is a 55-year-old male with known hypertension and type 2 diabetes.
        Last visit 3 months ago. Reports good medication compliance.
        BP readings at home averaging 130/85. Blood sugars well controlled on
        current metformin regimen. No hypoglycemic episodes.
        
        Past Medical History:
        - Essential hypertension, diagnosed 2018
        - Type 2 diabetes mellitus, diagnosed 2019
        - Hyperlipidemia
        
        Current Medications:
        - Lisinopril 20mg daily
        - Metformin 1000mg twice daily
        - Atorvastatin 40mg daily
        
        Physical Examination:
        BP 132/84, HR 72, RR 16, Temp 98.6F, O2 sat 98%
        General: Well-appearing, in no acute distress
        HEENT: Normocephalic, atraumatic
        Cardiovascular: Regular rate and rhythm, no murmurs
        Respiratory: Clear to auscultation bilaterally
        Abdomen: Soft, non-tender, non-distended
        Extremities: No edema
        
        Assessment:
        1. Essential hypertension, well-controlled
        2. Type 2 diabetes mellitus without complications, well-controlled
        3. Hyperlipidemia
        
        Plan:
        1. Continue current antihypertensive regimen
        2. Continue metformin, A1c in 3 months
        3. Continue statin therapy
        4. Follow up in 3 months or sooner if issues
        """
    
    @pytest.fixture
    def poor_clinical_notes(self):
        return """
        Follow-up visit. Patient doing well. Continue meds.
        """
    
    @pytest.mark.asyncio
    async def test_analyze_good_claim(self, engine, sample_claim, sample_patient, good_clinical_notes):
        """Test analysis of well-documented claim"""
        report = await engine.analyze_claim_pre_submission(
            claim_data=sample_claim,
            patient_data=sample_patient,
            clinical_notes=good_clinical_notes
        )
        
        assert isinstance(report, PreSubmissionReport)
        assert report.claim_id == "CLM-123"
        assert report.overall_risk_score >= 0.0 and report.overall_risk_score <= 1.0
        assert report.can_submit == True or report.requires_human_review == True
    
    @pytest.mark.asyncio
    async def test_analyze_poor_documentation(self, engine, sample_claim, sample_patient, poor_clinical_notes):
        """Test analysis of poorly documented claim"""
        report = await engine.analyze_claim_pre_submission(
            claim_data=sample_claim,
            patient_data=sample_patient,
            clinical_notes=poor_clinical_notes
        )
        
        assert isinstance(report, PreSubmissionReport)
        # Should flag for review due to poor documentation
        assert len(report.issues) > 0 or len(report.documentation_gaps) > 0
    
    @pytest.mark.asyncio
    async def test_missing_procedure_code(self, engine, sample_patient, good_clinical_notes):
        """Test analysis with missing procedure code"""
        claim = {"claim_id": "CLM-001"}  # Missing procedure_code
        
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=sample_patient,
            clinical_notes=good_clinical_notes
        )
        
        assert isinstance(report, PreSubmissionReport)
        assert report.claim_id == "CLM-001"
    
    @pytest.mark.asyncio
    async def test_missing_clinical_notes(self, engine, sample_claim, sample_patient):
        """Test analysis with missing clinical notes"""
        report = await engine.analyze_claim_pre_submission(
            claim_data=sample_claim,
            patient_data=sample_patient,
            clinical_notes=""
        )
        
        assert isinstance(report, PreSubmissionReport)
        # Should have high risk due to missing documentation
        assert report.overall_risk_score < 0.5 or len(report.issues) > 0
    
    @pytest.mark.asyncio
    async def test_multiple_diagnosis_codes(self, engine, sample_patient):
        """Test with many diagnosis codes"""
        claim = {
            "claim_id": "CLM-COMPLEX",
            "procedure_code": "99285",
            "diagnosis_codes": ["I21.3", "I10", "E11.9", "J44.1", "N18.3", "Z79.4"]
        }
        
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=sample_patient,
            clinical_notes="Complex patient with multiple comorbidities"
        )
        
        assert isinstance(report, PreSubmissionReport)
    
    def test_calculate_risk_score_weights(self, engine):
        """Test risk score calculation with different weights"""
        doc_analysis = {"adequate": True}
        historical = {"historical_denial_rate": 0.1}
        claim_data = {"diagnosis_codes": ["I10"]}
        
        score = engine._calculate_risk_score(
            doc_analysis=doc_analysis,
            historical=historical,
            claim_data=claim_data,
            issue_count=0
        )
        
        assert score >= 0.0 and score <= 1.0
        # With good documentation and low historical denial, score should be higher
        assert score > 0.5
    
    def test_calculate_risk_score_with_issues(self, engine):
        """Test risk score with multiple issues"""
        doc_analysis = {"adequate": False}
        historical = {"historical_denial_rate": 0.4}
        claim_data = {"diagnosis_codes": ["I10", "E11.9", "J44.1", "M79.1"]}
        
        score = engine._calculate_risk_score(
            doc_analysis=doc_analysis,
            historical=historical,
            claim_data=claim_data,
            issue_count=5
        )
        
        assert score >= 0.0 and score <= 1.0
        # With many issues, score should be lower
        assert score < 0.7
    
    def test_score_to_level_conversion(self, engine):
        """Test conversion of score to risk level"""
        assert engine._score_to_level(0.9) == RiskLevel.LOW
        assert engine._score_to_level(0.7) == RiskLevel.MEDIUM
        assert engine._score_to_level(0.5) == RiskLevel.HIGH
        assert engine._score_to_level(0.3) == RiskLevel.CRITICAL
    
    def test_infer_modifiers_from_notes(self, engine):
        """Test modifier inference from clinical notes"""
        notes_with_telehealth = "Patient seen via telehealth video visit"
        modifiers = engine._infer_modifiers(notes_with_telehealth)
        
        assert modifiers is not None
        assert "95" in modifiers  # Telehealth modifier
    
    def test_infer_modifiers_no_telehealth(self, engine):
        """Test modifier inference for regular visit"""
        notes_regular = "Office visit for follow-up"
        modifiers = engine._infer_modifiers(notes_regular)
        
        assert modifiers is None or len(modifiers) == 0
    
    def test_infer_place_of_service_office(self, engine):
        """Test place of service inference for office visit"""
        pos = engine._infer_place_of_service("99213")
        assert pos == "11"  # Office
    
    def test_infer_place_of_service_emergency(self, engine):
        """Test place of service inference for ED visit"""
        pos = engine._infer_place_of_service("99285")
        assert pos == "23"  # Emergency Room
    
    def test_infer_place_of_service_inpatient(self, engine):
        """Test place of service inference for inpatient"""
        pos = engine._infer_place_of_service("99233")
        assert pos == "21"  # Inpatient Hospital
    
    def test_infer_place_of_service_unknown(self, engine):
        """Test place of service for unknown code"""
        pos = engine._infer_place_of_service("UNKNOWN")
        assert pos is None
    
    @pytest.mark.asyncio
    async def test_batch_analyze(self, engine):
        """Test batch analysis of multiple claims"""
        claims = [
            {
                "claim_id": "CLM-001",
                "procedure_code": "99213",
                "diagnosis_codes": ["I10"],
                "patient": {"clinical_notes": "Office visit"}
            },
            {
                "claim_id": "CLM-002",
                "procedure_code": "99285",
                "diagnosis_codes": ["I21.3"],
                "patient": {"clinical_notes": "Emergency visit"}
            },
            {
                "claim_id": "CLM-003",
                "procedure_code": "36415",
                "diagnosis_codes": ["Z00.00"],
                "patient": {"clinical_notes": "Lab draw"}
            }
        ]
        
        reports = await engine.batch_analyze(claims)
        
        assert len(reports) == 3
        assert all(isinstance(r, PreSubmissionReport) for r in reports)
    
    def test_generate_billing_team_report(self, engine):
        """Test generation of summary report"""
        reports = [
            PreSubmissionReport(
                claim_id="CLM-001",
                overall_risk_score=0.8,
                risk_level=RiskLevel.LOW,
                issues=[],
                can_submit=True,
                requires_human_review=False,
                auto_fixes_applied=[],
                documentation_gaps=[],
                estimated_denial_probability=0.2,
                analysis_timestamp=datetime.utcnow()
            ),
            PreSubmissionReport(
                claim_id="CLM-002",
                overall_risk_score=0.4,
                risk_level=RiskLevel.HIGH,
                issues=[PreSubmissionIssue(
                    issue_type=IssueType.MISSING_DOCUMENTATION,
                    severity=RiskLevel.HIGH,
                    line_item=None,
                    description="Missing HPI",
                    suggested_fix="Add history",
                    auto_fixable=False,
                    confidence=0.8
                )],
                can_submit=False,
                requires_human_review=True,
                auto_fixes_applied=[],
                documentation_gaps=["HPI"],
                estimated_denial_probability=0.6,
                analysis_timestamp=datetime.utcnow()
            ),
            PreSubmissionReport(
                claim_id="CLM-003",
                overall_risk_score=0.2,
                risk_level=RiskLevel.CRITICAL,
                issues=[
                    PreSubmissionIssue(
                        issue_type=IssueType.CODE_DOCUMENTATION_MISMATCH,
                        severity=RiskLevel.CRITICAL,
                        line_item=None,
                        description="Code mismatch",
                        suggested_fix="Review coding",
                        auto_fixable=False,
                        confidence=0.9
                    )
                ],
                can_submit=False,
                requires_human_review=True,
                auto_fixes_applied=[],
                documentation_gaps=[],
                estimated_denial_probability=0.8,
                analysis_timestamp=datetime.utcnow()
            )
        ]
        
        summary = engine.generate_billing_team_report(reports)
        
        assert summary["total_claims_analyzed"] == 3
        assert summary["can_submit_immediately"] == 1
        assert summary["requires_review"] == 2
        assert summary["risk_distribution"]["low"] == 1
        assert summary["risk_distribution"]["high"] == 1
        assert summary["risk_distribution"]["critical"] == 1


class TestPreSubmissionEdgeCases:
    """Edge case testing"""
    
    @pytest.fixture
    def engine(self):
        return PreSubmissionEngine(db=None)
    
    @pytest.mark.asyncio
    async def test_unicode_characters(self, engine):
        """Test with unicode in all fields"""
        claim = {
            "claim_id": "CLM-日本語",
            "procedure_code": "99213",
            "diagnosis_codes": ["I10"],
            "payer_id": "aetna-東京"
        }
        patient = {
            "name": "José García Müller",
            "clinical_notes": "Patient presenta dolor. Examen normal."
        }
        
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=patient,
            clinical_notes="Patient visit"
        )
        
        assert isinstance(report, PreSubmissionReport)
    
    @pytest.mark.asyncio
    async def test_very_long_clinical_notes(self, engine):
        """Test with extremely long clinical notes"""
        claim = {"procedure_code": "99213", "diagnosis_codes": ["I10"]}
        patient = {}
        
        long_notes = "Chief Complaint: " + "Patient reports symptoms. " * 10000
        
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=patient,
            clinical_notes=long_notes
        )
        
        assert isinstance(report, PreSubmissionReport)
    
    @pytest.mark.asyncio
    async def test_special_characters_in_codes(self, engine):
        """Test with special characters in medical codes"""
        claim = {
            "procedure_code": "99213-TC",
            "diagnosis_codes": ["E11.9", "I10 (controlled)"],
            "payer_id": "aetna-special!"
        }
        
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data={},
            clinical_notes="Regular visit"
        )
        
        assert isinstance(report, PreSubmissionReport)
    
    @pytest.mark.asyncio
    async def test_concurrent_analysis(self, engine):
        """Test concurrent claim analysis"""
        tasks = []
        
        for i in range(20):
            claim = {
                "claim_id": f"CLM-{i}",
                "procedure_code": f"9921{i % 5}",
                "diagnosis_codes": ["I10"]
            }
            tasks.append(engine.analyze_claim_pre_submission(
                claim_data=claim,
                patient_data={},
                clinical_notes=f"Visit {i}"
            ))
        
        reports = await asyncio.gather(*tasks)
        
        assert len(reports) == 20
        assert all(isinstance(r, PreSubmissionReport) for r in reports)
    
    @pytest.mark.asyncio
    async def test_empty_claim_data(self, engine):
        """Test with completely empty claim data"""
        report = await engine.analyze_claim_pre_submission(
            claim_data={},
            patient_data={},
            clinical_notes=""
        )
        
        assert isinstance(report, PreSubmissionReport)
        assert report.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]


class TestPreSubmissionPerformance:
    """Performance testing"""
    
    @pytest.fixture
    def engine(self):
        return PreSubmissionEngine(db=None)
    
    @pytest.mark.asyncio
    async def test_analysis_completes_quickly(self, engine):
        """Test that analysis completes within reasonable time"""
        import time
        
        claim = {
            "claim_id": "CLM-TEST",
            "procedure_code": "99213",
            "diagnosis_codes": ["I10"]
        }
        patient = {"clinical_notes": "Office visit for hypertension follow-up"}
        
        start = time.time()
        report = await engine.analyze_claim_pre_submission(
            claim_data=claim,
            patient_data=patient,
            clinical_notes=patient["clinical_notes"]
        )
        elapsed = time.time() - start
        
        # Should complete in under 5 seconds (no external API calls)
        assert elapsed < 5.0
        assert isinstance(report, PreSubmissionReport)
