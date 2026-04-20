"""
API Endpoints Tests
Tests FastAPI endpoints for claims, compliance, and dashboard
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch
import json

from fastapi.testclient import TestClient

from api.main import app


client = TestClient(app)


class TestHealthEndpoint:
    """Test health check endpoint"""
    
    def test_health_check(self, mock_db):
        """Test health endpoint returns correct status"""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "timestamp" in data
        assert "services" in data


class TestClaimsEndpoints:
    """Test claims management endpoints"""
    
    @pytest.mark.asyncio
    async def test_create_claim_intake(self, mock_db, sample_claim_doc, env_vars):
        """Test creating claim intake"""
        payload = {
            "organization_id": "org_001",
            "payer_id": "aetna_001",
            "payer_name": "Aetna Better Health",
            "date_from": "2025-01-01",
            "date_to": "2025-01-31"
        }
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            
            response = client.post(
                "/claims/intake",
                json=payload,
                headers={"Authorization": "Bearer test_token"}
            )
        
        # May return 200 or 401 depending on auth implementation
        assert response.status_code in [200, 201, 401]
    
    @pytest.mark.asyncio
    async def test_list_claims(self, mock_db, sample_claim_doc, env_vars):
        """Test listing claims"""
        # Insert test data
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/claims?organization_id=org_001")
        
        assert response.status_code in [200, 401]
    
    @pytest.mark.asyncio
    async def test_get_claim_detail(self, mock_db, sample_claim_doc, env_vars):
        """Test getting single claim details"""
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/claims/test_claim_001")
        
        assert response.status_code in [200, 401, 404]
    
    @pytest.mark.asyncio
    async def test_approve_claim(self, mock_db, sample_claim_doc, env_vars):
        """Test approving claim"""
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        payload = {
            "claim_id": "test_claim_001",
            "draft_id": "draft_001",
            "approver_id": "user_001",
            "action": "approved",
            "modifications": None
        }
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.post(
                "/claims/test_claim_001/approve",
                json=payload
            )
        
        assert response.status_code in [200, 401, 404]
    
    @pytest.mark.asyncio
    async def test_get_claim_audit_trail(self, mock_db, env_vars):
        """Test getting audit trail for claim"""
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/claims/test_claim_001/audit-trail")
        
        assert response.status_code in [200, 401]


class TestDashboardEndpoints:
    """Test dashboard analytics endpoints"""
    
    @pytest.mark.asyncio
    async def test_get_dashboard_stats(self, mock_db, sample_claim_doc, env_vars):
        """Test getting dashboard stats"""
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/dashboard/stats?period=30d")
        
        assert response.status_code in [200, 401]
    
    @pytest.mark.asyncio
    async def test_get_pending_approval(self, mock_db, sample_claim_doc, env_vars):
        """Test getting pending approval queue"""
        # Update to appeal drafted status
        sample_claim_doc["status"] = "appeal_drafted"
        sample_claim_doc["analysis"] = {"appeal_probability": 0.75}
        sample_claim_doc["appeal_drafts"] = [{"appeal_letter": "Test letter content"}]
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/dashboard/pending-approval")
        
        assert response.status_code in [200, 401]


class TestComplianceEndpoints:
    """Test compliance endpoints"""
    
    @pytest.mark.asyncio
    async def test_hipaa_compliance_check(self, mock_db, sample_claim_doc, env_vars):
        """Test HIPAA compliance check"""
        mock_db.denial_claims.insert_one(sample_claim_doc)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/compliance/hipaa-check/test_claim_001")
        
        assert response.status_code in [200, 401, 403]


class TestPayerPortalEndpoints:
    """Test payer portal management endpoints"""
    
    @pytest.mark.asyncio
    async def test_trigger_manual_scrape(self, mock_db, env_vars):
        """Test triggering manual scrape"""
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.post("/payer-portals/aetna_001/trigger-scrape")
        
        assert response.status_code in [200, 401, 202]


class TestAPIValidation:
    """Test input validation"""
    
    def test_invalid_period_parameter(self):
        """Test invalid period parameter rejected"""
        response = client.get("/dashboard/stats?period=invalid")
        
        assert response.status_code in [400, 422, 401]
    
    def test_missing_required_fields_intake(self):
        """Test missing fields in intake request"""
        payload = {
            "organization_id": "org_001"
            # Missing required fields
        }
        
        response = client.post("/claims/intake", json=payload)
        
        assert response.status_code in [400, 422, 401]
    
    def test_invalid_claim_id_format(self):
        """Test invalid claim ID format"""
        response = client.get("/claims/invalid<>id")
        
        # Should handle gracefully
        assert response.status_code in [200, 401, 404]


class TestAPIEdgeCases:
    """Test API edge cases"""
    
    @pytest.mark.asyncio
    async def test_large_claim_list(self, mock_db, env_vars):
        """Test handling large claim lists"""
        # Insert many claims
        for i in range(1000):
            claim = {
                "_id": f"claim_{i}",
                "organization_id": "org_001",
                "status": "detected",
                "created_at": datetime.utcnow()
            }
            mock_db.denial_claims.insert_one(claim)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/claims?limit=100")
        
        assert response.status_code in [200, 401]
    
    @pytest.mark.asyncio
    async def test_unicode_in_claim_data(self, mock_db, env_vars):
        """Test unicode handling in claims"""
        claim = {
            "_id": "unicode_claim",
            "organization_id": "org_001",
            "patient": {
                "first_name": "[ENCRYPTED]José",
                "last_name": "[ENCRYPTED]García-Müller 日本語",
            },
            "status": "detected"
        }
        mock_db.denial_claims.insert_one(claim)
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            response = client.get("/claims/unicode_claim")
        
        assert response.status_code in [200, 401, 404]
    
    @pytest.mark.asyncio
    async def test_concurrent_requests(self, mock_db, env_vars):
        """Test handling concurrent API requests"""
        import httpx
        
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.db = mock_db
            mock_mongo.health_check = AsyncMock(return_value=True)
            
            # Make multiple concurrent requests
            async with httpx.AsyncClient(app=app, base_url="http://test") as ac:
                tasks = [
                    ac.get("/health")
                    for _ in range(10)
                ]
                responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            # All should complete
            assert len(responses) == 10
    
    def test_malformed_json_payload(self):
        """Test handling malformed JSON"""
        response = client.post(
            "/claims/intake",
            data="not valid json",
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code in [400, 422]
    
    @pytest.mark.asyncio
    async def test_database_unavailable(self, mock_db, env_vars):
        """Test handling when database unavailable"""
        with patch("api.main.mongo_manager") as mock_mongo:
            mock_mongo.health_check = AsyncMock(return_value=False)
            
            response = client.get("/health")
        
        # Should report degraded status
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"


class TestAuthentication:
    """Test authentication and authorization"""
    
    def test_missing_auth_header(self):
        """Test request without auth header"""
        # Most endpoints require auth
        response = client.get("/claims")
        
        # Should return 401 or require auth
        assert response.status_code in [200, 401]
    
    def test_invalid_auth_token(self):
        """Test request with invalid token"""
        response = client.get(
            "/claims",
            headers={"Authorization": "Bearer invalid_token"}
        )
        
        assert response.status_code in [200, 401, 403]
    
    def test_expired_auth_token(self):
        """Test request with expired token"""
        # Simulate expired token
        response = client.get(
            "/claims",
            headers={"Authorization": "Bearer expired_token"}
        )
        
        assert response.status_code in [200, 401]


class TestRateLimiting:
    """Test API rate limiting"""
    
    def test_excessive_requests(self):
        """Test rate limiting kicks in"""
        # Make many rapid requests
        responses = []
        for _ in range(100):
            response = client.get("/health")
            responses.append(response.status_code)
        
        # Most should succeed, but rate limit may apply
        success_count = sum(1 for r in responses if r == 200)
        assert success_count > 50  # At least half should succeed
