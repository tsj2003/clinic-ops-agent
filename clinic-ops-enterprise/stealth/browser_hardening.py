"""
Advanced Browser Hardening & Stealth Infrastructure
Serverless containerized sessions with signal patching
"""

import os
import json
import random
import asyncio
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from datetime import datetime
import hashlib
import aiohttp


@dataclass
class BrowserFingerprint:
    """Complete browser fingerprint for stealth"""
    user_agent: str
    viewport: Dict[str, int]
    timezone: str
    language: str
    color_depth: int
    pixel_ratio: float
    cpu_cores: int
    memory: int
    platform: str
    webgl_vendor: str
    webgl_renderer: str
    fonts: List[str]
    plugins: List[Dict]
    canvas_hash: str
    webgl_hash: str
    audio_hash: str
    tls_ja3_fingerprint: str
    http2_fingerprint: str


class BrowserHardeningEngine:
    """
    Advanced browser hardening for payer portal navigation
    Patches detectable signals to avoid bot detection
    """
    
    def __init__(self):
        self.fingerprint_rotation = FingerprintRotation()
        self.tls_patcher = TLSPatcher()
        self.webgl_masker = WebGLMasker()
        self.audio_masker = AudioMasker()
        self.canvas_masker = CanvasMasker()
    
    def generate_hardened_profile(
        self,
        payer_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate a complete hardened browser profile
        """
        # Get base fingerprint
        fingerprint = self.fingerprint_rotation.get_fingerprint(payer_id)
        
        # Apply hardening patches
        profile = {
            "fingerprint": {
                "user_agent": fingerprint.user_agent,
                "viewport": fingerprint.viewport,
                "timezone": fingerprint.timezone,
                "language": fingerprint.language,
                "color_depth": fingerprint.color_depth,
                "pixel_ratio": fingerprint.pixel_ratio,
                "hardware": {
                    "cpu_cores": fingerprint.cpu_cores,
                    "memory": fingerprint.memory
                }
            },
            "webgl": {
                "vendor": fingerprint.webgl_vendor,
                "renderer": fingerprint.webgl_renderer,
                "unmasked_vendor": fingerprint.webgl_vendor,
                "unmasked_renderer": fingerprint.webgl_renderer
            },
            "fonts": fingerprint.fonts,
            "plugins": fingerprint.plugins,
            "tls": {
                "ja3_fingerprint": fingerprint.tls_ja3_fingerprint,
                "http2_fingerprint": fingerprint.http2_fingerprint
            },
            "evasion_scripts": self._generate_evasion_scripts(fingerprint),
            "timing_profile": self._generate_timing_profile(),
            "session_isolation": {
                "storage_partition": True,
                "cookie_isolation": True,
                "cache_isolation": True,
                "proxy_rotation": True
            }
        }
        
        return profile
    
    def _generate_evasion_scripts(self, fingerprint: BrowserFingerprint) -> List[str]:
        """Generate JavaScript evasion scripts"""
        scripts = []
        
        # WebGL vendor/renderer spoofing
        webgl_script = f"""
        Object.defineProperty(WebGLRenderingContext.prototype, 'getParameter', {{
            value: function(parameter) {{
                if (parameter === 0x9245) return '{fingerprint.webgl_vendor}';
                if (parameter === 0x9246) return '{fingerprint.webgl_renderer}';
                if (parameter === 0x1F00) return '{fingerprint.webgl_vendor}';
                if (parameter === 0x1F01) return '{fingerprint.webgl_renderer}';
                return getParameter(parameter);
            }}
        }});
        """
        scripts.append(webgl_script)
        
        # Canvas fingerprint randomization
        canvas_script = """
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...args) {
            const noise = Math.random() * 0.001;
            const ctx = this.getContext('2d');
            if (ctx) {
                ctx.fillStyle = `rgba(0,0,0,${noise})`;
                ctx.fillRect(0, 0, 1, 1);
            }
            return originalToDataURL.apply(this, args);
        };
        """
        scripts.append(canvas_script)
        
        # Audio context randomization
        audio_script = """
        const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
        AudioContext.prototype.createAnalyser = function() {
            const analyser = originalCreateAnalyser.call(this);
            const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
            analyser.getFloatFrequencyData = function(array) {
                originalGetFloatFrequencyData.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] += (Math.random() - 0.5) * 0.001;
                }
            };
            return analyser;
        };
        """
        scripts.append(audio_script)
        
        # Plugin enumeration masking
        plugins_script = f"""
        Object.defineProperty(navigator, 'plugins', {{
            get: () => {json.dumps(fingerprint.plugins)}
        }});
        """
        scripts.append(plugins_script)
        
        return scripts
    
    def _generate_timing_profile(self) -> Dict[str, Any]:
        """Generate realistic timing variations"""
        return {
            "mouse_movement_delay_ms": {
                "min": 50,
                "max": 200,
                "variance": "gaussian"
            },
            "keystroke_interval_ms": {
                "min": 80,
                "max": 300,
                "variance": "human_typing"
            },
            "page_load_wait_ms": {
                "min": 1000,
                "max": 5000,
                "variance": "uniform"
            },
            "click_delay_ms": {
                "min": 100,
                "max": 500,
                "variance": "gaussian"
            }
        }


class FingerprintRotation:
    """
    Rotates browser fingerprints to avoid detection
    """
    
    def __init__(self):
        self.fingerprints: List[BrowserFingerprint] = []
        self.current_index = 0
        self._generate_fingerprint_pool()
    
    def _generate_fingerprint_pool(self):
        """Generate pool of realistic fingerprints"""
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
        ]
        
        viewports = [
            {"width": 1920, "height": 1080},
            {"width": 1366, "height": 768},
            {"width": 1440, "height": 900},
            {"width": 1536, "height": 864},
            {"width": 1280, "height": 720}
        ]
        
        timezones = [
            "America/New_York",
            "America/Chicago",
            "America/Los_Angeles",
            "America/Denver",
            "America/Phoenix"
        ]
        
        webgl_vendors = [
            ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            ("Apple Inc.", "Apple GPU"),
            ("Intel Inc.", "Intel(R) UHD Graphics 620"),
            ("Google Inc. (AMD)", "ANGLE (AMD, Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            ("NVIDIA Corporation", "NVIDIA GeForce RTX 3070")
        ]
        
        common_fonts = [
            "Arial", "Arial Black", "Arial Narrow", "Calibri", "Cambria",
            "Comic Sans MS", "Courier New", "Georgia", "Helvetica", "Impact",
            "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"
        ]
        
        # Generate 10 fingerprints
        for i in range(10):
            vendor, renderer = random.choice(webgl_vendors)
            
            fp = BrowserFingerprint(
                user_agent=user_agents[i % len(user_agents)],
                viewport=viewports[i % len(viewports)],
                timezone=timezones[i % len(timezones)],
                language="en-US",
                color_depth=24,
                pixel_ratio=1.0,
                cpu_cores=random.choice([4, 8, 12, 16]),
                memory=random.choice([4, 8, 16, 32]),
                platform="Win32" if "Windows" in user_agents[i % len(user_agents)] else "MacIntel",
                webgl_vendor=vendor,
                webgl_renderer=renderer,
                fonts=random.sample(common_fonts, k=random.randint(8, 15)),
                plugins=[
                    {"name": "Chrome PDF Plugin", "filename": "internal-pdf-viewer", "description": "Portable Document Format"},
                    {"name": "Native Client", "filename": "internal-nacl-plugin", "description": "Native Client module"}
                ],
                canvas_hash=self._generate_random_hash(),
                webgl_hash=self._generate_random_hash(),
                audio_hash=self._generate_random_hash(),
                tls_ja3_fingerprint=self._generate_ja3_fingerprint(),
                http2_fingerprint=self._generate_http2_fingerprint()
            )
            
            self.fingerprints.append(fp)
    
    def _generate_random_hash(self) -> str:
        """Generate random hash for fingerprint"""
        return hashlib.sha256(os.urandom(32)).hexdigest()[:16]
    
    def _generate_ja3_fingerprint(self) -> str:
        """Generate realistic JA3 TLS fingerprint"""
        # Common Chrome JA3 fingerprints
        ja3_sigs = [
            "769,47-53-5-10-61-49161-49162-49171-49172-50-56-19-4-49170-49169-99-102-107-49159-49160-49157-49158-22-51-57-21-136-158-162-163-49155-49156-49167-49168-49163-49164-52393-52392-52394-88-87-106-49231-49230-49229-49228-49227-49226-156-157-160-161-60-86-48972-48973-255,0-11-10-35-13-16-5-34-18-51-65281-45-43-21-30-27-11-17413-29526-65037-23-65000,29-23-25-24,0",
            "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53-10,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-21-41,29-23-24-25,0"
        ]
        return random.choice(ja3_sigs)
    
    def _generate_http2_fingerprint(self) -> str:
        """Generate HTTP/2 fingerprint"""
        return "1:65536,2:0,3:1000,4:6291456,6:262144|15663105|0|m,a,s,p"
    
    def get_fingerprint(self, payer_id: Optional[str] = None) -> BrowserFingerprint:
        """Get next fingerprint from rotation"""
        # Payer-specific rotation
        if payer_id:
            # Use payer to deterministically select fingerprint
            index = hash(payer_id) % len(self.fingerprints)
            return self.fingerprints[index]
        
        # Standard rotation
        fp = self.fingerprints[self.current_index]
        self.current_index = (self.current_index + 1) % len(self.fingerprints)
        return fp
    
    def rotate_fingerprint(self, current_fp: BrowserFingerprint) -> BrowserFingerprint:
        """Get new fingerprint different from current"""
        available = [fp for fp in self.fingerprints if fp.user_agent != current_fp.user_agent]
        if available:
            return random.choice(available)
        return self.get_fingerprint()


class TLSPatcher:
    """
    Patches TLS signatures to avoid fingerprinting
    """
    
    def __init__(self):
        self.tls_configs = self._load_tls_configs()
    
    def _load_tls_configs(self) -> List[Dict]:
        """Load realistic TLS configurations"""
        return [
            {
                "cipher_suites": [
                    "TLS_AES_256_GCM_SHA384",
                    "TLS_CHACHA20_POLY1305_SHA256",
                    "TLS_AES_128_GCM_SHA256",
                    "ECDHE-ECDSA-AES256-GCM-SHA384",
                    "ECDHE-RSA-AES256-GCM-SHA384"
                ],
                "extensions": [
                    "server_name",
                    "extended_master_secret",
                    "renegotiation_info",
                    "supported_groups",
                    "ec_point_formats",
                    "signature_algorithms",
                    "status_request"
                ],
                "tls_version": "TLSv1.3"
            },
            {
                "cipher_suites": [
                    "TLS_AES_128_GCM_SHA256",
                    "TLS_AES_256_GCM_SHA384",
                    "TLS_CHACHA20_POLY1305_SHA256"
                ],
                "extensions": [
                    "server_name",
                    "encrypt_then_mac",
                    "extended_master_secret",
                    "supported_versions"
                ],
                "tls_version": "TLSv1.3"
            }
        ]
    
    def get_tls_config(self) -> Dict:
        """Get random TLS configuration"""
        return random.choice(self.tls_configs)


class WebGLMasker:
    """Masks WebGL signatures"""
    
    def mask_webgl_context(self, context_type: str = "2d") -> Dict[str, Any]:
        """Generate WebGL masking parameters"""
        return {
            "vendor_randomization": True,
            "renderer_randomization": True,
            "parameter_spoofing": {
                "UNMASKED_VENDOR_WEBGL": "random",
                "UNMASKED_RENDERER_WEBGL": "random"
            },
            "noise_injection": {
                "enabled": True,
                "amplitude": 0.001
            }
        }


class AudioMasker:
    """Masks AudioContext signatures"""
    
    def mask_audio_context(self) -> Dict[str, Any]:
        """Generate audio masking parameters"""
        return {
            "sample_rate_randomization": True,
            "channel_data_noise": {
                "enabled": True,
                "amplitude": 0.0001
            },
            "analyser_node_modification": True,
            "oscillator_variation": True
        }


class CanvasMasker:
    """Masks Canvas fingerprinting"""
    
    def mask_canvas(self) -> Dict[str, Any]:
        """Generate canvas masking parameters"""
        return {
            "pixel_noise": {
                "enabled": True,
                "amplitude": 0.001,
                "frequency": "per_pixel"
            },
            "image_data_modification": True,
            "path_perturbation": {
                "enabled": True,
                "amplitude": 0.01
            }
        }


class ServerlessSessionManager:
    """
    Manages serverless browser sessions
    Ensures isolation and prevents cross-contamination
    """
    
    def __init__(self):
        self.active_sessions: Dict[str, Dict] = {}
        self.session_pool: List[str] = []
        self.hardening_engine = BrowserHardeningEngine()
    
    async def create_isolated_session(
        self,
        payer_id: str,
        patient_id: str,
        session_timeout_seconds: int = 300
    ) -> str:
        """
        Create new isolated browser session
        """
        session_id = f"sess-{payer_id}-{patient_id[:8]}-{datetime.utcnow().strftime('%H%M%S')}"
        
        # Generate hardened profile
        hardened_profile = self.hardening_engine.generate_hardened_profile(payer_id)
        
        # Create isolated session configuration
        session_config = {
            "session_id": session_id,
            "payer_id": payer_id,
            "patient_id": patient_id,
            "created_at": datetime.utcnow(),
            "expires_at": datetime.utcnow().timestamp() + session_timeout_seconds,
            "hardened_profile": hardened_profile,
            "isolation": {
                "storage_partition": hashlib.sha256(session_id.encode()).hexdigest()[:16],
                "cookie_jar": f"/tmp/cookies/{session_id}.jar",
                "cache_dir": f"/tmp/cache/{session_id}/",
                "proxy_endpoint": self._get_proxy_endpoint(payer_id)
            },
            "security": {
                "fingerprint_rotation_interval": 60,  # seconds
                "last_rotation": datetime.utcnow(),
                "detection_score_threshold": 0.7,
                "current_detection_score": 0.0
            }
        }
        
        self.active_sessions[session_id] = session_config
        
        return session_id
    
    def _get_proxy_endpoint(self, payer_id: str) -> str:
        """Get residential proxy endpoint for payer"""
        # In production, rotate through proxy pool
        proxy_endpoints = [
            "http://residential-1.proxy.provider.com:8080",
            "http://residential-2.proxy.provider.com:8080",
            "http://residential-3.proxy.provider.com:8080"
        ]
        
        # Deterministic selection based on payer
        index = hash(payer_id) % len(proxy_endpoints)
        return proxy_endpoints[index]
    
    async def rotate_session_fingerprint(self, session_id: str) -> bool:
        """Rotate fingerprint for existing session"""
        if session_id not in self.active_sessions:
            return False
        
        session = self.active_sessions[session_id]
        current_profile = session["hardened_profile"]
        
        # Generate new profile
        new_profile = self.hardening_engine.generate_hardened_profile(
            session["payer_id"]
        )
        
        session["hardened_profile"] = new_profile
        session["security"]["last_rotation"] = datetime.utcnow()
        
        return True
    
    async def detect_and_mitigate_blocking(
        self,
        session_id: str,
        detection_signals: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Detect bot blocking and take mitigation action
        """
        if session_id not in self.active_sessions:
            return {"action": "session_not_found"}
        
        session = self.active_sessions[session_id]
        
        # Calculate detection score
        detection_score = self._calculate_detection_score(detection_signals)
        session["security"]["current_detection_score"] = detection_score
        
        actions = []
        
        # Mitigation strategies based on score
        if detection_score > 0.9:
            # Critical - rotate session entirely
            actions.append("critical_rotation")
            await self.rotate_session_fingerprint(session_id)
            # Additional: rotate proxy
            session["isolation"]["proxy_endpoint"] = self._get_proxy_endpoint(
                f"{session['payer_id']}-{datetime.utcnow().timestamp()}"
            )
            
        elif detection_score > 0.7:
            # High - rotate fingerprint
            actions.append("fingerprint_rotation")
            await self.rotate_session_fingerprint(session_id)
            
        elif detection_score > 0.5:
            # Medium - add timing delays
            actions.append("timing_variation")
            session["hardened_profile"]["timing_profile"]["mouse_movement_delay_ms"]["min"] = 100
            session["hardened_profile"]["timing_profile"]["mouse_movement_delay_ms"]["max"] = 400
        
        return {
            "detection_score": detection_score,
            "actions_taken": actions,
            "session_status": "active" if detection_score < 0.95 else "flagged"
        }
    
    def _calculate_detection_score(self, signals: Dict[str, Any]) -> float:
        """Calculate overall bot detection score from signals"""
        score = 0.0
        
        # Check for CAPTCHA
        if signals.get("captcha_detected", False):
            score += 0.4
        
        # Check for rate limiting
        if signals.get("rate_limited", False):
            score += 0.3
        
        # Check for unusual page load times
        load_time = signals.get("page_load_time_ms", 0)
        if load_time > 10000:  # > 10 seconds
            score += 0.1
        
        # Check for blocked selectors
        if signals.get("selectors_blocked", []):
            score += 0.2
        
        # Check for authentication challenges
        if signals.get("auth_challenge", False):
            score += 0.3
        
        return min(1.0, score)
    
    async def terminate_session(self, session_id: str):
        """Clean up and terminate session"""
        if session_id in self.active_sessions:
            session = self.active_sessions[session_id]
            
            # Clean up temporary files
            # In production: remove cookie jars, cache, etc.
            
            del self.active_sessions[session_id]
    
    def get_session_metrics(self) -> Dict[str, Any]:
        """Get metrics on active sessions"""
        total = len(self.active_sessions)
        
        detection_scores = [
            s["security"]["current_detection_score"]
            for s in self.active_sessions.values()
        ]
        
        avg_detection = sum(detection_scores) / len(detection_scores) if detection_scores else 0
        
        return {
            "active_sessions": total,
            "average_detection_score": avg_detection,
            "high_risk_sessions": sum(1 for s in detection_scores if s > 0.7),
            "sessions_rotated_1h": sum(
                1 for s in self.active_sessions.values()
                if (datetime.utcnow() - s["security"]["last_rotation"]).seconds < 3600
            )
        }


# Global instances
browser_hardening_engine = BrowserHardeningEngine()
fingerprint_rotation = FingerprintRotation()
serverless_session_manager = ServerlessSessionManager()
