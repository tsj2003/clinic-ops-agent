"""
Advanced Anti-Bot and Stealth Infrastructure
Dynamic resiliency against CAPTCHAs, UI changes, and bot detection
"""

import os
import random
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass
from enum import Enum
import asyncio
import hashlib


class DetectionLevel(str, Enum):
    """Bot detection level from payer portals"""
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class UIChangeType(str, Enum):
    """Types of UI changes detected"""
    SELECTOR_CHANGED = "selector_changed"
    FORM_REORDERED = "form_reordered"
    NEW_FIELD = "new_field"
    REMOVED_FIELD = "removed_field"
    CAPTCHA_ADDED = "captcha_added"
    RATE_LIMITING = "rate_limiting"


@dataclass
class StealthSession:
    """Stealth session configuration"""
    session_id: str
    proxy: str
    user_agent: str
    viewport: Dict[str, int]
    timezone: str
    locale: str
    geolocation: Dict[str, float]
    fingerprint_hash: str
    created_at: datetime
    requests_count: int = 0
    detection_score: float = 0.0


@dataclass
class UIElement:
    """Tracked UI element"""
    element_id: str
    selector: str
    element_type: str
    last_seen: datetime
    hash_signature: str
    confidence: float


class StealthFingerprintGenerator:
    """
    Generates realistic browser fingerprints to avoid detection
    """
    
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
    ]
    
    VIEWPORTS = [
        {"width": 1920, "height": 1080},
        {"width": 1366, "height": 768},
        {"width": 1440, "height": 900},
        {"width": 1536, "height": 864},
        {"width": 1280, "height": 720},
    ]
    
    TIMEZONES = [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Phoenix",
    ]
    
    LOCALES = [
        "en-US",
        "en-GB",
        "en-CA",
    ]
    
    def __init__(self):
        self._used_fingerprints: set = set()
    
    def generate_fingerprint(self) -> StealthSession:
        """Generate unique stealth session"""
        # Ensure uniqueness
        max_attempts = 10
        for _ in range(max_attempts):
            session = self._create_session()
            if session.fingerprint_hash not in self._used_fingerprints:
                self._used_fingerprints.add(session.fingerprint_hash)
                return session
        
        return self._create_session()
    
    def _create_session(self) -> StealthSession:
        """Create single session config"""
        user_agent = random.choice(self.USER_AGENTS)
        viewport = random.choice(self.VIEWPORTS)
        timezone = random.choice(self.TIMEZONES)
        locale = random.choice(self.LOCALES)
        
        # Random geolocation (US-based healthcare)
        geolocation = {
            "latitude": random.uniform(25.0, 49.0),
            "longitude": random.uniform(-125.0, -66.0),
            "accuracy": random.uniform(10, 100)
        }
        
        # Generate proxy
        proxy = self._get_residential_proxy()
        
        # Create fingerprint hash
        fingerprint_data = f"{user_agent}:{viewport}:{timezone}:{proxy}"
        fingerprint_hash = hashlib.sha256(fingerprint_data.encode()).hexdigest()[:16]
        
        return StealthSession(
            session_id=f"stealth_{fingerprint_hash}",
            proxy=proxy,
            user_agent=user_agent,
            viewport=viewport,
            timezone=timezone,
            locale=locale,
            geolocation=geolocation,
            fingerprint_hash=fingerprint_hash,
            created_at=datetime.utcnow(),
            requests_count=0,
            detection_score=0.0
        )
    
    def _get_residential_proxy(self) -> str:
        """Get rotating residential proxy"""
        # In production, integrate with proxy service like BrightData or Oxylabs
        proxy_pool = os.getenv("RESIDENTIAL_PROXY_POOL", "").split(",")
        if proxy_pool and proxy_pool[0]:
            return random.choice(proxy_pool)
        return ""


class AntiCaptchaSolver:
    """
    CAPTCHA solving integration
    """
    
    def __init__(self):
        self.two_captcha_key = os.getenv("2CAPTCHA_API_KEY")
        self.anti_captcha_key = os.getenv("ANTICAPTCHA_API_KEY")
    
    async def solve_recaptcha_v2(
        self,
        site_key: str,
        page_url: str,
        timeout: int = 120
    ) -> Optional[str]:
        """
        Solve reCAPTCHA v2 using 2Captcha service
        """
        if not self.two_captcha_key:
            return None
        
        import aiohttp
        
        # Submit CAPTCHA for solving
        submit_url = "http://2captcha.com/in.php"
        submit_data = {
            "key": self.two_captcha_key,
            "method": "userrecaptcha",
            "googlekey": site_key,
            "pageurl": page_url,
            "json": 1
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                # Submit
                async with session.post(submit_url, data=submit_data) as resp:
                    result = await resp.json()
                    if result.get("status") != 1:
                        return None
                    
                    captcha_id = result.get("request")
                
                # Wait for solution
                result_url = f"http://2captcha.com/res.php?key={self.two_captcha_key}&action=get&id={captcha_id}&json=1"
                
                for _ in range(timeout // 5):
                    await asyncio.sleep(5)
                    
                    async with session.get(result_url) as resp:
                        result = await resp.json()
                        if result.get("status") == 1:
                            return result.get("request")
                        
                        if result.get("request") == "CAPCHA_NOT_READY":
                            continue
                        else:
                            return None
                            
        except Exception as e:
            print(f"⚠️ CAPTCHA solving failed: {e}")
        
        return None
    
    async def solve_image_captcha(
        self,
        image_base64: str,
        timeout: int = 60
    ) -> Optional[str]:
        """
        Solve image/text CAPTCHA
        """
        if not self.two_captcha_key:
            return None
        
        import aiohttp
        
        submit_url = "http://2captcha.com/in.php"
        submit_data = {
            "key": self.two_captcha_key,
            "method": "base64",
            "body": image_base64,
            "json": 1
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(submit_url, data=submit_data) as resp:
                    result = await resp.json()
                    if result.get("status") != 1:
                        return None
                    
                    captcha_id = result.get("request")
                
                # Wait for solution
                result_url = f"http://2captcha.com/res.php?key={self.two_captcha_key}&action=get&id={captcha_id}&json=1"
                
                for _ in range(timeout // 3):
                    await asyncio.sleep(3)
                    
                    async with session.get(result_url) as resp:
                        result = await resp.json()
                        if result.get("status") == 1:
                            return result.get("request")
                        
                        if result.get("request") == "CAPCHA_NOT_READY":
                            continue
        except Exception as e:
            print(f"⚠️ Image CAPTCHA solving failed: {e}")
        
        return None


class UIDetectionEngine:
    """
    Detects and adapts to UI changes in payer portals
    """
    
    def __init__(self):
        self.element_registry: Dict[str, UIElement] = {}
        self.change_history: List[Dict] = []
        self.adaptation_rules: Dict[str, Callable] = {}
    
    def register_element(
        self,
        element_id: str,
        selector: str,
        element_type: str,
        sample_html: str
    ):
        """Register known UI element"""
        element = UIElement(
            element_id=element_id,
            selector=selector,
            element_type=element_type,
            last_seen=datetime.utcnow(),
            hash_signature=hashlib.sha256(sample_html.encode()).hexdigest()[:16],
            confidence=1.0
        )
        self.element_registry[element_id] = element
    
    async def detect_ui_changes(
        self,
        page_content: str,
        current_selectors: Dict[str, str]
    ) -> List[UIChangeType]:
        """
        Detect changes in UI compared to known state
        """
        changes = []
        
        for element_id, element in self.element_registry.items():
            current_selector = current_selectors.get(element_id)
            
            if not current_selector:
                changes.append(UIChangeType.REMOVED_FIELD)
                continue
            
            if current_selector != element.selector:
                # Selector changed
                changes.append(UIChangeType.SELECTOR_CHANGED)
                self._adapt_selector(element_id, current_selector)
        
        # Check for new elements
        for element_id in current_selectors:
            if element_id not in self.element_registry:
                changes.append(UIChangeType.NEW_FIELD)
        
        # Check for CAPTCHA indicators
        if self._detect_captcha(page_content):
            changes.append(UIChangeType.CAPTCHA_ADDED)
        
        # Check for rate limiting
        if self._detect_rate_limiting(page_content):
            changes.append(UIChangeType.RATE_LIMITING)
        
        return changes
    
    def _detect_captcha(self, page_content: str) -> bool:
        """Detect CAPTCHA presence in page"""
        captcha_indicators = [
            "g-recaptcha",
            "data-sitekey",
            "captcha",
            "recaptcha",
            "hcaptcha",
            "security check",
            "verify you are human"
        ]
        
        content_lower = page_content.lower()
        return any(indicator in content_lower for indicator in captcha_indicators)
    
    def _detect_rate_limiting(self, page_content: str) -> bool:
        """Detect rate limiting indicators"""
        rate_limit_indicators = [
            "too many requests",
            "rate limit exceeded",
            "please wait",
            "try again later",
            "unusual traffic"
        ]
        
        content_lower = page_content.lower()
        return any(indicator in content_lower for indicator in rate_limit_indicators)
    
    def _adapt_selector(self, element_id: str, new_selector: str):
        """Update selector for changed element"""
        if element_id in self.element_registry:
            element = self.element_registry[element_id]
            element.selector = new_selector
            element.last_seen = datetime.utcnow()
            element.confidence = 0.9
    
    def get_adaptive_selector(self, element_id: str) -> Optional[str]:
        """Get current selector with fallback strategies"""
        element = self.element_registry.get(element_id)
        if not element:
            return None
        
        # Return primary selector if confidence is high
        if element.confidence > 0.5:
            return element.selector
        
        # Generate fallback selectors
        fallbacks = self._generate_fallbacks(element)
        return fallbacks[0] if fallbacks else element.selector
    
    def _generate_fallbacks(self, element: UIElement) -> List[str]:
        """Generate fallback selector strategies"""
        fallbacks = []
        
        # Try different selector strategies
        if element.element_type == "input":
            fallbacks.extend([
                f"input[name*='{element.element_id}']",
                f"input[id*='{element.element_id}']",
                f"input[placeholder*='{element.element_id}']",
                f"//input[contains(@name, '{element.element_id}')]",
            ])
        elif element.element_type == "button":
            fallbacks.extend([
                f"button:has-text('{element.element_id}')",
                f"button[type='submit']",
                f"input[type='submit']",
            ])
        
        return fallbacks


class StealthOrchestrator:
    """
    Main orchestrator for anti-bot and stealth operations
    """
    
    def __init__(self):
        self.fingerprint_gen = StealthFingerprintGenerator()
        self.captcha_solver = AntiCaptchaSolver()
        self.ui_detector = UIDetectionEngine()
        self.active_sessions: Dict[str, StealthSession] = {}
        self.rate_limiter = RateLimitManager()
    
    async def create_stealth_session(
        self,
        payer_id: str,
        purpose: str
    ) -> StealthSession:
        """
        Create new stealth session for payer portal
        """
        # Generate fingerprint
        session = self.fingerprint_gen.generate_fingerprint()
        
        # Apply payer-specific configurations
        session = self._apply_payer_config(session, payer_id)
        
        # Register session
        self.active_sessions[session.session_id] = session
        
        return session
    
    def _apply_payer_config(
        self,
        session: StealthSession,
        payer_id: str
    ) -> StealthSession:
        """Apply payer-specific stealth configurations"""
        # Payer-specific timezone preferences
        payer_timezones = {
            "aetna": "America/New_York",
            "uhc": "America/Chicago",
            "cigna": "America/New_York",
        }
        
        if payer_id in payer_timezones:
            session.timezone = payer_timezones[payer_id]
        
        return session
    
    async def handle_detection_event(
        self,
        session_id: str,
        detection_type: str,
        page_content: str
    ) -> Dict[str, Any]:
        """
        Handle bot detection event
        """
        session = self.active_sessions.get(session_id)
        if not session:
            return {"action": "error", "message": "Session not found"}
        
        # Increase detection score
        session.detection_score += 0.3
        
        # Determine response strategy
        if detection_type == "captcha":
            return await self._handle_captcha(session, page_content)
        elif detection_type == "rate_limit":
            return await self._handle_rate_limit(session)
        elif detection_type == "ui_change":
            return await self._handle_ui_change(session, page_content)
        else:
            return {"action": "rotate_session"}
    
    async def _handle_captcha(
        self,
        session: StealthSession,
        page_content: str
    ) -> Dict[str, Any]:
        """Handle CAPTCHA detection"""
        # Extract site key if present
        import re
        site_key_match = re.search(r'data-sitekey="([^"]+)"', page_content)
        
        if site_key_match:
            site_key = site_key_match.group(1)
            solution = await self.captcha_solver.solve_recaptcha_v2(
                site_key=site_key,
                page_url="https://provider.portal.com"  # Generic
            )
            
            if solution:
                return {
                    "action": "solve_captcha",
                    "solution": solution,
                    "strategy": "2captcha"
                }
        
        return {"action": "rotate_session", "reason": "captcha_unsolvable"}
    
    async def _handle_rate_limit(self, session: StealthSession) -> Dict[str, Any]:
        """Handle rate limiting"""
        # Calculate backoff
        backoff = self.rate_limiter.calculate_backoff(session.session_id)
        
        return {
            "action": "backoff",
            "wait_seconds": backoff,
            "strategy": "exponential_backoff"
        }
    
    async def _handle_ui_change(
        self,
        session: StealthSession,
        page_content: str
    ) -> Dict[str, Any]:
        """Handle UI changes"""
        changes = await self.ui_detector.detect_ui_changes(page_content, {})
        
        return {
            "action": "adapt",
            "changes_detected": [c.value for c in changes],
            "selectors": self._get_updated_selectors()
        }
    
    def _get_updated_selectors(self) -> Dict[str, str]:
        """Get current selectors for all elements"""
        return {
            eid: self.ui_detector.get_adaptive_selector(eid)
            for eid in self.ui_detector.element_registry
        }
    
    def should_rotate_session(self, session_id: str) -> bool:
        """Determine if session should be rotated"""
        session = self.active_sessions.get(session_id)
        if not session:
            return True
        
        # Rotate if:
        # - Detection score too high
        # - Too many requests
        # - Session too old
        if session.detection_score > 0.7:
            return True
        if session.requests_count > 50:
            return True
        if datetime.utcnow() - session.created_at > timedelta(hours=1):
            return True
        
        return False


class RateLimitManager:
    """
    Intelligent rate limiting to avoid detection
    """
    
    def __init__(self):
        self.request_history: Dict[str, List[datetime]] = {}
        self.backoff_delays: Dict[str, int] = {}
    
    def record_request(self, session_id: str):
        """Record request timestamp"""
        if session_id not in self.request_history:
            self.request_history[session_id] = []
        
        self.request_history[session_id].append(datetime.utcnow())
        
        # Clean old history
        cutoff = datetime.utcnow() - timedelta(minutes=5)
        self.request_history[session_id] = [
            t for t in self.request_history[session_id] if t > cutoff
        ]
    
    def calculate_backoff(self, session_id: str) -> int:
        """Calculate backoff delay based on request frequency"""
        history = self.request_history.get(session_id, [])
        
        if len(history) < 5:
            return 0
        
        # Calculate request rate
        recent = [t for t in history if t > datetime.utcnow() - timedelta(minutes=1)]
        
        if len(recent) > 10:
            # Too many requests, increase backoff
            current_backoff = self.backoff_delays.get(session_id, 1)
            new_backoff = min(current_backoff * 2, 300)  # Max 5 min
            self.backoff_delays[session_id] = new_backoff
            return new_backoff
        
        # Reset backoff
        self.backoff_delays[session_id] = 1
        
        # Add some randomization
        return random.randint(1, 3)
    
    async def apply_random_delays(self, session_id: str):
        """Apply human-like random delays between actions"""
        # Base delay
        base_delay = random.uniform(0.5, 2.0)
        
        # Add typing-like delays for form interactions
        typing_delay = random.uniform(0.1, 0.3)
        
        # Add reading-like delays for page loads
        reading_delay = random.uniform(1.0, 3.0)
        
        total_delay = base_delay + typing_delay + reading_delay
        
        await asyncio.sleep(total_delay)


# Global instance
stealth_orchestrator = StealthOrchestrator()
