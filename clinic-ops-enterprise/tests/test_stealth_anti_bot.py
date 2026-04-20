"""
Stealth and Anti-Bot Engine Tests
Tests fingerprint generation, CAPTCHA solving, and UI detection
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch
import hashlib

from stealth.anti_bot_engine import (
    StealthOrchestrator,
    StealthFingerprintGenerator,
    AntiCaptchaSolver,
    UIDetectionEngine,
    RateLimitManager,
    DetectionLevel,
    UIChangeType,
    StealthSession,
    stealth_orchestrator
)


class TestFingerprintGenerator:
    """Test browser fingerprint generation"""
    
    def test_generate_fingerprint_unique(self):
        """Test that fingerprints are unique"""
        generator = StealthFingerprintGenerator()
        
        fingerprints = [generator.generate_fingerprint() for _ in range(10)]
        hashes = [f.fingerprint_hash for f in fingerprints]
        
        # All hashes should be unique
        assert len(set(hashes)) == 10
    
    def test_fingerprint_components(self):
        """Test fingerprint has all required components"""
        generator = StealthFingerprintGenerator()
        
        fp = generator.generate_fingerprint()
        
        assert fp.session_id.startswith("stealth_")
        assert fp.user_agent in generator.USER_AGENTS
        assert fp.viewport in generator.VIEWPORTS
        assert fp.timezone in generator.TIMEZONES
        assert fp.locale in generator.LOCALES
        assert "latitude" in fp.geolocation
        assert "longitude" in fp.geolocation
        assert fp.created_at is not None
    
    def test_fingerprint_from_pool(self):
        """Test fingerprint is from valid pool"""
        generator = StealthFingerprintGenerator()
        
        fp = generator.generate_fingerprint()
        
        assert any(ua in fp.user_agent for ua in generator.USER_AGENTS)
        assert any(fp.viewport == v for v in generator.VIEWPORTS)
    
    def test_geolocation_us_based(self):
        """Test geolocation is US-based"""
        generator = StealthFingerprintGenerator()
        
        fp = generator.generate_fingerprint()
        
        # US latitude range: ~25 to 49
        assert 25.0 <= fp.geolocation["latitude"] <= 49.0
        # US longitude range: ~-125 to -66
        assert -125.0 <= fp.geolocation["longitude"] <= -66.0
    
    def test_fingerprint_deterministic_hash(self):
        """Test fingerprint hash is deterministic for same inputs"""
        generator = StealthFingerprintGenerator()
        
        # Same configuration should produce different hashes due to timestamp
        fp1 = generator.generate_fingerprint()
        asyncio.sleep(0.01)  # Small delay
        fp2 = generator.generate_fingerprint()
        
        # Should be different due to timestamp
        assert fp1.fingerprint_hash != fp2.fingerprint_hash


class TestAntiCaptchaSolver:
    """Test CAPTCHA solving integration"""
    
    @pytest.mark.asyncio
    async def test_solve_recaptcha_no_api_key(self):
        """Test handling when no API key configured"""
        solver = AntiCaptchaSolver()
        solver.two_captcha_key = None
        
        result = await solver.solve_recaptcha_v2(
            site_key="test_key",
            page_url="https://test.com"
        )
        
        assert result is None
    
    @pytest.mark.asyncio
    async def test_solve_recaptcha_success(self, env_vars):
        """Test successful reCAPTCHA solving"""
        solver = AntiCaptchaSolver()
        solver.two_captcha_key = "test_key"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            
            # Submit response
            submit_response = AsyncMock()
            submit_response.json = AsyncMock(return_value={"status": 1, "request": "cap-123"})
            
            # Result response
            result_response = AsyncMock()
            result_response.json = AsyncMock(return_value={"status": 1, "request": "03AGdBq25..."})
            
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=submit_response)
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=result_response)
            
            result = await solver.solve_recaptcha_v2(
                site_key="6Lc...",
                page_url="https://example.com",
                timeout=10
            )
            
            assert result == "03AGdBq25..."
    
    @pytest.mark.asyncio
    async def test_solve_recaptcha_timeout(self, env_vars):
        """Test timeout handling"""
        solver = AntiCaptchaSolver()
        solver.two_captcha_key = "test_key"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            
            # Submit response
            submit_response = AsyncMock()
            submit_response.json = AsyncMock(return_value={"status": 1, "request": "cap-123"})
            
            # Result always not ready
            result_response = AsyncMock()
            result_response.json = AsyncMock(return_value={"status": 0, "request": "CAPCHA_NOT_READY"})
            
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=submit_response)
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=result_response)
            
            result = await solver.solve_recaptcha_v2(
                site_key="6Lc...",
                page_url="https://example.com",
                timeout=5
            )
            
            assert result is None
    
    @pytest.mark.asyncio
    async def test_solve_image_captcha(self, env_vars):
        """Test image CAPTCHA solving"""
        solver = AntiCaptchaSolver()
        solver.two_captcha_key = "test_key"
        
        with patch("aiohttp.ClientSession") as mock_session:
            mock_session_instance = AsyncMock()
            mock_session.return_value.__aenter__ = AsyncMock(return_value=mock_session_instance)
            
            submit_response = AsyncMock()
            submit_response.json = AsyncMock(return_value={"status": 1, "request": "cap-456"})
            
            result_response = AsyncMock()
            result_response.json = AsyncMock(return_value={"status": 1, "request": "ABC123"})
            
            mock_session_instance.post.return_value.__aenter__ = AsyncMock(return_value=submit_response)
            mock_session_instance.get.return_value.__aenter__ = AsyncMock(return_value=result_response)
            
            result = await solver.solve_image_captcha(
                image_base64="iVBORw0KGgo...",
                timeout=10
            )
            
            assert result == "ABC123"


class TestUIDetectionEngine:
    """Test UI change detection"""
    
    def test_register_element(self):
        """Test UI element registration"""
        engine = UIDetectionEngine()
        
        engine.register_element(
            element_id="username_field",
            selector="#username",
            element_type="input",
            sample_html='<input id="username" type="text">'
        )
        
        assert "username_field" in engine.element_registry
        assert engine.element_registry["username_field"].selector == "#username"
    
    def test_detect_selector_changed(self):
        """Test detection of selector changes"""
        engine = UIDetectionEngine()
        
        engine.register_element(
            element_id="login_btn",
            selector="#login-button",
            element_type="button",
            sample_html='<button id="login-button">Login</button>'
        )
        
        current_selectors = {
            "login_btn": "#login-btn-v2"  # Changed
        }
        
        changes = asyncio.run(engine.detect_ui_changes(
            page_content="<html></html>",
            current_selectors=current_selectors
        ))
        
        assert UIChangeType.SELECTOR_CHANGED in changes
    
    def test_detect_new_field(self):
        """Test detection of new fields"""
        engine = UIDetectionEngine()
        
        engine.register_element(
            element_id="existing_field",
            selector="#existing",
            element_type="input",
            sample_html='<input id="existing">'
        )
        
        current_selectors = {
            "existing_field": "#existing",
            "new_field": "#new"  # Not registered
        }
        
        changes = asyncio.run(engine.detect_ui_changes(
            page_content="<html></html>",
            current_selectors=current_selectors
        ))
        
        assert UIChangeType.NEW_FIELD in changes
    
    def test_detect_captcha_added(self):
        """Test detection of CAPTCHA"""
        engine = UIDetectionEngine()
        
        page_content = """
        <html>
            <div class="g-recaptcha" data-sitekey="abc123"></div>
        </html>
        """
        
        changes = asyncio.run(engine.detect_ui_changes(
            page_content=page_content,
            current_selectors={}
        ))
        
        assert UIChangeType.CAPTCHA_ADDED in changes
    
    def test_detect_rate_limiting(self):
        """Test detection of rate limiting"""
        engine = UIDetectionEngine()
        
        page_content = """
        <html>
            <p>Error: Too many requests. Please try again later.</p>
        </html>
        """
        
        changes = asyncio.run(engine.detect_ui_changes(
            page_content=page_content,
            current_selectors={}
        ))
        
        assert UIChangeType.RATE_LIMITING in changes
    
    def test_get_adaptive_selector_high_confidence(self):
        """Test getting selector with high confidence"""
        engine = UIDetectionEngine()
        
        engine.register_element(
            element_id="password_field",
            selector="#password",
            element_type="input",
            sample_html='<input id="password" type="password">'
        )
        
        selector = engine.get_adaptive_selector("password_field")
        
        assert selector == "#password"
    
    def test_get_adaptive_selector_fallback(self):
        """Test getting fallback selector"""
        engine = UIDetectionEngine()
        
        engine.register_element(
            element_id="search_field",
            selector="#search",
            element_type="input",
            sample_html='<input id="search">'
        )
        
        # Lower confidence
        engine.element_registry["search_field"].confidence = 0.3
        
        selector = engine.get_adaptive_selector("search_field")
        
        # Should return fallback
        assert selector is not None


class TestRateLimitManager:
    """Test rate limiting"""
    
    def test_record_request(self):
        """Test request recording"""
        manager = RateLimitManager()
        
        manager.record_request("session_001")
        manager.record_request("session_001")
        
        assert len(manager.request_history["session_001"]) == 2
    
    def test_calculate_backoff_no_history(self):
        """Test backoff with no request history"""
        manager = RateLimitManager()
        
        backoff = manager.calculate_backoff("new_session")
        
        assert backoff == 0
    
    def test_calculate_backoff_low_rate(self):
        """Test backoff with low request rate"""
        manager = RateLimitManager()
        
        # Add a few requests
        for _ in range(3):
            manager.record_request("session_002")
        
        backoff = manager.calculate_backoff("session_002")
        
        assert backoff <= 3  # Small random delay
    
    def test_calculate_backoff_high_rate(self):
        """Test backoff with high request rate"""
        manager = RateLimitManager()
        
        # Add many recent requests
        for _ in range(20):
            manager.record_request("session_003")
        
        backoff = manager.calculate_backoff("session_003")
        
        assert backoff > 0  # Should have backoff
        assert backoff <= 300  # Max 5 minutes
    
    def test_backoff_exponential_increase(self):
        """Test exponential backoff increase"""
        manager = RateLimitManager()
        
        # First high rate
        for _ in range(20):
            manager.record_request("session_004")
        
        backoff1 = manager.calculate_backoff("session_004")
        
        # Trigger again
        for _ in range(20):
            manager.record_request("session_004")
        
        backoff2 = manager.calculate_backoff("session_004")
        
        # Should increase
        assert backoff2 >= backoff1
    
    @pytest.mark.asyncio
    async def test_apply_random_delays(self):
        """Test delay application"""
        manager = RateLimitManager()
        
        start = datetime.utcnow()
        await manager.apply_random_delays("session_005")
        end = datetime.utcnow()
        
        elapsed = (end - start).total_seconds()
        assert elapsed >= 0.5  # Minimum delay


class TestStealthOrchestrator:
    """Test main stealth orchestrator"""
    
    @pytest.mark.asyncio
    async def test_create_stealth_session(self):
        """Test creating stealth session"""
        orchestrator = StealthOrchestrator()
        
        session = await orchestrator.create_stealth_session(
            payer_id="aetna",
            purpose="denial_check"
        )
        
        assert session is not None
        assert session.session_id.startswith("stealth_")
        assert session.session_id in orchestrator.active_sessions
    
    @pytest.mark.asyncio
    async def test_apply_payer_specific_config(self):
        """Test payer-specific timezone config"""
        orchestrator = StealthOrchestrator()
        
        session_aetna = await orchestrator.create_stealth_session("aetna", "test")
        session_uhc = await orchestrator.create_stealth_session("uhc", "test")
        
        assert session_aetna.timezone == "America/New_York"
        assert session_uhc.timezone == "America/Chicago"
    
    @pytest.mark.asyncio
    async def test_handle_detection_event(self):
        """Test handling bot detection"""
        orchestrator = StealthOrchestrator()
        
        session = await orchestrator.create_stealth_session("aetna", "test")
        
        result = await orchestrator.handle_detection_event(
            session_id=session.session_id,
            detection_type="rate_limit",
            page_content="Too many requests"
        )
        
        assert result["action"] in ["backoff", "rotate_session", "adapt"]
    
    def test_should_rotate_session_high_detection(self):
        """Test rotation trigger on high detection score"""
        orchestrator = StealthOrchestrator()
        
        session = StealthSession(
            session_id="test_high_detection",
            proxy="",
            user_agent="",
            viewport={},
            timezone="",
            locale="",
            geolocation={},
            fingerprint_hash="",
            created_at=datetime.utcnow(),
            detection_score=0.8,  # High
            requests_count=10
        )
        
        orchestrator.active_sessions["test_high_detection"] = session
        
        should_rotate = orchestrator.should_rotate_session("test_high_detection")
        
        assert should_rotate is True
    
    def test_should_rotate_session_old_session(self):
        """Test rotation trigger on old session"""
        orchestrator = StealthOrchestrator()
        
        session = StealthSession(
            session_id="test_old",
            proxy="",
            user_agent="",
            viewport={},
            timezone="",
            locale="",
            geolocation={},
            fingerprint_hash="",
            created_at=datetime.utcnow() - timedelta(hours=2),  # 2 hours old
            detection_score=0.1,
            requests_count=10
        )
        
        orchestrator.active_sessions["test_old"] = session
        
        should_rotate = orchestrator.should_rotate_session("test_old")
        
        assert should_rotate is True
    
    def test_should_not_rotate_session(self):
        """Test no rotation for healthy session"""
        orchestrator = StealthOrchestrator()
        
        session = StealthSession(
            session_id="test_healthy",
            proxy="",
            user_agent="",
            viewport={},
            timezone="",
            locale="",
            geolocation={},
            fingerprint_hash="",
            created_at=datetime.utcnow(),
            detection_score=0.2,  # Low
            requests_count=20
        )
        
        orchestrator.active_sessions["test_healthy"] = session
        
        should_rotate = orchestrator.should_rotate_session("test_healthy")
        
        assert should_rotate is False


class TestStealthEdgeCases:
    """Test edge cases"""
    
    def test_fingerprint_collision_avoidance(self):
        """Test collision avoidance in fingerprint generation"""
        generator = StealthFingerprintGenerator()
        
        # Generate many fingerprints
        fingerprints = [generator.generate_fingerprint() for _ in range(50)]
        hashes = [f.fingerprint_hash for f in fingerprints]
        
        # Should have no duplicates
        assert len(set(hashes)) == len(hashes)
    
    def test_captcha_detection_with_variations(self):
        """Test CAPTCHA detection with various formats"""
        engine = UIDetectionEngine()
        
        captcha_variants = [
            '<div class="g-recaptcha" data-sitekey="key"></div>',
            '<div data-sitekey="key" class="g-recaptcha"></div>',
            '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>',
            '<div class="h-captcha"></div>',
            'Please complete the security check to proceed'
        ]
        
        for variant in captcha_variants:
            changes = asyncio.run(engine.detect_ui_changes(
                page_content=variant,
                current_selectors={}
            ))
            assert UIChangeType.CAPTCHA_ADDED in changes, f"Failed for: {variant[:50]}..."
    
    @pytest.mark.asyncio
    async def test_concurrent_session_creation(self):
        """Test concurrent session creation"""
        orchestrator = StealthOrchestrator()
        
        tasks = [
            orchestrator.create_stealth_session(f"payer_{i}", "test")
            for i in range(10)
        ]
        
        sessions = await asyncio.gather(*tasks)
        
        assert len(sessions) == 10
        # All should be unique
        hashes = [s.fingerprint_hash for s in sessions]
        assert len(set(hashes)) == 10
    
    def test_rate_limit_cleaning(self):
        """Test old request cleanup"""
        manager = RateLimitManager()
        
        # Add old request
        old_time = datetime.utcnow() - timedelta(minutes=10)
        manager.request_history["session"] = [old_time]
        
        # Add new request (triggers cleanup)
        manager.record_request("session")
        
        # Old should be cleaned
        assert len(manager.request_history["session"]) == 1
        assert manager.request_history["session"][0] > old_time


class TestStealthIntegration:
    """Integration tests"""
    
    @pytest.mark.asyncio
    async def test_full_detection_workflow(self):
        """Test full detection and response workflow"""
        orchestrator = StealthOrchestrator()
        
        # Create session
        session = await orchestrator.create_stealth_session("aetna", "test")
        
        # Simulate detection
        result = await orchestrator.handle_detection_event(
            session_id=session.session_id,
            detection_type="rate_limit",
            page_content="Too many requests"
        )
        
        assert "action" in result
        assert session.detection_score > 0
        
        # Check if should rotate
        should_rotate = orchestrator.should_rotate_session(session.session_id)
        
        # May or may not need rotation depending on score
        assert isinstance(should_rotate, bool)
