"""
HIPAA-Compliant MongoDB Schema for Clinic Ops Agent - Denial Management Platform
Enterprise-grade schema with audit trails, encryption markers, and compliance fields
"""

from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from bson import ObjectId


class ClaimStatus(str, Enum):
    """Claim status enumeration"""
    DETECTED = "detected"
    ANALYZING = "analyzing"
    APPEAL_DRAFTED = "appeal_drafted"
    PENDING_APPROVAL = "pending_approval"
    SUBMITTED = "submitted"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    REJECTED = "rejected"


class DenialType(str, Enum):
    """Common denial reason categories"""
    COVERAGE_EXCLUSION = "coverage_exclusion"
    PRIOR_AUTH_REQUIRED = "prior_auth_required"
    MEDICAL_NECESSITY = "medical_necessity"
    TIMELY_FILING = "timely_filing"
    COORDINATION_OF_BENEFITS = "coordination_of_benefits"
    DUPLICATE_CLAIM = "duplicate_claim"
    PROCEDURE_CODE = "procedure_code"
    DIAGNOSIS_CODE = "diagnosis_code"
    PROVIDER_NOT_ELIGIBLE = "provider_not_eligible"
    OUT_OF_NETWORK = "out_of_network"
    OTHER = "other"


class AppealMethod(str, Enum):
    """Appeal submission methods"""
    PORTAL = "portal"
    FAX = "fax"
    MAIL = "mail"
    EMAIL = "email"
    PHONE = "phone"


class PatientInfo(BaseModel):
    """PHI - Encrypted at rest"""
    patient_id: str = Field(..., description="Internal patient identifier")
    mrn: str = Field(..., description="Medical record number - ENCRYPTED")
    first_name: str = Field(..., description="First name - ENCRYPTED")
    last_name: str = Field(..., description="Last name - ENCRYPTED")
    date_of_birth: str = Field(..., description="DOB - ENCRYPTED")
    insurance_member_id: str = Field(..., description="Member ID - ENCRYPTED")
    payer_id: str = Field(..., description="Payer/Insurance company ID")
    payer_name: str = Field(..., description="Payer name")
    
    class Config:
        json_schema_extra = {
            "encrypted_fields": ["mrn", "first_name", "last_name", "date_of_birth", "insurance_member_id"]
        }


class ProcedureInfo(BaseModel):
    """Procedure details"""
    procedure_code: str = Field(..., description="CPT/HCPCS code")
    procedure_description: str = Field(..., description="Procedure description")
    diagnosis_codes: List[str] = Field(default_factory=list, description="ICD-10 codes")
    service_date: datetime
    provider_npi: str = Field(..., description="Provider NPI")
    facility_name: Optional[str] = None
    billed_amount: float = Field(..., description="Amount billed")
    allowed_amount: Optional[float] = None
    paid_amount: Optional[float] = None


class DenialDetails(BaseModel):
    """Denial specific information"""
    denial_code: str = Field(..., description="CARC/RARC denial code")
    denial_description: str = Field(..., description="Denial description from payer")
    denial_type: DenialType
    denial_date: datetime
    claim_number: str = Field(..., description="Payer claim number")
    internal_claim_id: str = Field(..., description="Internal claim tracking ID")
    raw_portal_text: Optional[str] = None
    denial_reason_extracted: Optional[str] = None


class ScraperEvidence(BaseModel):
    """Evidence from TinyFish scraper"""
    workflow_id: str
    portal_url: str
    screenshot_url: Optional[str] = None
    scraped_text: str
    extraction_timestamp: datetime
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    scraping_agent_version: str


class AnalysisResult(BaseModel):
    """AI Analysis from Fireworks.ai + Mixedbread RAG"""
    analysis_id: str = Field(..., description="Unique analysis ID")
    analysis_timestamp: datetime
    denial_type_confidence: float = Field(..., ge=0.0, le=1.0)
    recommended_action: str
    appeal_probability_score: float = Field(..., ge=0.0, le=1.0)
    expected_recovery_amount: Optional[float] = None
    medical_necessity_analysis: Optional[str] = None
    policy_references: List[Dict[str, str]] = Field(default_factory=list)
    clinical_evidence_cited: List[str] = Field(default_factory=list)
    llm_model_version: str
    rag_documents_queried: List[str] = Field(default_factory=list)


class AppealDraft(BaseModel):
    """Generated appeal letter"""
    draft_id: str
    created_timestamp: datetime
    appeal_letter_text: str
    appeal_method: AppealMethod
    supporting_documents: List[str] = Field(default_factory=list)
    deadline_date: Optional[datetime] = None
    word_count: int
    requires_md_signature: bool = False
    draft_version: int = 1


class ApprovalRecord(BaseModel):
    """Human approval tracking"""
    approval_id: str
    approver_user_id: str
    approver_name: str
    approval_timestamp: datetime
    approval_action: str  # "approved", "rejected", "modified"
    modifications_made: Optional[str] = None
    notes: Optional[str] = None
    v0_session_id: Optional[str] = None


class SubmissionRecord(BaseModel):
    """Final submission tracking"""
    submission_id: str
    submitted_timestamp: datetime
    submission_method: AppealMethod
    confirmation_number: Optional[str] = None
    portal_submission_evidence: Optional[ScraperEvidence] = None
    attached_documents: List[str] = Field(default_factory=list)
    submitted_by_agent: str


class AuditEntry(BaseModel):
    """HIPAA audit log entry - Immutable"""
    audit_id: str = Field(default_factory=lambda: str(ObjectId()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    action: str
    actor_type: str  # "system", "agent", "user"
    actor_id: str
    resource_type: str
    resource_id: str
    changes: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    session_id: Optional[str] = None
    hash_chain: Optional[str] = None  # Tamper-evident logging


class DenialClaim(BaseModel):
    """
    Main denial claim document - HIPAA compliant
    Stores all data related to a single denied claim and its resolution
    """
    # Primary ID
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    
    # Core References
    organization_id: str = Field(..., description="Clinic/Organization ID")
    
    # PHI Data (Encrypted at rest)
    patient: PatientInfo
    procedure: ProcedureInfo
    denial: DenialDetails
    
    # Workflow State
    status: ClaimStatus = ClaimStatus.DETECTED
    status_history: List[Dict[str, Any]] = Field(default_factory=list)
    
    # Automation Evidence
    scraper_evidence: Optional[ScraperEvidence] = None
    
    # AI Analysis
    analysis: Optional[AnalysisResult] = None
    
    # Appeal Documents
    appeal_drafts: List[AppealDraft] = Field(default_factory=list)
    current_draft_id: Optional[str] = None
    
    # Human Approval
    approval: Optional[ApprovalRecord] = None
    
    # Submission
    submission: Optional[SubmissionRecord] = None
    
    # Compliance & Audit
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    retention_until: Optional[datetime] = None  # HIPAA retention policy
    encrypted_at_rest: bool = True
    baa_agreement_id: str = Field(..., description="Business Associate Agreement ID")
    
    # Metadata
    tags: List[str] = Field(default_factory=list)
    priority_score: float = Field(default=0.5, ge=0.0, le=1.0)
    assigned_to: Optional[str] = None
    
    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "organization_id": "clinic_001",
                "patient": {
                    "patient_id": "p_12345",
                    "mrn": "[ENCRYPTED]",
                    "first_name": "[ENCRYPTED]",
                    "last_name": "[ENCRYPTED]",
                    "date_of_birth": "[ENCRYPTED]",
                    "insurance_member_id": "[ENCRYPTED]",
                    "payer_id": "aetna_001",
                    "payer_name": "Aetna Better Health"
                },
                "denial": {
                    "denial_code": "CO-50",
                    "denial_description": "Non-covered service - medical necessity not met",
                    "denial_type": "medical_necessity",
                    "denial_date": "2025-01-15T00:00:00Z",
                    "claim_number": "CLM-2025-001234",
                    "internal_claim_id": "INT-789"
                },
                "status": "detected",
                "baa_agreement_id": "baa_2025_001"
            }
        }


class Organization(BaseModel):
    """Clinic/Healthcare organization"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    name: str
    npi: str
    tax_id: str
    address: Dict[str, str]
    contact_email: str
    contact_phone: str
    
    # Integration settings
    ehr_system: Optional[str] = None
    ehr_integration_enabled: bool = False
    
    # Payer portal credentials (encrypted)
    payer_portals: List[Dict[str, Any]] = Field(default_factory=list)
    
    # Compliance
    baa_agreement_id: str
    baa_signed_date: datetime
    data_retention_years: int = 7
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class User(BaseModel):
    """Platform users (billing staff, admins)"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    organization_id: str
    
    email: str
    first_name: str
    last_name: str
    role: str  # "billing_analyst", "billing_manager", "admin"
    
    # Auth
    password_hash: str
    last_login: Optional[datetime] = None
    mfa_enabled: bool = False
    
    # Permissions
    permissions: List[str] = Field(default_factory=list)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class PayerPortalConfig(BaseModel):
    """Configuration for payer portal scraping"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    
    payer_id: str
    payer_name: str
    portal_url: str
    
    # TinyFish workflow config
    tinyfish_workflow_id: Optional[str] = None
    tinyfish_workflow_url: Optional[str] = None
    scraping_schedule: str = "0 */6 * * *"  # Every 6 hours
    
    # Portal credentials (encrypted)
    credentials_encrypted: str
    
    # Detection rules
    denial_indicators: List[str] = Field(default_factory=list)
    claim_status_selectors: Dict[str, str] = Field(default_factory=dict)
    
    is_active: bool = True
    last_successful_scrape: Optional[datetime] = None
    fail_count: int = 0
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AnalyticsSummary(BaseModel):
    """Aggregated analytics for dashboard"""
    id: str = Field(default_factory=lambda: str(ObjectId()), alias="_id")
    organization_id: str
    
    # Time period
    period_start: datetime
    period_end: datetime
    
    # Metrics
    total_denials_detected: int
    total_appeals_drafted: int
    total_appeals_submitted: int
    total_appeals_resolved: int
    
    success_rate: float
    avg_time_to_resolution_hours: float
    total_recovery_amount: float
    
    # Breakdowns
    denials_by_type: Dict[str, int] = Field(default_factory=dict)
    denials_by_payer: Dict[str, int] = Field(default_factory=dict)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)


# MongoDB Collection Indexes Configuration
COLLECTION_INDEXES = {
    "denial_claims": [
        {"keys": [("organization_id", 1), ("status", 1)], "name": "org_status_idx"},
        {"keys": [("patient.patient_id", 1)], "name": "patient_idx"},
        {"keys": [("denial.claim_number", 1)], "name": "claim_number_idx", "unique": True},
        {"keys": [("created_at", -1)], "name": "created_at_idx"},
        {"keys": [("priority_score", -1)], "name": "priority_idx"},
        {"keys": [("tags", 1)], "name": "tags_idx"},
    ],
    "organizations": [
        {"keys": [("npi", 1)], "name": "npi_idx", "unique": True},
    ],
    "users": [
        {"keys": [("email", 1)], "name": "email_idx", "unique": True},
        {"keys": [("organization_id", 1)], "name": "org_user_idx"},
    ],
    "audit_logs": [
        {"keys": [("timestamp", -1)], "name": "audit_time_idx"},
        {"keys": [("resource_id", 1)], "name": "audit_resource_idx"},
        {"keys": [("actor_id", 1)], "name": "audit_actor_idx"},
    ],
    "analytics_summaries": [
        {"keys": [("organization_id", 1), ("period_start", -1)], "name": "analytics_period_idx"},
    ]
}


def get_collection_schema(collection_name: str) -> type:
    """Get Pydantic model for a collection"""
    schemas = {
        "denial_claims": DenialClaim,
        "organizations": Organization,
        "users": User,
        "payer_portals": PayerPortalConfig,
        "analytics_summaries": AnalyticsSummary,
        "audit_logs": AuditEntry,
    }
    return schemas.get(collection_name)
