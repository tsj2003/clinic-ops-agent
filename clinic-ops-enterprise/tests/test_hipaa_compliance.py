"""
HIPAA Compliance Engine Tests
Tests tamper-evident logging, PHI encryption, and BAA management
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch
import hashlib
import json

from compliance.hipaa_engine import (
    HIPAAComplianceEngine,
    BAAAgreement,
    TamperEvidentLogEntry,
    AuditActionType,
    hipaa_engine
)


class TestBAAAgreement:
    """Test Business Associate Agreement management"""
    
    def test_create_agreement(self):
        """Test BAA agreement creation"""
        baa = BAAAgreement()
        baa_id = baa.create_agreement(
            covered_entity_name="City Medical Center",
            covered_entity_npi="1234567890",
            effective_date=datetime.utcnow()
        )
        
        assert baa_id.startswith("BAA-")
        assert baa_id in baa.agreements
        assert baa.agreements[baa_id]["covered_entity"]["name"] == "City Medical Center"
    
    def test_validate_active_agreement(self):
        """Test validating active BAA"""
        baa = BAAAgreement()
        baa_id = baa.create_agreement(
            covered_entity_name="Test Clinic",
            covered_entity_npi="0987654321"
        )
        
        # Mark as signed
        baa.agreements[baa_id]["signed_by_covered_entity"] = datetime.utcnow()
        
        is_valid, msg = baa.validate_agreement(baa_id)
        assert is_valid is True
        assert msg == "Valid"
    
    def test_validate_expired_agreement(self):
        """Test validating expired BAA"""
        baa = BAAAgreement()
        baa_id = baa.create_agreement(
            covered_entity_name="Old Clinic",
            covered_entity_npi="1111111111",
            effective_date=datetime.utcnow() - timedelta(days=2000)  # 5+ years ago
        )
        
        baa.agreements[baa_id]["signed_by_covered_entity"] = datetime.utcnow() - timedelta(days=2000)
        
        is_valid, msg = baa.validate_agreement(baa_id)
        assert is_valid is False
        assert "expired" in msg.lower()
    
    def test_validate_unsigned_agreement(self):
        """Test validating unsigned BAA"""
        baa = BAAAgreement()
        baa_id = baa.create_agreement(
            covered_entity_name="Test Clinic",
            covered_entity_npi="2222222222"
        )
        # Don't sign it
        
        is_valid, msg = baa.validate_agreement(baa_id)
        assert is_valid is False
        assert "not signed" in msg.lower()
    
    def test_generate_agreement_text(self):
        """Test BAA text generation"""
        baa = BAAAgreement()
        baa_id = baa.create_agreement(
            covered_entity_name="Test Hospital",
            covered_entity_npi="3333333333"
        )
        
        text = baa.get_agreement_text(baa_id)
        assert "BUSINESS ASSOCIATE AGREEMENT" in text
        assert "Test Hospital" in text
        assert "HIPAA" in text
        assert "TAMPER-EVIDENT HASH" in text


class TestTamperEvidentLogging:
    """Test tamper-evident audit logging"""
    
    @pytest.mark.asyncio
    async def test_log_audit_event(self, mock_db, env_vars):
        """Test creating audit log entry"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!",
            axiom_api_key="test_axiom_key"
        )
        
        # Mock Axiom call
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            log_id = await engine.log_audit_event(
                db=mock_db,
                user_id="user_001",
                user_type="human",
                action=AuditActionType.PHI_ACCESS,
                resource_type="denial_claim",
                resource_id="claim_001",
                phi_fields_accessed=["patient.mrn", "patient.name"],
                phi_patient_id="P-001"
            )
        
        assert log_id is not None
        assert len(log_id) > 0
        
        # Verify stored in MongoDB
        stored = mock_db.hipaa_audit_logs.find_one({"log_id": log_id})
        assert stored is not None
        assert stored["action"] == AuditActionType.PHI_ACCESS.value
        assert stored["user_id"] == "user_001"
        assert stored["entry_hash"] is not None
    
    @pytest.mark.asyncio
    async def test_log_chain_integrity(self, mock_db, env_vars):
        """Test hash chain maintains integrity"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!",
            axiom_api_key=None  # Skip Axiom for this test
        )
        
        # Create multiple logs
        log_ids = []
        for i in range(3):
            log_id = await engine.log_audit_event(
                db=mock_db,
                user_id=f"user_00{i+1}",
                user_type="system",
                action=AuditActionType.AUTOMATED_SESSION,
                resource_type="denial_claim",
                resource_id=f"claim_00{i+1}",
                phi_fields_accessed=[]
            )
            log_ids.append(log_id)
        
        # Verify chain
        entries = list(mock_db.hipaa_audit_logs.find().sort("timestamp", 1))
        
        # First entry should have genesis previous hash
        assert entries[0]["previous_hash"] == "0" * 64
        
        # Each subsequent entry should reference previous
        for i in range(1, len(entries)):
            assert entries[i]["previous_hash"] == entries[i-1]["entry_hash"]
    
    @pytest.mark.asyncio
    async def test_verify_chain_integrity_valid(self, mock_db, env_vars):
        """Test chain verification with valid chain"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!",
            axiom_api_key=None
        )
        
        # Create valid chain
        for i in range(5):
            await engine.log_audit_event(
                db=mock_db,
                user_id="user_001",
                user_type="system",
                action=AuditActionType.PHI_ACCESS,
                resource_type="denial_claim",
                resource_id=f"claim_00{i}",
                phi_fields_accessed=["patient.mrn"]
            )
        
        # Verify
        result = await engine.verify_chain_integrity(mock_db)
        
        assert result["status"] == "verified"
        assert result["valid"] is True
        assert result["total_entries"] == 5
        assert len(result["violations"]) == 0
    
    @pytest.mark.asyncio
    async def test_verify_chain_integrity_tampered(self, mock_db, env_vars):
        """Test chain verification detects tampering"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!",
            axiom_api_key=None
        )
        
        # Create chain
        await engine.log_audit_event(
            db=mock_db,
            user_id="user_001",
            user_type="system",
            action=AuditActionType.PHI_ACCESS,
            resource_type="denial_claim",
            resource_id="claim_001",
            phi_fields_accessed=["patient.mrn"]
        )
        
        # Tamper with the entry
        entry = mock_db.hipaa_audit_logs.find_one()
        mock_db.hipaa_audit_logs.update_one(
            {"_id": entry["_id"]},
            {"$set": {"action": "TAMPERED_ACTION"}}
        )
        
        # Verify should detect tampering
        result = await engine.verify_chain_integrity(mock_db)
        
        assert result["status"] == "tampered"
        assert result["valid"] is False
        assert len(result["violations"]) > 0
    
    @pytest.mark.asyncio
    async def test_phi_encryption(self, env_vars):
        """Test PHI encryption and decryption"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!"
        )
        
        sensitive_data = "John Doe - SSN: 123-45-6789"
        
        # Encrypt
        encrypted = engine.encrypt_phi(sensitive_data)
        assert encrypted.startswith("[ENC]")
        assert encrypted != sensitive_data
        
        # Decrypt
        decrypted = engine.decrypt_phi(encrypted)
        assert decrypted == sensitive_data
    
    @pytest.mark.asyncio
    async def test_phi_encryption_no_key(self, env_vars):
        """Test PHI handling without encryption key"""
        engine = HIPAAComplianceEngine(encryption_key=None)
        
        sensitive_data = "Test Patient Data"
        
        # Should mark as unencrypted
        encrypted = engine.encrypt_phi(sensitive_data)
        assert encrypted.startswith("[UNENCRYPTED]")
        assert sensitive_data in encrypted
    
    @pytest.mark.asyncio
    async def test_validate_phi_access_allowed(self, env_vars):
        """Test PHI access validation - allowed fields"""
        engine = HIPAAComplianceEngine()
        
        # Create BAA
        baa_id = engine.baa_manager.create_agreement(
            covered_entity_name="Test Clinic",
            covered_entity_npi="1234567890"
        )
        engine.baa_manager.agreements[baa_id]["signed_by_covered_entity"] = datetime.utcnow()
        
        # Validate access
        is_allowed, violations = engine.validate_phi_access(
            user_id="user_001",
            user_role="billing_analyst",
            requested_fields=["patient.mrn", "patient.first_name", "procedure.procedure_code"],
            baa_id=baa_id
        )
        
        assert is_allowed is True
        assert len(violations) == 0
    
    @pytest.mark.asyncio
    async def test_validate_phi_access_denied(self, env_vars):
        """Test PHI access validation - unauthorized fields"""
        engine = HIPAAComplianceEngine()
        
        # Create BAA
        baa_id = engine.baa_manager.create_agreement(
            covered_entity_name="Test Clinic",
            covered_entity_npi="1234567890"
        )
        engine.baa_manager.agreements[baa_id]["signed_by_covered_entity"] = datetime.utcnow()
        
        # Try to access unauthorized fields
        is_allowed, violations = engine.validate_phi_access(
            user_id="user_001",
            user_role="billing_analyst",
            requested_fields=["patient.ssn", "patient.date_of_birth"],  # Not allowed for billing_analyst
            baa_id=baa_id
        )
        
        assert is_allowed is False
        assert len(violations) > 0
    
    @pytest.mark.asyncio
    async def test_generate_compliance_report(self, mock_db, env_vars):
        """Test compliance report generation"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!",
            axiom_api_key=None
        )
        
        # Create audit trail
        for i in range(10):
            await engine.log_audit_event(
                db=mock_db,
                user_id="user_001",
                user_type="system",
                action=AuditActionType.PHI_ACCESS,
                resource_type="denial_claim",
                resource_id=f"claim_00{i}",
                phi_fields_accessed=["patient.mrn"]
            )
        
        # Generate report
        report = await engine.generate_compliance_report(
            db=mock_db,
            organization_id="org_001",
            start_date=datetime.utcnow() - timedelta(days=30),
            end_date=datetime.utcnow()
        )
        
        assert report["report_id"].startswith("HIPAA-")
        assert report["summary"]["total_audit_events"] == 10
        assert report["compliance_status"] in ["COMPLIANT", "REVIEW_REQUIRED"]
        assert "certification" in report
    
    @pytest.mark.asyncio
    async def test_signature_verification(self, mock_db, env_vars):
        """Test HMAC signature generation and verification"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!"
        )
        
        # Create entry with signature
        log_id = await engine.log_audit_event(
            db=mock_db,
            user_id="user_001",
            user_type="system",
            action=AuditActionType.PHI_ACCESS,
            resource_type="denial_claim",
            resource_id="claim_001",
            phi_fields_accessed=["patient.mrn"]
        )
        
        # Verify signature was created
        entry = mock_db.hipaa_audit_logs.find_one({"log_id": log_id})
        assert entry["signature"] is not None
        assert len(entry["signature"]) > 0


class TestHIPAAEdgeCases:
    """Test edge cases and error handling"""
    
    @pytest.mark.asyncio
    async def test_empty_phi_fields(self, mock_db, env_vars):
        """Test logging with no PHI fields accessed"""
        engine = HIPAAComplianceEngine()
        
        log_id = await engine.log_audit_event(
            db=mock_db,
            user_id="user_001",
            user_type="system",
            action=AuditActionType.LOGIN,
            resource_type="system",
            resource_id="login_001",
            phi_fields_accessed=[]  # No PHI
        )
        
        assert log_id is not None
        entry = mock_db.hipaa_audit_logs.find_one({"log_id": log_id})
        assert entry["phi_fields_accessed"] == []
    
    @pytest.mark.asyncio
    async def test_invalid_baa_id(self, env_vars):
        """Test validation with invalid BAA ID"""
        engine = HIPAAComplianceEngine()
        
        is_allowed, violations = engine.validate_phi_access(
            user_id="user_001",
            user_role="admin",
            requested_fields=["patient.mrn"],
            baa_id="INVALID-BAA-ID"
        )
        
        assert is_allowed is False
        assert "not found" in violations[0].lower()
    
    @pytest.mark.asyncio
    async def test_chain_with_no_entries(self, mock_db, env_vars):
        """Test chain verification with empty database"""
        engine = HIPAAComplianceEngine()
        
        result = await engine.verify_chain_integrity(mock_db)
        
        assert result["status"] == "no_entries"
        assert result["valid"] is True
    
    @pytest.mark.asyncio
    async def test_concurrent_logging(self, mock_db, env_vars):
        """Test concurrent audit log creation"""
        engine = HIPAAComplianceEngine(axiom_api_key=None)
        
        # Create multiple logs concurrently
        tasks = []
        for i in range(10):
            task = engine.log_audit_event(
                db=mock_db,
                user_id=f"user_{i}",
                user_type="system",
                action=AuditActionType.PHI_ACCESS,
                resource_type="denial_claim",
                resource_id=f"claim_{i}",
                phi_fields_accessed=["patient.mrn"]
            )
            tasks.append(task)
        
        await asyncio.gather(*tasks)
        
        # Verify all logs stored
        count = mock_db.hipaa_audit_logs.count_documents({})
        assert count == 10
    
    @pytest.mark.asyncio  
    async def test_unicode_phi_data(self, env_vars):
        """Test encryption with unicode characters"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!"
        )
        
        unicode_data = "José García-Müller 日本語"
        
        encrypted = engine.encrypt_phi(unicode_data)
        decrypted = engine.decrypt_phi(encrypted)
        
        assert decrypted == unicode_data
    
    @pytest.mark.asyncio
    async def test_very_long_phi_data(self, env_vars):
        """Test encryption with very long PHI strings"""
        engine = HIPAAComplianceEngine(
            encryption_key="test_key_32_characters_long!"
        )
        
        # 10KB of data
        long_data = "A" * (10 * 1024)
        
        encrypted = engine.encrypt_phi(long_data)
        decrypted = engine.decrypt_phi(encrypted)
        
        assert decrypted == long_data
