"""
Application settings and environment configuration
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment"""
    
    # App
    APP_NAME: str = "Clinic Ops Agent Enterprise"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = Field(default="development", env="ENVIRONMENT")
    DEBUG: bool = Field(default=False, env="DEBUG")
    
    # MongoDB
    MONGODB_URI: str = Field(default="mongodb://localhost:27017", env="MONGODB_URI")
    MONGODB_ATLAS_URI: str = Field(default="", env="MONGODB_ATLAS_URI")
    MONGODB_DB_NAME: str = Field(default="clinic_ops_enterprise", env="MONGODB_DB_NAME")
    
    # TinyFish
    TINYFISH_API_KEY: str = Field(default="", env="TINYFISH_API_KEY")
    TINYFISH_API_BASE_URL: str = Field(default="https://agent.tinyfish.ai", env="TINYFISH_API_BASE_URL")
    TINYFISH_MODE: str = Field(default="live", env="TINYFISH_MODE")
    
    # Fireworks.ai
    FIREWORKS_API_KEY: str = Field(default="", env="FIREWORKS_API_KEY")
    
    # Mixedbread
    MIXEDBREAD_API_KEY: str = Field(default="", env="MIXEDBREAD_API_KEY")
    
    # Axiom
    AXIOM_API_KEY: str = Field(default="", env="AXIOM_API_KEY")
    AXIOM_DATASET: str = Field(default="clinic-ops-audit", env="AXIOM_DATASET")
    
    # AgentOps
    AGENTOPS_API_KEY: str = Field(default="", env="AGENTOPS_API_KEY")
    
    # JWT
    JWT_SECRET: str = Field(default="your-secret-key", env="JWT_SECRET")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24
    
    # Waystar Clearinghouse
    WAYSTAR_CREDENTIALS: str = Field(default="", env="WAYSTAR_CREDENTIALS")
    
    # HIPAA
    BAA_AGREEMENT_ID: str = Field(default="baa_2025_001", env="BAA_AGREEMENT_ID")
    DATA_RETENTION_YEARS: int = 7
    
    # Google Cloud
    GCP_PROJECT_ID: str = Field(default="", env="GCP_PROJECT_ID")
    GCP_REGION: str = Field(default="us-central1", env="GCP_REGION")
    
    def validate_production(self):
        """Validate required settings in production environment"""
        if self.ENVIRONMENT.lower() == 'production':
            missing = []
            
            if not self.FIREWORKS_API_KEY or self.FIREWORKS_API_KEY == "your-api-key":
                missing.append("FIREWORKS_API_KEY")
            
            if not self.MONGODB_ATLAS_URI:
                missing.append("MONGODB_ATLAS_URI")
            
            if not self.WAYSTAR_CREDENTIALS:
                missing.append("WAYSTAR_CREDENTIALS")
            
            if not self.JWT_SECRET or self.JWT_SECRET == "your-secret-key":
                missing.append("JWT_SECRET")
            
            if missing:
                raise RuntimeError(
                    f"Missing required production environment variables: {', '.join(missing)}. "
                    f"Please set these before starting the application."
                )
            
            if self.DEBUG:
                raise RuntimeError("DEBUG must be False in production environment")
    
    class Config:
        env_file = ".env.local"  # Development mode (gitignored)
        case_sensitive = False


# Global settings instance
settings = Settings()

# Validate on import in production
settings.validate_production()
