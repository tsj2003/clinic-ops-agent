#!/usr/bin/env python3
"""
Environment Validation Script
Checks all required environment variables and connections
"""

import os
import sys
import asyncio
import aiohttp
import certifi
from datetime import datetime
from typing import Dict, List, Tuple

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MOTOR_AVAILABLE = True
except ImportError:
    MOTOR_AVAILABLE = False


class EnvironmentValidator:
    """Validates production environment configuration"""
    
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.checks_passed = 0
        self.checks_failed = 0
    
    def check_required_env(self, name: str, min_length: int = 10) -> bool:
        """Check if required environment variable is set"""
        value = os.getenv(name)
        
        if not value:
            self.errors.append(f"❌ {name}: Not set")
            self.checks_failed += 1
            return False
        
        if len(value) < min_length:
            self.warnings.append(f"⚠️  {name}: Value seems too short (<{min_length} chars)")
        
        # Check for placeholder values
        placeholders = ['your-', 'placeholder', 'example', 'test', 'changeme']
        if any(p in value.lower() for p in placeholders):
            self.errors.append(f"❌ {name}: Contains placeholder value")
            self.checks_failed += 1
            return False
        
        self.checks_passed += 1
        return True
    
    def check_optional_env(self, name: str) -> bool:
        """Check optional environment variable"""
        value = os.getenv(name)
        if value:
            self.checks_passed += 1
            return True
        else:
            self.warnings.append(f"⚠️  {name}: Not set (optional)")
            return False
    
    async def check_api_connectivity(self, name: str, url: str, headers: Dict = None) -> bool:
        """Check if external API is reachable"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as resp:
                    if resp.status in [200, 401, 403]:  # 401/403 means API exists
                        self.checks_passed += 1
                        return True
                    else:
                        self.warnings.append(f"⚠️  {name}: Unexpected status {resp.status}")
                        return False
        except Exception as e:
            self.warnings.append(f"⚠️  {name}: Connection failed - {str(e)[:50]}")
            return False
    
    async def validate(self) -> Tuple[bool, List[str], List[str]]:
        """Run all validation checks"""
        print("🔍 Clinic Ops Agent - Environment Validation")
        print("=" * 60)
        print(f"Timestamp: {datetime.utcnow().isoformat()}")
        print(f"Environment: {os.getenv('APP_ENV', 'not set')}")
        print("=" * 60)
        
        # ============================================
        # REQUIRED API KEYS
        # ============================================
        print("\n📦 API Keys (Required)")
        print("-" * 40)
        
        required_apis = [
            ('FIREWORKS_API_KEY', 20),
            ('MONGODB_ATLAS_URI', 30),
            ('WAYSTAR_CREDENTIALS', 20),
            ('JWT_SECRET', 32),
            ('MIXEDBREAD_API_KEY', 20),
            ('TINYFISH_API_KEY', 20),
        ]
        
        for name, min_len in required_apis:
            self.check_required_env(name, min_len)
        
        # ============================================
        # OPTIONAL API KEYS
        # ============================================
        print("\n📦 API Keys (Optional)")
        print("-" * 40)
        
        optional_apis = [
            'OPENAI_API_KEY',
            'AXIOM_API_KEY',
            'AGENTOPS_API_KEY',
        ]
        
        for name in optional_apis:
            self.check_optional_env(name)
        
        # ============================================
        # DATABASE
        # ============================================
        print("\n🗄️  Database Configuration")
        print("-" * 40)
        
        if self.check_required_env('MONGODB_ATLAS_URI', 30):
            mongo_uri = os.getenv('MONGODB_ATLAS_URI', '')
            if 'mongodb' not in mongo_uri:
                self.errors.append("❌ MONGODB_ATLAS_URI: Invalid format")
                self.checks_failed += 1
            elif 'mongodb+srv' not in mongo_uri and os.getenv('ENVIRONMENT') == 'production':
                self.warnings.append("⚠️  MONGODB_ATLAS_URI: Not using Atlas SRV connection in production")
            else:
                self.checks_passed += 1
            
            # Test actual connection with ping
            if MOTOR_AVAILABLE and mongo_uri:
                print("   🔌 Testing MongoDB connection...")
                await self.test_mongodb_connection(mongo_uri)
        
        self.check_required_env('REDIS_URL', 10)
        
        # ============================================
        # SECURITY
        # ============================================
        print("\n🔒 Security Configuration")
        print("-" * 40)
        
        self.check_required_env('API_SECRET_KEY', 32)
        self.check_required_env('FERNET_KEY', 32)
        
        # Check if running in production with debug mode
        app_env = os.getenv('APP_ENV', '').lower()
        debug = os.getenv('DEBUG', '').lower()
        
        if app_env == 'production' and debug == 'true':
            self.errors.append("❌ DEBUG should be 'false' in production")
            self.checks_failed += 1
        else:
            self.checks_passed += 1
        
        # ============================================
        # COMPLIANCE
        # ============================================
        print("\n📋 Compliance Settings")
        print("-" * 40)
        
        hipaa_enabled = os.getenv('HIPAA_BAA_ENABLED', '').lower()
        if hipaa_enabled == 'true':
            self.checks_passed += 1
        else:
            self.warnings.append("⚠️  HIPAA_BAA_ENABLED: Not enabled")
        
        # ============================================
        # SUMMARY
        # ============================================
        print("\n" + "=" * 60)
        print("📊 VALIDATION SUMMARY")
        print("=" * 60)
        print(f"✅ Passed: {self.checks_passed}")
        print(f"⚠️  Warnings: {len(self.warnings)}")
        print(f"❌ Errors: {len(self.errors)}")
        
        if self.warnings:
            print("\n⚠️  WARNINGS:")
            for warning in self.warnings:
                print(f"   {warning}")
        
        if self.errors:
            print("\n❌ ERRORS:")
            for error in self.errors:
                print(f"   {error}")
            print("\n💥 Validation FAILED - Fix errors before deploying")
            return False, self.errors, self.warnings
        
        if self.warnings:
            print("\n✅ Validation PASSED with warnings")
            return True, self.errors, self.warnings
        else:
            print("\n✅ Validation PASSED - Ready for deployment!")
            return True, self.errors, self.warnings
    
    async def test_mongodb_connection(self, uri: str) -> bool:
        """Test MongoDB Atlas connection with 2-second ping"""
        try:
            client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=2000,  # 2 second timeout
                tlsCAFile=certifi.where(),
            )
            # Test connection with ping
            await client.admin.command('ping')
            print("   ✅ MongoDB Atlas: Connection successful (ping)")
            self.checks_passed += 1
            client.close()
            return True
        except Exception as e:
            error_msg = str(e)
            if "SSL" in error_msg or "certificate" in error_msg:
                self.errors.append(f"❌ MongoDB Atlas: SSL/Certificate error - {error_msg[:60]}")
            elif "Authentication" in error_msg:
                self.errors.append(f"❌ MongoDB Atlas: Authentication failed - check username/password")
            else:
                self.warnings.append(f"⚠️  MongoDB Atlas: Connection test failed - {error_msg[:50]}")
            self.checks_failed += 1
            return False


async def async_main():
    """Async main entry point"""
    validator = EnvironmentValidator()
    passed, errors, warnings = await validator.validate()
    sys.exit(0 if passed else 1)

def main():
    """Main entry point"""
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
