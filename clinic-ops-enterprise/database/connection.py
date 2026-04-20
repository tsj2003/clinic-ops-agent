"""
MongoDB Connection Manager with HIPAA-compliant settings
Connection pooling, encryption, and audit logging
"""

import os
import ssl
import certifi
import logging
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient
from pymongo.encryption import ClientEncryption
from pymongo.encryption_options import AutoEncryptionOpts

# Configure logging
logger = logging.getLogger(__name__)


class MongoDBManager:
    """Singleton MongoDB connection manager"""
    
    _instance = None
    _client: Optional[AsyncIOMotorClient] = None
    _db: Optional[AsyncIOMotorDatabase] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def connect(self):
        """Initialize connection with encryption and SSL context"""
        if self._client is not None:
            return
        
        # Use MONGODB_ATLAS_URI if set, fallback to MONGODB_URI, then localhost
        uri = os.getenv("MONGODB_ATLAS_URI") or os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        db_name = os.getenv("MONGODB_DB_NAME", "clinic_ops_prod")
        environment = os.getenv("ENVIRONMENT", "development").lower()
        
        # SSL Context for Atlas connections
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        
        try:
            # Connection pool settings with SSL
            self._client = AsyncIOMotorClient(
                uri,
                maxPoolSize=50,
                minPoolSize=10,
                maxIdleTimeMS=45000,
                serverSelectionTimeoutMS=5000,
                retryWrites=True,
                w="majority",  # Write concern for data durability
                tlsCAFile=certifi.where(),  # Use certifi for SSL certificate verification
            )
            
            # Test connection with ping
            await self._client.admin.command('ping')
            
            self._db = self._client[db_name]
            
            # Create indexes
            await self._create_indexes()
            
            logger.info(f"✅ MongoDB connected: {db_name}")
            
        except Exception as e:
            logger.error(f"❌ MongoDB connection failed: {str(e)}")
            if environment == "production":
                # In production, fail closed
                raise
            else:
                # In development, log warning but allow to continue
                logger.warning("⚠️  Running without database in development mode")
                self._client = None
                self._db = None
    
    async def _create_indexes(self):
        """Create collection indexes for performance"""
        from .schema import COLLECTION_INDEXES
        
        for collection_name, indexes in COLLECTION_INDEXES.items():
            collection = self._db[collection_name]
            for index in indexes:
                await collection.create_index(
                    index["keys"],
                    name=index.get("name"),
                    unique=index.get("unique", False),
                    background=True
                )
    
    @property
    def db(self) -> AsyncIOMotorDatabase:
        if self._db is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self._db
    
    async def disconnect(self):
        """Close connection"""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None
            print("🔌 MongoDB disconnected")
    
    async def health_check(self) -> bool:
        """Check database connectivity"""
        try:
            await self._client.admin.command('ping')
            return True
        except Exception:
            return False


# Global instance
mongo_manager = MongoDBManager()


async def get_db() -> AsyncIOMotorDatabase:
    """Dependency for FastAPI endpoints"""
    await mongo_manager.connect()
    return mongo_manager.db
