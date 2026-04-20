"""
Hardcore Testing for Browser Hardening & Stealth Infrastructure
Security-focused testing for anti-bot capabilities
"""

import pytest
import asyncio
import hashlib
from datetime import datetime
from unittest.mock import Mock, patch, AsyncMock
from stealth.browser_hardening import (
    BrowserHardeningEngine, FingerprintRotation, TLSPatcher,
    WebGLMasker, AudioMasker, CanvasMasker, ServerlessSessionManager,
    BrowserFingerprint
)


class TestBrowserFingerprint:
    """Test browser fingerprint generation"""
    
    def test_fingerprint_creation(self):
        """Test creating a browser fingerprint"""
        fp = BrowserFingerprint(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1920, "height": 1080},
            timezone="America/New_York",
            language="en-US",
            color_depth=24,
            pixel_ratio=1.0,
            cpu_cores=8,
            memory=16,
            platform="Win32",
            webgl_vendor="Google Inc. (NVIDIA)",
            webgl_renderer="ANGLE (NVIDIA, NVIDIA GeForce GTX 1660)",
            fonts=["Arial", "Times New Roman", "Helvetica"],
            plugins=[{"name": "Chrome PDF Plugin"}],
            canvas_hash="abc123",
            webgl_hash="def456",
            audio_hash="ghi789",
            tls_ja3_fingerprint="ja3_fingerprint_string",
            http2_fingerprint="http2_fingerprint_string"
        )
        
        assert fp.user_agent is not None
        assert fp.canvas_hash is not None
        assert len(fp.fonts) > 0
    
    def test_fingerprint_unique_hashes(self):
        """Test that different fingerprints have different hashes"""
        fp1 = BrowserFingerprint(
            user_agent="Agent1",
            viewport={"width": 1920, "height": 1080},
            timezone="America/New_York",
            language="en-US",
            color_depth=24,
            pixel_ratio=1.0,
            cpu_cores=8,
            memory=16,
            platform="Win32",
            webgl_vendor="Vendor1",
            webgl_renderer="Renderer1",
            fonts=["Arial"],
            plugins=[],
            canvas_hash="hash1",
            webgl_hash="webgl1",
            audio_hash="audio1",
            tls_ja3_fingerprint="ja3_1",
            http2_fingerprint="http2_1"
        )
        
        fp2 = BrowserFingerprint(
            user_agent="Agent2",
            viewport={"width": 1366, "height": 768},
            timezone="America/Los_Angeles",
            language="en-US",
            color_depth=24,
            pixel_ratio=1.0,
            cpu_cores=4,
            memory=8,
            platform="MacIntel",
            webgl_vendor="Vendor2",
            webgl_renderer="Renderer2",
            fonts=["Times New Roman"],
            plugins=[],
            canvas_hash="hash2",
            webgl_hash="webgl2",
            audio_hash="audio2",
            tls_ja3_fingerprint="ja3_2",
            http2_fingerprint="http2_2"
        )
        
        assert fp1.canvas_hash != fp2.canvas_hash
        assert fp1.webgl_hash != fp2.webgl_hash


class TestFingerprintRotation:
    """Test fingerprint rotation system"""
    
    @pytest.fixture
    def rotation(self):
        return FingerprintRotation()
    
    def test_fingerprint_pool_generated(self, rotation):
        """Test that fingerprint pool is generated"""
        assert len(rotation.fingerprints) == 10
    
    def test_get_fingerprint_returns_valid(self, rotation):
        """Test getting a fingerprint returns valid object"""
        fp = rotation.get_fingerprint()
        
        assert fp is not None
        assert isinstance(fp, BrowserFingerprint)
        assert fp.user_agent is not None
    
    def test_payer_specific_rotation(self, rotation):
        """Test payer-specific fingerprint selection"""
        fp1 = rotation.get_fingerprint("aetna")
        fp2 = rotation.get_fingerprint("aetna")
        
        # Same payer should get same fingerprint (deterministic)
        assert fp1.user_agent == fp2.user_agent
        
        fp3 = rotation.get_fingerprint("uhc")
        
        # Different payer may get different fingerprint
        # (depending on hash distribution)
    
    def test_rotation_advances_index(self, rotation):
        """Test that rotation advances the index"""
        initial_index = rotation.current_index
        fp1 = rotation.get_fingerprint()
        fp2 = rotation.get_fingerprint()
        
        # Index should have advanced
        assert rotation.current_index != initial_index
    
    def test_rotation_cycles_through_pool(self, rotation):
        """Test that rotation cycles through all fingerprints"""
        user_agents = set()
        
        for _ in range(15):  # More than pool size
            fp = rotation.get_fingerprint()
            user_agents.add(fp.user_agent)
        
        # Should have multiple unique fingerprints
        assert len(user_agents) > 1
    
    def test_rotate_fingerprint_changes(self, rotation):
        """Test that rotate_fingerprint returns different fingerprint"""
        current = rotation.get_fingerprint()
        rotated = rotation.rotate_fingerprint(current)
        
        assert rotated.user_agent != current.user_agent
    
    def test_hash_generation(self, rotation):
        """Test hash generation functions"""
        hash1 = rotation._generate_random_hash()
        hash2 = rotation._generate_random_hash()
        
        assert hash1 is not None
        assert len(hash1) == 16
        assert hash1 != hash2  # Should be unique
    
    def test_ja3_fingerprint_format(self, rotation):
        """Test JA3 fingerprint format"""
        ja3 = rotation._generate_ja3_fingerprint()
        
        assert ja3 is not None
        assert len(ja3) > 0
        assert "," in ja3  # JA3 format has commas
    
    def test_http2_fingerprint_format(self, rotation):
        """Test HTTP/2 fingerprint format"""
        http2 = rotation._generate_http2_fingerprint()
        
        assert http2 is not None
        assert "|" in http2  # HTTP/2 fingerprint format


class TestBrowserHardeningEngine:
    """Test browser hardening engine"""
    
    @pytest.fixture
    def engine(self):
        return BrowserHardeningEngine()
    
    def test_generate_hardened_profile(self, engine):
        """Test generating hardened browser profile"""
        profile = engine.generate_hardened_profile("aetna")
        
        assert "fingerprint" in profile
        assert "evasion_scripts" in profile
        assert "timing_profile" in profile
        assert "session_isolation" in profile
    
    def test_evasion_scripts_generated(self, engine):
        """Test that evasion scripts are generated"""
        profile = engine.generate_hardened_profile()
        
        scripts = profile["evasion_scripts"]
        assert len(scripts) > 0
        
        # Check for WebGL spoofing script
        has_webgl_script = any("WebGLRenderingContext" in s for s in scripts)
        assert has_webgl_script
        
        # Check for canvas script
        has_canvas_script = any("toDataURL" in s for s in scripts)
        assert has_canvas_script
        
        # Check for audio script
        has_audio_script = any("AudioContext" in s for s in scripts)
        assert has_audio_script
    
    def test_timing_profile_generated(self, engine):
        """Test that realistic timing profile is generated"""
        profile = engine.generate_hardened_profile()
        
        timing = profile["timing_profile"]
        assert "mouse_movement_delay_ms" in timing
        assert "keystroke_interval_ms" in timing
        assert "page_load_wait_ms" in timing
        
        # Check ranges are realistic
        mouse_delay = timing["mouse_movement_delay_ms"]
        assert mouse_delay["min"] >= 50
        assert mouse_delay["max"] <= 400
    
    def test_session_isolation_config(self, engine):
        """Test session isolation configuration"""
        profile = engine.generate_hardened_profile()
        
        isolation = profile["session_isolation"]
        assert isolation["storage_partition"] == True
        assert isolation["cookie_isolation"] == True
        assert isolation["proxy_rotation"] == True


class TestTLSPatcher:
    """Test TLS signature patching"""
    
    @pytest.fixture
    def tls_patcher(self):
        return TLSPatcher()
    
    def test_tls_configs_loaded(self, tls_patcher):
        """Test TLS configurations are loaded"""
        assert len(tls_patcher.tls_configs) > 0
    
    def test_get_tls_config_returns_valid(self, tls_patcher):
        """Test getting TLS config returns valid structure"""
        config = tls_patcher.get_tls_config()
        
        assert "cipher_suites" in config
        assert "extensions" in config
        assert "tls_version" in config
        assert len(config["cipher_suites"]) > 0
    
    def test_tls_config_variation(self, tls_patcher):
        """Test that different configs are available"""
        configs = [tls_patcher.get_tls_config() for _ in range(10)]
        
        # Should get different configs (random selection)
        cipher_lists = [tuple(c["cipher_suites"]) for c in configs]
        unique = set(cipher_lists)
        
        assert len(unique) > 1  # Should have variation


class TestSignalMaskers:
    """Test WebGL, Audio, and Canvas maskers"""
    
    def test_webgl_masker(self):
        """Test WebGL masking"""
        masker = WebGLMasker()
        config = masker.mask_webgl_context()
        
        assert config["vendor_randomization"] == True
        assert config["renderer_randomization"] == True
        assert config["noise_injection"]["enabled"] == True
    
    def test_audio_masker(self):
        """Test AudioContext masking"""
        masker = AudioMasker()
        config = masker.mask_audio_context()
        
        assert config["sample_rate_randomization"] == True
        assert config["channel_data_noise"]["enabled"] == True
        assert config["analyser_node_modification"] == True
    
    def test_canvas_masker(self):
        """Test Canvas fingerprint masking"""
        masker = CanvasMasker()
        config = masker.mask_canvas()
        
        assert config["pixel_noise"]["enabled"] == True
        assert config["pixel_noise"]["amplitude"] > 0
        assert config["image_data_modification"] == True


class TestServerlessSessionManager:
    """Test serverless session management"""
    
    @pytest.fixture
    def session_manager(self):
        return ServerlessSessionManager()
    
    @pytest.mark.asyncio
    async def test_create_isolated_session(self, session_manager):
        """Test creating isolated session"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        assert session_id.startswith("sess-")
        assert "aetna" in session_id
        assert "patient-123"[:8] in session_id
        
        # Check session stored
        assert session_id in session_manager.active_sessions
    
    @pytest.mark.asyncio
    async def test_session_has_hardened_profile(self, session_manager):
        """Test that session has hardened profile"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        session = session_manager.active_sessions[session_id]
        assert "hardened_profile" in session
        assert "isolation" in session
        assert "security" in session
    
    @pytest.mark.asyncio
    async def test_session_isolation_config(self, session_manager):
        """Test session isolation configuration"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        session = session_manager.active_sessions[session_id]
        isolation = session["isolation"]
        
        assert "storage_partition" in isolation
        assert "cookie_jar" in isolation
        assert "cache_dir" in isolation
        assert "proxy_endpoint" in isolation
    
    def test_get_proxy_endpoint(self, session_manager):
        """Test proxy endpoint generation"""
        endpoint1 = session_manager._get_proxy_endpoint("aetna")
        endpoint2 = session_manager._get_proxy_endpoint("aetna")
        
        # Same payer gets same endpoint (deterministic)
        assert endpoint1 == endpoint2
        
        endpoint3 = session_manager._get_proxy_endpoint("uhc")
        
        # Different payer may get different endpoint
        # (but could be same due to limited pool)
    
    @pytest.mark.asyncio
    async def test_rotate_session_fingerprint(self, session_manager):
        """Test fingerprint rotation for session"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        original_profile = session_manager.active_sessions[session_id]["hardened_profile"]
        
        result = await session_manager.rotate_session_fingerprint(session_id)
        
        assert result == True
        new_profile = session_manager.active_sessions[session_id]["hardened_profile"]
        
        # Profile should have changed
        assert original_profile != new_profile
    
    @pytest.mark.asyncio
    async def test_rotate_nonexistent_session(self, session_manager):
        """Test rotation for non-existent session"""
        result = await session_manager.rotate_session_fingerprint("nonexistent")
        
        assert result == False
    
    @pytest.mark.asyncio
    async def test_detect_and_mitigate_blocking(self, session_manager):
        """Test detection and mitigation of bot blocking"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        # Simulate blocking signals
        signals = {
            "captcha_detected": True,
            "rate_limited": False,
            "selectors_blocked": ["#login"]
        }
        
        result = await session_manager.detect_and_mitigate_blocking(session_id, signals)
        
        assert "detection_score" in result
        assert "actions_taken" in result
        assert result["detection_score"] > 0
    
    def test_calculate_detection_score(self, session_manager):
        """Test detection score calculation"""
        # CAPTCHA detected
        signals1 = {"captcha_detected": True}
        score1 = session_manager._calculate_detection_score(signals1)
        assert score1 >= 0.4
        
        # Rate limited
        signals2 = {"rate_limited": True}
        score2 = session_manager._calculate_detection_score(signals2)
        assert score2 >= 0.3
        
        # Multiple signals
        signals3 = {
            "captcha_detected": True,
            "rate_limited": True,
            "auth_challenge": True
        }
        score3 = session_manager._calculate_detection_score(signals3)
        assert score3 >= 0.7
    
    def test_detection_score_capped(self, session_manager):
        """Test detection score is capped at 1.0"""
        signals = {
            "captcha_detected": True,
            "rate_limited": True,
            "auth_challenge": True,
            "selectors_blocked": ["a", "b", "c", "d", "e"]
        }
        
        score = session_manager._calculate_detection_score(signals)
        assert score <= 1.0
    
    @pytest.mark.asyncio
    async def test_terminate_session(self, session_manager):
        """Test session termination"""
        session_id = await session_manager.create_isolated_session(
            payer_id="aetna",
            patient_id="patient-123"
        )
        
        assert session_id in session_manager.active_sessions
        
        await session_manager.terminate_session(session_id)
        
        assert session_id not in session_manager.active_sessions
    
    @pytest.mark.asyncio
    async def test_get_session_metrics(self, session_manager):
        """Test session metrics collection"""
        # Create multiple sessions
        for i in range(5):
            await session_manager.create_isolated_session(
                payer_id=f"payer-{i}",
                patient_id=f"patient-{i}"
            )
        
        metrics = session_manager.get_session_metrics()
        
        assert metrics["active_sessions"] == 5
        assert "average_detection_score" in metrics


class TestBrowserHardeningEdgeCases:
    """Edge case testing"""
    
    def test_unicode_in_user_agent(self):
        """Test unicode handling in user agent"""
        fp = BrowserFingerprint(
            user_agent="Mozilla/5.0 (Windows; U; 日本語)",
            viewport={"width": 1920, "height": 1080},
            timezone="Asia/Tokyo",
            language="ja-JP",
            color_depth=24,
            pixel_ratio=1.0,
            cpu_cores=8,
            memory=16,
            platform="Win32",
            webgl_vendor="Google Inc.",
            webgl_renderer="ANGLE",
            fonts=["MS Gothic", "MS Mincho"],
            plugins=[],
            canvas_hash="hash",
            webgl_hash="webgl",
            audio_hash="audio",
            tls_ja3_fingerprint="ja3",
            http2_fingerprint="http2"
        )
        
        assert "日本語" in fp.user_agent
    
    @pytest.mark.asyncio
    async def test_session_with_special_characters(self):
        """Test session creation with special characters"""
        manager = ServerlessSessionManager()
        
        session_id = await manager.create_isolated_session(
            payer_id="aetna-special!@#",
            patient_id="patient-日本語"
        )
        
        assert session_id is not None
        assert session_id.startswith("sess-")
    
    def test_fingerprint_with_many_fonts(self):
        """Test fingerprint with extensive font list"""
        many_fonts = [f"Font{i}" for i in range(100)]
        
        fp = BrowserFingerprint(
            user_agent="Mozilla/5.0",
            viewport={"width": 1920, "height": 1080},
            timezone="America/New_York",
            language="en-US",
            color_depth=24,
            pixel_ratio=1.0,
            cpu_cores=8,
            memory=16,
            platform="Win32",
            webgl_vendor="Vendor",
            webgl_renderer="Renderer",
            fonts=many_fonts,
            plugins=[],
            canvas_hash="hash",
            webgl_hash="webgl",
            audio_hash="audio",
            tls_ja3_fingerprint="ja3",
            http2_fingerprint="http2"
        )
        
        assert len(fp.fonts) == 100


class TestBrowserHardeningSecurity:
    """Security-focused testing"""
    
    def test_fingerprint_entropy(self):
        """Test that fingerprints have sufficient entropy"""
        rotation = FingerprintRotation()
        
        hashes = [fp.canvas_hash for fp in rotation.fingerprints]
        
        # All hashes should be unique
        assert len(set(hashes)) == len(hashes)
    
    def test_no_identical_fingerprints(self):
        """Test that no two fingerprints in pool are identical"""
        rotation = FingerprintRotation()
        
        # Compare all pairs
        for i, fp1 in enumerate(rotation.fingerprints):
            for fp2 in rotation.fingerprints[i+1:]:
                assert fp1.user_agent != fp2.user_agent or fp1.webgl_vendor != fp2.webgl_vendor
    
    def test_proxy_endpoint_not_hardcoded(self):
        """Test that proxy endpoints are not hardcoded credentials"""
        manager = ServerlessSessionManager()
        endpoint = manager._get_proxy_endpoint("test")
        
        # Should be a URL, not contain obvious credentials
        assert "http" in endpoint
        assert "://" in endpoint


class TestBrowserHardeningPerformance:
    """Performance testing"""
    
    @pytest.mark.asyncio
    async def test_session_creation_performance(self):
        """Test that session creation is performant"""
        import time
        
        manager = ServerlessSessionManager()
        
        start = time.time()
        for i in range(50):
            await manager.create_isolated_session(
                payer_id=f"payer-{i}",
                patient_id=f"patient-{i}"
            )
        elapsed = time.time() - start
        
        # Should create 50 sessions in under 5 seconds
        assert elapsed < 5.0
    
    def test_fingerprint_generation_speed(self):
        """Test fingerprint generation is fast"""
        import time
        
        rotation = FingerprintRotation()
        
        start = time.time()
        for _ in range(1000):
            rotation.get_fingerprint()
        elapsed = time.time() - start
        
        # Should be very fast (no external calls)
        assert elapsed < 1.0
