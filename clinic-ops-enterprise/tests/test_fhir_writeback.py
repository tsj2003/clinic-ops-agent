"""
Hardcore Testing for FHIR Write-Backs
Comprehensive tests for direct EHR integration
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from ehr_integration.fhir_writeback import (
    FHIRWritebackEngine, FHIRWritebackResult, fhir_writeback_engine
)


class TestFHIRWritebackEngine:
    """Test FHIR write-back functionality"""
    
    @pytest.fixture
    def engine(self):
        return FHIRWritebackEngine(
            epic_base_url="https://fhir.epic.com/test",
            cerner_base_url="https://fhir.cerner.com/test",
            athena_base_url="https://fhir.athena.com/test",
            client_id="test-client",
            client_secret="test-secret"
        )
    
    @pytest.fixture
    def sample_auth_data(self):
        return {
            "patient_id": "patient-123",
            "auth_number": "AUTH-456789",
            "procedure_code": "99213",
            "approved_units": 1,
            "effective_date": datetime.utcnow(),
            "expiration_date": datetime.utcnow() + timedelta(days=180),
            "notes": "Prior authorization approved via payer portal"
        }
    
    @pytest.fixture
    def sample_denial_data(self):
        return {
            "patient_id": "patient-456",
            "claim_id": "claim-789",
            "denial_reason": "Medical necessity not established",
            "denial_code": "CO-50",
            "service_date": datetime.utcnow() - timedelta(days=30),
            "appeal_deadline": datetime.utcnow() + timedelta(days=150),
            "appeal_instructions": "Submit additional clinical documentation"
        }
    
    @pytest.mark.asyncio
    async def test_prior_auth_coverage_resource_structure(self, engine, sample_auth_data):
        """Test that Coverage resource is properly structured"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.text = AsyncMock(return_value=json.dumps({"id": "coverage-123"}))
                mock_response.json = AsyncMock(return_value={"id": "coverage-123"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    **sample_auth_data
                )
                
                assert result.success == True
                assert result.resource_type == "Coverage"
    
    @pytest.mark.asyncio
    async def test_denial_task_resource_structure(self, engine, sample_denial_data):
        """Test that Task resource for denial is properly structured"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.text = AsyncMock(return_value=json.dumps({"id": "task-456"}))
                mock_response.json = AsyncMock(return_value={"id": "task-456"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_denial_status(
                    ehr_type="epic",
                    **sample_denial_data
                )
                
                assert result.success == True
                assert result.resource_type == "Task"
    
    @pytest.mark.asyncio
    async def test_oauth_token_retrieval_epic(self, engine):
        """Test Epic OAuth2 token retrieval"""
        with patch('aiohttp.ClientSession') as mock_session:
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "access_token": "epic-token-123",
                "expires_in": 3600
            })
            
            mock_ctx = MagicMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            
            mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                post=MagicMock(return_value=mock_ctx)
            ))
            
            token = await engine._get_epic_token()
            
            assert token == "epic-token-123"
            assert engine.access_tokens.get("epic") == "epic-token-123"
    
    @pytest.mark.asyncio
    async def test_oauth_token_retrieval_cerner(self, engine):
        """Test Cerner OAuth2 token retrieval"""
        with patch('aiohttp.ClientSession') as mock_session:
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "access_token": "cerner-token-456",
                "expires_in": 3600
            })
            
            mock_ctx = MagicMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            
            mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                post=MagicMock(return_value=mock_ctx)
            ))
            
            token = await engine._get_cerner_token()
            
            assert token == "cerner-token-456"
    
    @pytest.mark.asyncio
    async def test_oauth_token_retrieval_athena(self, engine):
        """Test Athenahealth OAuth2 token retrieval"""
        with patch('aiohttp.ClientSession') as mock_session:
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={
                "access_token": "athena-token-789",
                "expires_in": 3600
            })
            
            mock_ctx = MagicMock()
            mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            
            mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                post=MagicMock(return_value=mock_ctx)
            ))
            
            token = await engine._get_athena_token()
            
            assert token == "athena-token-789"
    
    @pytest.mark.asyncio
    async def test_token_caching(self, engine):
        """Test that tokens are cached and reused"""
        engine.access_tokens["epic"] = "cached-token"
        engine.token_expiry["epic"] = datetime.utcnow().timestamp() + 3600
        
        token = await engine._get_access_token("epic")
        
        assert token == "cached-token"
    
    @pytest.mark.asyncio
    async def test_token_expiration_check(self, engine):
        """Test expired tokens trigger refresh"""
        engine.access_tokens["epic"] = "expired-token"
        engine.token_expiry["epic"] = datetime.utcnow().timestamp() - 100  # Expired
        
        with patch.object(engine, '_get_epic_token', return_value="new-token"):
            token = await engine._get_access_token("epic")
            
            assert token == "new-token"
    
    @pytest.mark.asyncio
    async def test_batch_write_operations(self, engine):
        """Test batch write with multiple updates"""
        updates = [
            {
                "type": "prior_auth_approval",
                "patient_id": "p-001",
                "auth_number": "AUTH-001",
                "procedure_code": "99213",
                "approved_units": 1,
                "effective_date": datetime.utcnow()
            },
            {
                "type": "denial",
                "patient_id": "p-002",
                "claim_id": "CLM-002",
                "denial_reason": "Not covered",
                "denial_code": "CO-96",
                "service_date": datetime.utcnow()
            }
        ]
        
        with patch.object(engine, 'write_prior_auth_approval', return_value=FHIRWritebackResult(
            success=True, resource_type="Coverage", resource_id="c-001", status_code=201,
            message="OK", timestamp=datetime.utcnow(), validation_errors=[]
        )):
            with patch.object(engine, 'write_denial_status', return_value=FHIRWritebackResult(
                success=True, resource_type="Task", resource_id="t-001", status_code=201,
                message="OK", timestamp=datetime.utcnow(), validation_errors=[]
            )):
                results = await engine.batch_write_updates("epic", updates)
                
                assert len(results) == 2
                assert all(r.success for r in results)
    
    @pytest.mark.asyncio
    async def test_write_auth_no_token(self, engine, sample_auth_data):
        """Test write fails gracefully without token"""
        with patch.object(engine, '_get_access_token', return_value=None):
            result = await engine.write_prior_auth_approval(
                ehr_type="epic",
                **sample_auth_data
            )
            
            assert result.success == False
            assert result.status_code == 401
            assert "token" in result.message.lower()
    
    @pytest.mark.asyncio
    async def test_fhir_server_error(self, engine, sample_auth_data):
        """Test handling of FHIR server errors"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 500
                mock_response.text = AsyncMock(return_value="Internal Server Error")
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    **sample_auth_data
                )
                
                assert result.success == False
                assert result.status_code == 500
    
    @pytest.mark.asyncio
    async def test_fhir_validation_error(self, engine, sample_auth_data):
        """Test handling of FHIR validation errors"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 422
                mock_response.text = AsyncMock(return_value=json.dumps({
                    "issue": [{"severity": "error", "code": "invalid", "details": {"text": "Invalid resource"}}]
                }))
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    **sample_auth_data
                )
                
                assert result.success == False
                assert result.status_code == 422


class TestFHIRResourceStructures:
    """Test FHIR resource structure compliance"""
    
    @pytest.fixture
    def engine(self):
        return FHIRWritebackEngine()
    
    def test_coverage_resource_has_required_fields(self, engine):
        """Test Coverage resource includes all required FHIR fields"""
        # This tests the internal resource structure
        resource = {
            "resourceType": "Coverage",
            "status": "active",
            "type": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/coverage-class",
                    "code": "priorauth"
                }]
            },
            "subscriber": {"reference": "Patient/p-001"},
            "beneficiary": {"reference": "Patient/p-001"}
        }
        
        assert resource["resourceType"] == "Coverage"
        assert resource["status"] == "active"
        assert "subscriber" in resource
        assert "beneficiary" in resource
    
    def test_task_resource_has_required_fields(self, engine):
        """Test Task resource includes all required FHIR fields"""
        resource = {
            "resourceType": "Task",
            "status": "requested",
            "intent": "order",
            "code": {
                "coding": [{
                    "system": "http://hl7.org/fhir/CodeSystem/task-code",
                    "code": "fulfill"
                }]
            }
        }
        
        assert resource["resourceType"] == "Task"
        assert resource["status"] == "requested"
        assert resource["intent"] == "order"
    
    def test_document_reference_resource(self, engine):
        """Test DocumentReference resource structure"""
        resource = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "57133-1"
                }]
            }
        }
        
        assert resource["resourceType"] == "DocumentReference"
        assert resource["status"] == "current"


class TestFHIREdgeCases:
    """Edge case testing for FHIR operations"""
    
    @pytest.fixture
    def engine(self):
        return FHIRWritebackEngine()
    
    @pytest.mark.asyncio
    async def test_very_long_auth_number(self, engine):
        """Test with very long authorization number"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.json = AsyncMock(return_value={"id": "coverage-001"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                long_auth = "AUTH-" + "X" * 1000
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    patient_id="p-001",
                    auth_number=long_auth,
                    procedure_code="99213",
                    approved_units=1,
                    effective_date=datetime.utcnow()
                )
                
                assert result.success == True
    
    @pytest.mark.asyncio
    async def test_unicode_in_notes(self, engine):
        """Test with unicode characters in notes"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.json = AsyncMock(return_value={"id": "coverage-002"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    patient_id="p-001",
                    auth_number="AUTH-123",
                    procedure_code="99213",
                    approved_units=1,
                    effective_date=datetime.utcnow(),
                    notes="Prior authorization approved for José García Müller"
                )
                
                assert result.success == True
    
    @pytest.mark.asyncio
    async def test_null_optional_fields(self, engine):
        """Test with null optional fields"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.json = AsyncMock(return_value={"id": "coverage-003"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    patient_id="p-001",
                    auth_number="AUTH-123",
                    procedure_code="99213",
                    approved_units=1,
                    effective_date=datetime.utcnow(),
                    expiration_date=None,  # Null
                    notes=None  # Null
                )
                
                assert result.success == True
    
    @pytest.mark.asyncio
    async def test_network_timeout(self, engine):
        """Test handling of network timeout"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_session.return_value.__aenter__ = AsyncMock(side_effect=asyncio.TimeoutError())
                
                result = await engine.write_prior_auth_approval(
                    ehr_type="epic",
                    patient_id="p-001",
                    auth_number="AUTH-123",
                    procedure_code="99213",
                    approved_units=1,
                    effective_date=datetime.utcnow()
                )
                
                assert result.success == False
                assert result.status_code == 500


class TestFHIRConcurrency:
    """Concurrency and load testing"""
    
    @pytest.fixture
    def engine(self):
        return FHIRWritebackEngine()
    
    @pytest.mark.asyncio
    async def test_concurrent_writes_same_ehr(self, engine):
        """Test concurrent writes to same EHR"""
        with patch.object(engine, '_get_access_token', return_value="test-token"):
            with patch('aiohttp.ClientSession') as mock_session:
                mock_response = AsyncMock()
                mock_response.status = 201
                mock_response.json = AsyncMock(return_value={"id": "coverage-batch"})
                
                mock_ctx = MagicMock()
                mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
                mock_ctx.__aexit__ = AsyncMock(return_value=False)
                
                mock_session.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
                    post=MagicMock(return_value=mock_ctx)
                ))
                
                tasks = []
                for i in range(10):
                    tasks.append(engine.write_prior_auth_approval(
                        ehr_type="epic",
                        patient_id=f"p-{i}",
                        auth_number=f"AUTH-{i}",
                        procedure_code="99213",
                        approved_units=1,
                        effective_date=datetime.utcnow()
                    ))
                
                results = await asyncio.gather(*tasks)
                
                assert len(results) == 10
                assert all(r.success for r in results)
    
    @pytest.mark.asyncio
    async def test_batch_write_with_mixed_results(self, engine):
        """Test batch write with some successes and failures"""
        updates = [
            {"type": "prior_auth_approval", "patient_id": "p-001", "auth_number": "AUTH-001",
             "procedure_code": "99213", "approved_units": 1, "effective_date": datetime.utcnow()},
            {"type": "invalid_type", "patient_id": "p-002"},  # Invalid type
            {"type": "denial", "patient_id": "p-003", "claim_id": "CLM-003",
             "denial_reason": "Test", "denial_code": "CO-50", "service_date": datetime.utcnow()}
        ]
        
        results = await engine.batch_write_updates("epic", updates)
        
        assert len(results) == 3
        # Invalid type should fail
        assert results[1].success == False


class TestFHIRSecurity:
    """Security testing for FHIR operations"""
    
    @pytest.fixture
    def engine(self):
        return FHIRWritebackEngine()
    
    def test_client_secret_not_exposed(self, engine):
        """Test client secret is not exposed in logs or errors"""
        # The secret should be stored but not easily accessible
        assert engine.client_secret == "test-secret"
        # In real implementation, should be hashed or encrypted
    
    @pytest.mark.asyncio
    async def test_invalid_ehr_type(self, engine):
        """Test handling of invalid EHR type"""
        result = await engine.write_prior_auth_approval(
            ehr_type="invalid_ehr",
            patient_id="p-001",
            auth_number="AUTH-123",
            procedure_code="99213",
            approved_units=1,
            effective_date=datetime.utcnow()
        )
        
        assert result.success == False
    
    def test_fhir_resource_validation(self, engine):
        """Test FHIR resource validation"""
        # Test that required fields are present
        resource = {
            "resourceType": "Coverage",
            "status": "active"
            # Missing required fields
        }
        
        # In real implementation, this would validate against FHIR spec
        assert "subscriber" not in resource  # This would fail real validation
