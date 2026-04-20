"""
Pytest configuration and fixtures
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from typing import Generator
from unittest.mock import Mock, AsyncMock, patch
import mongomock

# Set event loop policy for Windows
@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_db():
    """Mock MongoDB database"""
    return mongomock.MongoClient().db


@pytest.fixture
def sample_patient_data():
    """Sample patient data for tests"""
    return {
        "patient_id": "P-001",
        "mrn": "[ENCRYPTED]MRN123456",
        "first_name": "[ENCRYPTED]John",
        "last_name": "[ENCRYPTED]Doe",
        "date_of_birth": "[ENCRYPTED]1985-03-15",
        "insurance_member_id": "[ENCRYPTED]AET123456789",
        "payer_id": "aetna_001",
        "payer_name": "Aetna Better Health"
    }


@pytest.fixture
def sample_procedure_data():
    """Sample procedure data"""
    return {
        "procedure_code": "99213",
        "procedure_description": "Office visit, established patient",
        "diagnosis_codes": ["J44.1", "E11.9"],
        "service_date": datetime.utcnow(),
        "provider_npi": "1234567890",
        "facility_name": "City Medical Center",
        "billed_amount": 250.00,
        "allowed_amount": 200.00,
        "paid_amount": 0.00
    }


@pytest.fixture
def sample_denial_data():
    """Sample denial data"""
    return {
        "denial_code": "CO-50",
        "denial_description": "Non-covered service - medical necessity not met",
        "denial_type": "medical_necessity",
        "denial_date": datetime.utcnow(),
        "claim_number": "CLM-2025-001234",
        "internal_claim_id": "INT-789",
        "raw_portal_text": "Service denied: Not medically necessary per policy",
        "denial_reason_extracted": "Medical necessity criteria not documented"
    }


@pytest.fixture
def sample_claim_doc(sample_patient_data, sample_procedure_data, sample_denial_data):
    """Complete sample claim document"""
    return {
        "_id": "test_claim_001",
        "organization_id": "org_001",
        "patient": sample_patient_data,
        "procedure": sample_procedure_data,
        "denial": sample_denial_data,
        "status": "detected",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "baa_agreement_id": "baa_2025_001",
        "encrypted_at_rest": True
    }


@pytest.fixture
def mock_epic_patient():
    """Mock Epic patient data"""
    return {
        "resourceType": "Patient",
        "id": "epic-patient-001",
        "identifier": [
            {"system": "MR", "value": "MRN123456"}
        ],
        "name": [{
            "family": "Doe",
            "given": ["John"]
        }],
        "birthDate": "1985-03-15",
        "gender": "male",
        "telecom": [
            {"system": "phone", "value": "555-123-4567"}
        ]
    }


@pytest.fixture
def mock_tinyfish_workflow_result():
    """Mock TinyFish workflow result"""
    return {
        "steps": [
            {"type": "step", "payload": {"action": "navigate", "url": "https://provider.aetna.com"}},
            {"type": "step", "payload": {"action": "fill", "field": "username", "value": "***"}},
            {"type": "step", "payload": {"action": "click", "element": "login_button"}},
        ],
        "final_answer": """```json
[{
    "claim_number": "CLM-2025-001234",
    "patient_name": "John Doe",
    "member_id": "AET123456789",
    "service_date": "2025-01-15",
    "procedure_code": "99213",
    "billed_amount": "250.00",
    "denial_code": "CO-50",
    "denial_reason": "Non-covered service - medical necessity not met",
    "denial_date": "2025-01-20"
}]
```""",
        "screenshots": ["https://cdn.tinyfish.ai/screenshot_001.png"],
        "completed": True,
        "error": None
    }


@pytest.fixture
def mock_fireworks_analysis_response():
    """Mock Fireworks LLM response"""
    return {
        "root_cause": "Insufficient documentation of medical necessity for COPD exacerbation",
        "appeal_probability": 0.75,
        "expected_recovery": 250.00,
        "recommended_action": "appeal",
        "appeal_strategy": "Submit detailed clinical notes documenting acute exacerbation and failed outpatient management",
        "medical_necessity_gap": "Missing documentation of severity and failed conservative treatment",
        "supporting_evidence": [
            "Clinical progress notes",
            "Spirometry results",
            "Medication history"
        ]
    }


@pytest.fixture
def mock_mixedbread_rag_response():
    """Mock Mixedbread RAG response"""
    return {
        "documents": [
            {
                "title": "Aetna Medical Policy - Office Visits",
                "content": "Evaluation and management services are covered when medically necessary...",
                "score": 0.92
            },
            {
                "title": "Clinical Guidelines - COPD Management",
                "content": "Office visits for acute exacerbation are considered medically necessary...",
                "score": 0.88
            }
        ]
    }


@pytest.fixture
def mock_axiom_response():
    """Mock Axiom API response"""
    return {"status": "ok", "ingested": 1}


@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset singleton instances between tests"""
    # Reset any singleton state
    yield


@pytest.fixture
def env_vars(monkeypatch):
    """Set test environment variables"""
    monkeypatch.setenv("TINYFISH_API_KEY", "test_tinyfish_key")
    monkeypatch.setenv("FIREWORKS_API_KEY", "test_fireworks_key")
    monkeypatch.setenv("MIXEDBREAD_API_KEY", "test_mixedbread_key")
    monkeypatch.setenv("AXIOM_API_KEY", "test_axiom_key")
    monkeypatch.setenv("AGENTOPS_API_KEY", "test_agentops_key")
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("HIPAA_ENCRYPTION_KEY", "test_encryption_key_32_chars!")
    monkeypatch.setenv("TINYFISH_MODE", "mock")
    monkeypatch.setenv("ENVIRONMENT", "test")
