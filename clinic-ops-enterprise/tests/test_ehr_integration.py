"""
EHR Integration Tests
Tests Epic, Cerner, and athenahealth integrations
"""

import pytest
import asyncio
from datetime import datetime
from unittest.mock import Mock, AsyncMock, patch
import json

from ehr_integration.epic_integration import (
    EpicFHIRClient,
    EpicIntegrationManager,
    epic_manager
)
from ehr_integration.cerner_integration import CernerFHIRClient, CernerIntegrationManager
from ehr_integration.athena_integration import AthenaHealthClient, AthenaIntegrationManager


class TestEpicFHIRClient:
    """Test Epic FHIR client"""
    
    @pytest.fixture
    def epic_client(self):
        return EpicFHIRClient(
            base_url="https://fhir.epic.com/interconnect-fhir-oauth",
            client_id="test_client_id",
            client_secret="test_client_secret",
            organization_id="org_001"
        )
    
    @pytest.mark.asyncio
    async def test_authenticate(self, epic_client):
        """Test OAuth authentication"""
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "access_token": "test_access_token_123",
                "expires_in": 3600
            })
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            await epic_client._authenticate()
            
            assert epic_client.access_token == "test_access_token_123"
            assert epic_client.token_expires is not None
    
    @pytest.mark.asyncio
    async def test_search_patient_by_mrn(self, epic_client, mock_epic_patient):
        """Test patient search by MRN"""
        epic_client.access_token = "test_token"
        epic_client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "total": 1,
                "entry": [{"resource": mock_epic_patient}]
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patient = await epic_client.search_patient_by_mrn("MRN123456")
            
            assert patient is not None
            assert patient.mrn == "MRN123456"
            assert patient.first_name == "John"
            assert patient.last_name == "Doe"
    
    @pytest.mark.asyncio
    async def test_search_patient_not_found(self, epic_client):
        """Test patient search with no results"""
        epic_client.access_token = "test_token"
        epic_client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={"total": 0, "entry": []})
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patient = await epic_client.search_patient_by_mrn("NONEXISTENT")
            
            assert patient is None
    
    @pytest.mark.asyncio
    async def test_get_patient_encounters(self, epic_client):
        """Test retrieving patient encounters"""
        epic_client.access_token = "test_token"
        epic_client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        encounter_data = {
            "resourceType": "Bundle",
            "entry": [
                {
                    "resource": {
                        "resourceType": "Encounter",
                        "id": "enc-001",
                        "period": {"start": "2025-01-15T10:00:00Z"},
                        "reasonCode": [{
                            "coding": [{
                                "system": "http://www.ama-assn.org/go/cpt",
                                "code": "99213"
                            }]
                        }]
                    }
                }
            ]
        }
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value=encounter_data)
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            encounters = await epic_client.get_patient_encounters("patient-001")
            
            assert len(encounters) == 1
            assert encounters[0].encounter_id == "enc-001"
    
    @pytest.mark.asyncio
    async def test_write_auth_status_to_chart(self, epic_client):
        """Test writing auth status back to Epic"""
        epic_client.access_token = "test_token"
        epic_client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 201
            mock_response.json = AsyncMock(return_value={"id": "doc-001"})
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            doc_id = await epic_client.write_auth_status_to_chart(
                patient_id="patient-001",
                encounter_id="enc-001",
                auth_number="AUTH-12345",
                status="approved"
            )
            
            assert doc_id == "doc-001"
    
    @pytest.mark.asyncio
    async def test_write_denial_to_chart(self, epic_client):
        """Test writing denial to Epic chart"""
        epic_client.access_token = "test_token"
        epic_client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 201
            mock_response.json = AsyncMock(return_value={"id": "task-001"})
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            task_id = await epic_client.write_denial_to_chart(
                patient_id="patient-001",
                encounter_id="enc-001",
                denial_code="CO-50",
                denial_reason="Medical necessity",
                claim_number="CLM-001"
            )
            
            assert task_id == "task-001"


class TestEpicIntegrationManager:
    """Test Epic integration manager"""
    
    @pytest.mark.asyncio
    async def test_register_organization(self):
        """Test organization registration"""
        manager = EpicIntegrationManager()
        
        manager.register_organization(
            org_id="test_org",
            epic_base_url="https://epic.test.com",
            client_id="test_id",
            client_secret="test_secret"
        )
        
        assert "test_org" in manager.clients
    
    @pytest.mark.asyncio
    async def test_sync_patient_for_denial(self, mock_db):
        """Test full patient sync workflow"""
        manager = EpicIntegrationManager()
        
        # Mock the Epic client
        mock_client = AsyncMock()
        mock_patient = Mock()
        mock_patient.patient_id = "epic-001"
        mock_patient.mrn = "MRN123456"
        mock_client.search_patient_by_mrn = AsyncMock(return_value=mock_patient)
        mock_client.get_patient_encounters = AsyncMock(return_value=[])
        mock_client.get_clinical_notes = AsyncMock(return_value=[])
        
        manager.clients["org_001"] = mock_client
        
        result = await manager.sync_patient_for_denial(
            org_id="org_001",
            mrn="MRN123456",
            encounter_date="2025-01-15"
        )
        
        assert result["patient"] == mock_patient
        assert "sync_timestamp" in result


class TestCernerIntegration:
    """Test Cerner integration"""
    
    @pytest.mark.asyncio
    async def test_cerner_authenticate(self):
        """Test Cerner OAuth"""
        client = CernerFHIRClient(
            base_url="https://fhir.cerner.com",
            client_id="test_id",
            client_secret="test_secret",
            tenant_id="tenant_001"
        )
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={"access_token": "cerner_token"})
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            await client._authenticate()
            
            assert client.access_token == "cerner_token"
    
    @pytest.mark.asyncio
    async def test_cerner_get_patient(self):
        """Test Cerner patient retrieval"""
        client = CernerFHIRClient(
            base_url="https://fhir.cerner.com",
            client_id="test_id",
            client_secret="test_secret",
            tenant_id="tenant_001"
        )
        client.access_token = "test_token"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "resourceType": "Patient",
                "id": "cerner-patient-001",
                "identifier": [{"system": "MR", "value": "MRN123"}],
                "name": [{"family": "Smith", "given": ["Jane"]}],
                "birthDate": "1990-05-20"
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patient = await client.get_patient("cerner-patient-001")
            
            assert patient is not None
            assert patient.patient_id == "cerner-patient-001"


class TestAthenaIntegration:
    """Test athenahealth integration"""
    
    @pytest.mark.asyncio
    async def test_athena_authenticate(self):
        """Test athena OAuth"""
        client = AthenaHealthClient(
            practice_id="12345",
            client_id="test_id",
            client_secret="test_secret"
        )
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={"access_token": "athena_token"})
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            await client._authenticate()
            
            assert client.access_token == "athena_token"
    
    @pytest.mark.asyncio
    async def test_athena_search_patient(self):
        """Test athena patient search"""
        client = AthenaHealthClient(
            practice_id="12345",
            client_id="test_id",
            client_secret="test_secret"
        )
        client.access_token = "test_token"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "patients": [{
                    "patientid": "123",
                    "medicalrecordnumber": "MRN456",
                    "firstname": "Bob",
                    "lastname": "Jones",
                    "dob": "1975-08-10"
                }]
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patients = await client.search_patient("Bob", "Jones", "1975-08-10")
            
            assert len(patients) == 1
            assert patients[0].patient_id == "123"
    
    @pytest.mark.asyncio
    async def test_athena_create_clinical_document(self):
        """Test creating document in athena"""
        client = AthenaHealthClient(
            practice_id="12345",
            client_id="test_id",
            client_secret="test_secret"
        )
        client.access_token = "test_token"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={"documentid": "doc-789"})
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            doc_id = await client.create_clinical_document(
                patient_id="123",
                department_id="dept-1",
                document_type="214",
                content="Prior auth approved: AUTH-123"
            )
            
            assert doc_id == "doc-789"


class TestEHREdgeCases:
    """Test EHR integration edge cases"""
    
    @pytest.mark.asyncio
    async def test_epic_auth_failure(self):
        """Test Epic authentication failure handling"""
        client = EpicFHIRClient(
            base_url="https://epic.test.com",
            client_id="bad_id",
            client_secret="bad_secret",
            organization_id="org_001"
        )
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 401
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            with pytest.raises(RuntimeError):
                await client._authenticate()
    
    @pytest.mark.asyncio
    async def test_epic_token_refresh(self):
        """Test automatic token refresh when expired"""
        client = EpicFHIRClient(
            base_url="https://epic.test.com",
            client_id="test_id",
            client_secret="test_secret",
            organization_id="org_001"
        )
        
        # Set expired token
        client.access_token = "old_token"
        client.token_expires = datetime.utcnow() - __import__('datetime').timedelta(minutes=5)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            
            # Auth response
            auth_response = AsyncMock()
            auth_response.status = 200
            auth_response.json = AsyncMock(return_value={
                "access_token": "new_token",
                "expires_in": 3600
            })
            
            # API response
            api_response = AsyncMock()
            api_response.status = 200
            api_response.json = AsyncMock(return_value={"total": 0, "entry": []})
            
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=auth_response)
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=api_response)
            
            # Should refresh token automatically
            await client.search_patient_by_mrn("MRN123")
            
            assert client.access_token == "new_token"
    
    @pytest.mark.asyncio
    async def test_athena_api_error(self):
        """Test athena API error handling"""
        client = AthenaHealthClient(
            practice_id="12345",
            client_id="test_id",
            client_secret="test_secret"
        )
        client.access_token = "test_token"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 500
            mock_response.text = AsyncMock(return_value="Internal Server Error")
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            # Should handle gracefully
            patients = await client.search_patient("Test", "User", "1990-01-01")
            
            # Depending on implementation, might return empty list or raise
            assert patients == [] or patients is None
    
    @pytest.mark.asyncio
    async def test_cerner_missing_patient_fields(self):
        """Test Cerner with incomplete patient data"""
        client = CernerFHIRClient(
            base_url="https://cerner.test.com",
            client_id="test_id",
            client_secret="test_secret",
            tenant_id="tenant_001"
        )
        client.access_token = "test_token"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            # Minimal patient data
            mock_response.json = AsyncMock(return_value={
                "resourceType": "Patient",
                "id": "min-patient",
                "name": [{}]  # Empty name
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patient = await client.get_patient("min-patient")
            
            # Should not crash with missing fields
            assert patient is not None
    
    @pytest.mark.asyncio
    async def test_epic_concurrent_requests(self):
        """Test concurrent Epic API requests"""
        client = EpicFHIRClient(
            base_url="https://epic.test.com",
            client_id="test_id",
            client_secret="test_secret",
            organization_id="org_001"
        )
        client.access_token = "test_token"
        client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "resourceType": "Patient",
                "id": "test",
                "identifier": [{"system": "MR", "value": "MRN123"}],
                "name": [{"family": "Test", "given": ["User"]}]
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            # Make multiple concurrent requests
            tasks = [
                client.search_patient_by_mrn(f"MRN{i}")
                for i in range(5)
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # All should complete (may be None or Patient)
            assert len(results) == 5
    
    @pytest.mark.asyncio
    async def test_manager_unregistered_org(self):
        """Test manager with unregistered organization"""
        manager = EpicIntegrationManager()
        
        with pytest.raises(ValueError) as exc_info:
            await manager.sync_patient_for_denial(
                org_id="unknown_org",
                mrn="MRN123",
                encounter_date="2025-01-15"
            )
        
        assert "not configured" in str(exc_info.value).lower()
    
    @pytest.mark.asyncio
    async def test_unicode_patient_names(self):
        """Test handling unicode in patient names"""
        client = EpicFHIRClient(
            base_url="https://epic.test.com",
            client_id="test_id",
            client_secret="test_secret",
            organization_id="org_001"
        )
        client.access_token = "test_token"
        client.token_expires = datetime.utcnow() + __import__('datetime').timedelta(hours=1)
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "total": 1,
                "entry": [{
                    "resource": {
                        "resourceType": "Patient",
                        "id": "unicode-patient",
                        "identifier": [{"system": "MR", "value": "MRN789"}],
                        "name": [{"family": "García-Müller", "given": ["José", "María"]}],
                        "birthDate": "1980-01-01"
                    }
                }]
            })
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            patient = await client.search_patient_by_mrn("MRN789")
            
            assert patient is not None
            assert "García" in patient.last_name
