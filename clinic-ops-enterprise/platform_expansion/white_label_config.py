"""
White-Label RCM Agent Platform (BPO Expansion)
Multi-tenant architecture for Medical Billing Companies and RCM BPOs
"""

import os
import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import hashlib
import asyncio


class TenantTier(str, Enum):
    """White-label tenant tiers"""
    STARTER = "starter"  # Up to 50 providers
    PROFESSIONAL = "professional"  # Up to 200 providers
    ENTERPRISE = "enterprise"  # Up to 1000 providers
    UNLIMITED = "unlimited"  # Unlimited providers


class TenantStatus(str, Enum):
    """Tenant account status"""
    ACTIVE = "active"
    SUSPENDED = "suspended"
    TRIAL = "trial"
    CANCELLED = "cancelled"


@dataclass
class WhiteLabelBranding:
    """White-label branding configuration"""
    company_name: str
    logo_url: Optional[str]
    primary_color: str
    secondary_color: str
    favicon_url: Optional[str]
    custom_domain: Optional[str]
    email_sender_name: str
    email_sender_address: str
    support_phone: Optional[str]
    support_email: Optional[str]


@dataclass
class TenantSLA:
    """Service Level Agreement for tenant"""
    max_claims_per_month: int
    response_time_hours: float
    uptime_percentage: float
    support_hours: str
    escalation_time_hours: float


@dataclass
class TenantGovernance:
    """Governance and compliance settings"""
    hipaa_compliance_required: bool
    soc2_compliance_required: bool
    data_retention_days: int
    audit_log_retention_days: int
    allowed_payers: List[str]
    restricted_procedures: List[str]
    custom_workflows: Dict[str, Any]


@dataclass
class WhiteLabelTenant:
    """White-label tenant configuration"""
    tenant_id: str
    tenant_name: str
    tier: TenantTier
    status: TenantStatus
    branding: WhiteLabelBranding
    sla: TenantSLA
    governance: TenantGovernance
    api_keys: Dict[str, str]
    provider_count: int
    max_providers: int
    monthly_revenue: float
    created_at: datetime
    billing_email: str
    technical_contact: str
    custom_features: List[str]
    parent_bpo_id: Optional[str]


class WhiteLabelPlatformManager:
    """
    Manages white-label deployments for BPOs and billing companies
    """
    
    def __init__(self, db=None):
        self.db = db
        self.tenants: Dict[str, WhiteLabelTenant] = {}
        self.tier_limits = {
            TenantTier.STARTER: {
                "max_providers": 50,
                "max_claims_per_month": 10000,
                "api_rate_limit": 1000  # requests per hour
            },
            TenantTier.PROFESSIONAL: {
                "max_providers": 200,
                "max_claims_per_month": 50000,
                "api_rate_limit": 5000
            },
            TenantTier.ENTERPRISE: {
                "max_providers": 1000,
                "max_claims_per_month": 250000,
                "api_rate_limit": 25000
            },
            TenantTier.UNLIMITED: {
                "max_providers": float('inf'),
                "max_claims_per_month": float('inf'),
                "api_rate_limit": 100000
            }
        }
    
    async def create_tenant(
        self,
        company_name: str,
        tier: TenantTier,
        branding: WhiteLabelBranding,
        billing_email: str,
        technical_contact: str,
        parent_bpo_id: Optional[str] = None
    ) -> WhiteLabelTenant:
        """
        Create new white-label tenant for a BPO/billing company
        """
        # Generate tenant ID
        tenant_id = f"TENANT-{company_name[:8].upper()}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        tenant_id = hashlib.md5(tenant_id.encode()).hexdigest()[:16]
        
        # Get tier limits
        limits = self.tier_limits[tier]
        
        # Create API keys
        api_keys = {
            "public_key": f"pk_{hashlib.sha256(os.urandom(32)).hexdigest()[:32]}",
            "secret_key": f"sk_{hashlib.sha256(os.urandom(32)).hexdigest()[:64]}",
            "webhook_secret": f"wh_{hashlib.sha256(os.urandom(32)).hexdigest()[:32]}"
        }
        
        # Create SLA based on tier
        sla = TenantSLA(
            max_claims_per_month=limits["max_claims_per_month"],
            response_time_hours=4 if tier in [TenantTier.STARTER, TenantTier.PROFESSIONAL] else 2,
            uptime_percentage=99.5 if tier == TenantTier.STARTER else 99.9,
            support_hours="business_hours" if tier == TenantTier.STARTER else "24/7",
            escalation_time_hours=24 if tier == TenantTier.STARTER else 4
        )
        
        # Default governance
        governance = TenantGovernance(
            hipaa_compliance_required=True,
            soc2_compliance_required=tier in [TenantTier.ENTERPRISE, TenantTier.UNLIMITED],
            data_retention_days=2555 if tier == TenantTier.STARTER else 3650,  # 7 vs 10 years
            audit_log_retention_days=365,
            allowed_payers=[],  # All payers allowed by default
            restricted_procedures=[],
            custom_workflows={}
        )
        
        tenant = WhiteLabelTenant(
            tenant_id=tenant_id,
            tenant_name=company_name,
            tier=tier,
            status=TenantStatus.ACTIVE,
            branding=branding,
            sla=sla,
            governance=governance,
            api_keys=api_keys,
            provider_count=0,
            max_providers=limits["max_providers"],
            monthly_revenue=0.0,
            created_at=datetime.utcnow(),
            billing_email=billing_email,
            technical_contact=technical_contact,
            custom_features=[],  # Populated based on tier
            parent_bpo_id=parent_bpo_id
        )
        
        # Store tenant
        self.tenants[tenant_id] = tenant
        
        # Add tier-specific features
        await self._configure_tier_features(tenant)
        
        # Store to database
        if self.db:
            await self._store_tenant(tenant)
        
        return tenant
    
    async def _configure_tier_features(self, tenant: WhiteLabelTenant):
        """Configure features based on tier"""
        base_features = [
            "basic_auth_workflows",
            "denial_management",
            "standard_reporting",
            "email_notifications"
        ]
        
        tier_features = {
            TenantTier.STARTER: base_features,
            TenantTier.PROFESSIONAL: base_features + [
                "advanced_analytics",
                "custom_branding",
                "api_access",
                "priority_support"
            ],
            TenantTier.ENTERPRISE: base_features + [
                "advanced_analytics",
                "custom_branding",
                "api_access",
                "priority_support",
                "white_label_portal",
                "custom_workflows",
                "dedicated_account_manager",
                "sla_guarantees"
            ],
            TenantTier.UNLIMITED: base_features + [
                "advanced_analytics",
                "custom_branding",
                "api_access",
                "priority_support",
                "white_label_portal",
                "custom_workflows",
                "dedicated_account_manager",
                "sla_guarantees",
                "custom_ai_training",
                "multi_region_deployment",
                "enterprise_governance"
            ]
        }
        
        tenant.custom_features = tier_features.get(tenant.tier, base_features)
    
    async def _store_tenant(self, tenant: WhiteLabelTenant):
        """Store tenant to database"""
        if not self.db:
            return
        
        doc = {
            "_id": tenant.tenant_id,
            "tenant_name": tenant.tenant_name,
            "tier": tenant.tier.value,
            "status": tenant.status.value,
            "branding": {
                "company_name": tenant.branding.company_name,
                "logo_url": tenant.branding.logo_url,
                "primary_color": tenant.branding.primary_color,
                "secondary_color": tenant.branding.secondary_color,
                "custom_domain": tenant.branding.custom_domain,
                "email_sender_name": tenant.branding.email_sender_name,
                "support_phone": tenant.branding.support_phone
            },
            "sla": {
                "max_claims_per_month": tenant.sla.max_claims_per_month,
                "response_time_hours": tenant.sla.response_time_hours,
                "uptime_percentage": tenant.sla.uptime_percentage
            },
            "governance": {
                "hipaa_compliance_required": tenant.governance.hipaa_compliance_required,
                "data_retention_days": tenant.governance.data_retention_days,
                "audit_log_retention_days": tenant.governance.audit_log_retention_days
            },
            "api_keys_public": tenant.api_keys.get("public_key"),
            "provider_count": tenant.provider_count,
            "max_providers": tenant.max_providers,
            "monthly_revenue": tenant.monthly_revenue,
            "billing_email": tenant.billing_email,
            "technical_contact": tenant.technical_contact,
            "custom_features": tenant.custom_features,
            "parent_bpo_id": tenant.parent_bpo_id,
            "created_at": tenant.created_at
        }
        
        await self.db.white_label_tenants.insert_one(doc)
    
    async def configure_custom_domain(
        self,
        tenant_id: str,
        custom_domain: str
    ) -> Dict[str, Any]:
        """Configure custom domain for white-label tenant"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        
        # Check if tier supports custom domains
        if tenant.tier not in [TenantTier.PROFESSIONAL, TenantTier.ENTERPRISE, TenantTier.UNLIMITED]:
            return {"error": "Custom domains not available for this tier"}
        
        tenant.branding.custom_domain = custom_domain
        
        # In production, would:
        # 1. Validate domain ownership
        # 2. Configure SSL certificate
        # 3. Update DNS records
        # 4. Configure reverse proxy
        
        return {
            "tenant_id": tenant_id,
            "custom_domain": custom_domain,
            "status": "configured",
            "ssl_status": "pending_validation",
            "dns_records": [
                {"type": "CNAME", "name": custom_domain, "value": "platform.clinic-ops.ai"}
            ]
        }
    
    async def add_provider_to_tenant(
        self,
        tenant_id: str,
        provider_npi: str,
        provider_name: str
    ) -> Dict[str, Any]:
        """Add a provider to a white-label tenant"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        
        # Check provider limit
        if tenant.provider_count >= tenant.max_providers:
            return {
                "error": "Provider limit reached",
                "current_count": tenant.provider_count,
                "max_allowed": tenant.max_providers,
                "upgrade_required": True
            }
        
        # Add provider
        tenant.provider_count += 1
        
        # Store provider association
        if self.db:
            await self.db.tenant_providers.insert_one({
                "tenant_id": tenant_id,
                "provider_npi": provider_npi,
                "provider_name": provider_name,
                "added_at": datetime.utcnow(),
                "status": "active"
            })
        
        return {
            "success": True,
            "tenant_id": tenant_id,
            "provider_npi": provider_npi,
            "provider_count": tenant.provider_count,
            "remaining_slots": tenant.max_providers - tenant.provider_count
        }
    
    def get_tenant_analytics(self, tenant_id: str) -> Dict[str, Any]:
        """Get analytics for a specific tenant"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        
        # Calculate utilization
        provider_utilization = tenant.provider_count / tenant.max_providers if tenant.max_providers != float('inf') else 0
        
        return {
            "tenant_id": tenant_id,
            "tenant_name": tenant.tenant_name,
            "tier": tenant.tier.value,
            "status": tenant.status.value,
            "utilization": {
                "providers": {
                    "current": tenant.provider_count,
                    "max": tenant.max_providers if tenant.max_providers != float('inf') else "unlimited",
                    "percentage": provider_utilization * 100
                }
            },
            "sla_performance": {
                "uptime_target": tenant.sla.uptime_percentage,
                "response_time_target_hours": tenant.sla.response_time_hours
            },
            "features_enabled": tenant.custom_features,
            "branding_configured": tenant.branding.custom_domain is not None,
            "monthly_revenue": tenant.monthly_revenue,
            "created_at": tenant.created_at.isoformat()
        }
    
    async def upgrade_tier(
        self,
        tenant_id: str,
        new_tier: TenantTier
    ) -> Dict[str, Any]:
        """Upgrade tenant to higher tier"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        
        # Check if actually upgrading
        tier_order = [TenantTier.STARTER, TenantTier.PROFESSIONAL, TenantTier.ENTERPRISE, TenantTier.UNLIMITED]
        if tier_order.index(new_tier) <= tier_order.index(tenant.tier):
            return {"error": "New tier must be higher than current tier"}
        
        old_tier = tenant.tier
        tenant.tier = new_tier
        
        # Update limits
        limits = self.tier_limits[new_tier]
        tenant.max_providers = limits["max_providers"]
        tenant.sla.max_claims_per_month = limits["max_claims_per_month"]
        
        # Reconfigure features
        await self._configure_tier_features(tenant)
        
        return {
            "success": True,
            "tenant_id": tenant_id,
            "previous_tier": old_tier.value,
            "new_tier": new_tier.value,
            "new_limits": {
                "max_providers": tenant.max_providers if tenant.max_providers != float('inf') else "unlimited",
                "max_claims_per_month": tenant.sla.max_claims_per_month if tenant.sla.max_claims_per_month != float('inf') else "unlimited"
            },
            "new_features": tenant.custom_features
        }
    
    def generate_tenant_api_documentation(
        self,
        tenant_id: str
    ) -> Dict[str, Any]:
        """Generate API documentation for tenant"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        
        return {
            "api_base_url": f"https://api.clinic-ops.ai/v1",
            "authentication": {
                "type": "api_key",
                "header": "X-API-Key",
                "public_key": tenant.api_keys.get("public_key")
            },
            "rate_limits": {
                "requests_per_hour": self.tier_limits[tenant.tier]["api_rate_limit"]
            },
            "webhooks": {
                "endpoint": f"https://{tenant.branding.custom_domain or 'your-domain'}/webhooks/clinic-ops",
                "secret": tenant.api_keys.get("webhook_secret"),
                "events": [
                    "claim.status_changed",
                    "denial.detected",
                    "appeal.submitted",
                    "payment.received"
                ]
            },
            "endpoints": [
                {
                    "path": "/claims",
                    "methods": ["GET", "POST"],
                    "description": "Submit and retrieve claims"
                },
                {
                    "path": "/denials",
                    "methods": ["GET", "POST"],
                    "description": "Manage denial appeals"
                },
                {
                    "path": "/analytics",
                    "methods": ["GET"],
                    "description": "Retrieve analytics and reports"
                }
            ]
        }
    
    async def suspend_tenant(
        self,
        tenant_id: str,
        reason: str
    ) -> Dict[str, Any]:
        """Suspend a tenant account"""
        if tenant_id not in self.tenants:
            return {"error": "Tenant not found"}
        
        tenant = self.tenants[tenant_id]
        tenant.status = TenantStatus.SUSPENDED
        
        # In production, would:
        # 1. Disable API access
        # 2. Stop processing claims
        # 3. Notify tenant
        # 4. Preserve data for retention period
        
        return {
            "success": True,
            "tenant_id": tenant_id,
            "status": "suspended",
            "reason": reason,
            "data_retention": f"{tenant.governance.data_retention_days} days"
        }
    
    def list_all_tenants(self) -> List[Dict[str, Any]]:
        """List all tenants with summary info"""
        return [
            {
                "tenant_id": t.tenant_id,
                "tenant_name": t.tenant_name,
                "tier": t.tier.value,
                "status": t.status.value,
                "provider_count": t.provider_count,
                "max_providers": t.max_providers if t.max_providers != float('inf') else "unlimited",
                "monthly_revenue": t.monthly_revenue,
                "created_at": t.created_at.isoformat(),
                "parent_bpo_id": t.parent_bpo_id
            }
            for t in self.tenants.values()
        ]


class MultiTenantMiddleware:
    """
    Middleware for handling multi-tenant requests
    """
    
    def __init__(self, platform_manager: WhiteLabelPlatformManager):
        self.platform_manager = platform_manager
    
    async def identify_tenant(self, request_headers: Dict[str, str]) -> Optional[str]:
        """Identify tenant from request headers"""
        # Check API key
        api_key = request_headers.get("X-API-Key")
        if api_key:
            for tenant_id, tenant in self.platform_manager.tenants.items():
                if tenant.api_keys.get("public_key") == api_key:
                    return tenant_id
        
        # Check custom domain
        host = request_headers.get("Host", "")
        for tenant_id, tenant in self.platform_manager.tenants.items():
            if tenant.branding.custom_domain == host:
                return tenant_id
        
        return None
    
    async def validate_tenant_access(
        self,
        tenant_id: str,
        endpoint: str,
        method: str
    ) -> Dict[str, Any]:
        """Validate tenant access to specific endpoint"""
        if tenant_id not in self.platform_manager.tenants:
            return {"allowed": False, "error": "Tenant not found"}
        
        tenant = self.platform_manager.tenants[tenant_id]
        
        # Check tenant status
        if tenant.status != TenantStatus.ACTIVE:
            return {
                "allowed": False,
                "error": f"Tenant account is {tenant.status.value}"
            }
        
        # Check if feature is enabled
        required_features = {
            "/analytics": ["advanced_analytics"],
            "/custom-workflows": ["custom_workflows"]
        }
        
        required = required_features.get(endpoint, [])
        for feature in required:
            if feature not in tenant.custom_features:
                return {
                    "allowed": False,
                    "error": f"Feature '{feature}' not available in {tenant.tier.value} tier"
                }
        
        return {"allowed": True, "tenant_id": tenant_id}


# Global instances
white_label_platform = WhiteLabelPlatformManager()
multi_tenant_middleware = MultiTenantMiddleware(white_label_platform)
