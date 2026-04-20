"""
FastAPI REST API for Clinic Ops Agent Enterprise
HIPAA-compliant endpoints with authentication and audit logging
"""

import os
import sys
from datetime import datetime
from typing import List, Optional
from datetime import timedelta
from contextlib import asynccontextmanager

# Add parent directory to path for absolute imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import jwt
import bleach
import html

from database.connection import mongo_manager, get_db
from database.schema import (
    DenialClaim, ClaimStatus, AppealMethod,
    ApprovalRecord, SubmissionRecord
)
from orchestrator.ag2_orchestrator import create_orchestrator
from compliance.audit import AuditLogger, HIPAACompliance


# Security
security = HTTPBearer(auto_error=False)

# Rate Limiter
limiter = Limiter(key_func=get_remote_address)

# JWT/auth config (from environment)
INSECURE_JWT_SECRETS = {
    "",
    "change-me-in-production",
    "your-secret-key",
    "your_jwt_secret_key_here",
    "your-super-secret-jwt-key-min-32-chars",
}


def _runtime_environment() -> str:
    return (os.getenv("ENVIRONMENT") or os.getenv("APP_ENV") or "development").strip().lower()


def _resolve_jwt_secret() -> str:
    return (
        os.getenv("JWT_SECRET")
        or os.getenv("JWT_SECRET_KEY")
        or os.getenv("API_SECRET_KEY")
        or "change-me-in-production"
    ).strip()


JWT_SECRET = _resolve_jwt_secret()
JWT_ALGORITHM = (os.getenv("JWT_ALGORITHM") or os.getenv("API_ALGORITHM") or "HS256").strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    from pymongo.errors import ServerSelectionTimeoutError
    
    environment = _runtime_environment()
    if environment in {"production", "prod"}:
        if JWT_SECRET in INSECURE_JWT_SECRETS or len(JWT_SECRET) < 32:
            raise RuntimeError(
                "Refusing to start in production with an insecure JWT secret. "
                "Set JWT_SECRET (or JWT_SECRET_KEY/API_SECRET_KEY) to a strong 32+ character value."
            )

    # Startup with error handling
    try:
        await mongo_manager.connect()
    except ServerSelectionTimeoutError as e:
        # Log critical error via AuditLogger
        audit = AuditLogger(None)  # No DB yet, will log to console
        await audit.log_action(
            actor_type="system",
            actor_id="startup",
            action="database_connection_failed",
            resource_type="mongodb",
            resource_id="atlas_cluster",
            details={"error": str(e), "environment": environment}
        )
        
        if environment == "production":
            # In production, fail-closed
            raise RuntimeError(f"CRITICAL: Database Connection Failed - {str(e)}") from e
        else:
            # In development, log and continue without DB
            print(f"⚠️  WARNING: MongoDB connection failed in development mode: {e}")
            print("⚠️  Application starting without database functionality")
    
    yield
    
    # Shutdown
    try:
        await mongo_manager.disconnect()
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")


app = FastAPI(
    title="Clinic Ops Agent Enterprise API",
    description="HIPAA-compliant Denial Management Platform API",
    version="1.0.0",
    lifespan=lifespan
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - Allow all origins for demo
ALLOWED_ORIGINS = ["*", "null"]  # DEMO: Allow all origins including file wrappers

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,  # Must be False when using allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Request/Response Models
class ClaimIntakeRequest(BaseModel):
    organization_id: str
    payer_id: str
    payer_name: str
    date_from: str
    date_to: str


class ClaimResponse(BaseModel):
    id: str
    status: str
    patient_name: str
    procedure_code: str
    denial_code: str
    billed_amount: float
    created_at: datetime


class ApprovalRequest(BaseModel):
    claim_id: str
    draft_id: str
    approver_id: str
    action: str  # "approved", "rejected", "modified"
    modifications: Optional[str] = None
    notes: Optional[str] = None


class AnalyticsResponse(BaseModel):
    period: str
    total_denials: int
    appeals_submitted: int
    success_rate: float
    total_recovery: float


# Authentication helper
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """JWT token validation with proper error handling"""
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        return {
            "user_id": payload.get("sub"),
            "organization_id": payload.get("org_id"),
            "email": payload.get("email"),
            "roles": payload.get("roles", [])
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[dict]:
    """JWT token validation - returns None if no auth (optional auth)"""
    if not credentials:
        return None
    
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        return {
            "user_id": payload.get("sub"),
            "organization_id": payload.get("org_id"),
            "email": payload.get("email"),
            "roles": payload.get("roles", [])
        }
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None  # Return None for invalid tokens (optional auth)


# Health check
@app.get("/health")
@limiter.limit("60/minute")
async def health_check(request: Request):
    """Health check endpoint with rate limiting"""
    db_healthy = await mongo_manager.health_check()
    return {
        "status": "healthy" if db_healthy else "degraded",
        "timestamp": datetime.utcnow(),
        "services": {
            "database": "connected" if db_healthy else "disconnected"
        }
    }


# Claims endpoints
@app.post("/claims/intake", response_model=dict)
@limiter.limit("30/minute")
async def create_claim_intake(
    http_request: Request,
    request: ClaimIntakeRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """
    Start new denial detection workflow
    Triggers AG2 orchestrator with Scraper agent
    """
    db = await get_db()
    audit = AuditLogger(db)
    
    # Generate claim ID
    claim_id = f"clm_{datetime.utcnow().timestamp()}"
    
    # Start orchestrator
    orchestrator = create_orchestrator()
    
    workflow_id = await orchestrator.start_workflow(
        claim_id=claim_id,
        organization_id=request.organization_id,
        initial_data={
            "payer_id": request.payer_id,
            "payer_name": request.payer_name,
            "date_from": request.date_from,
            "date_to": request.date_to,
            "initiated_by": user["user_id"]
        }
    )
    
    # Audit log
    await audit.log_action(
        actor_type="user",
        actor_id=user["user_id"],
        action="claim_intake_created",
        resource_type="denial_claim",
        resource_id=claim_id,
        changes={
            "payer_id": request.payer_id,
            "date_range": f"{request.date_from} to {request.date_to}"
        }
    )
    
    return {
        "claim_id": claim_id,
        "workflow_id": workflow_id,
        "status": "started",
        "message": "Denial detection workflow initiated"
    }


@app.get("/claims")
async def list_claims(
    organization_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    List denial claims with optional filtering
    """
    db = await get_db()
    
    # DEMO: Skip org filter if no auth
    query = {}
    if user and user.get("organization_id"):
        query["organization_id"] = user["organization_id"]
    if status:
        query["status"] = status
    
    cursor = db.denial_claims.find(query).skip(offset).limit(limit).sort("created_at", -1)
    claims = await cursor.to_list(length=limit)
    
    return [
        ClaimResponse(
            id=str(claim["_id"]),
            status=claim["status"],
            patient_name=f"{claim['patient']['first_name']} {claim['patient']['last_name']}",
            procedure_code=claim["procedure"]["procedure_code"],
            denial_code=claim["denial"]["denial_code"],
            billed_amount=claim["procedure"]["billed_amount"],
            created_at=claim["created_at"]
        )
        for claim in claims
    ]


@app.get("/claims/{claim_id}")
@limiter.limit("100/minute")
async def get_claim(
    request: Request,
    claim_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Get detailed claim information
    """
    db = await get_db()
    
    claim = await db.denial_claims.find_one({"_id": claim_id})
    if not claim:
        # Log failed access attempt for security monitoring
        audit = AuditLogger(db)
        await audit.log_action(
            actor_type="user",
            actor_id=user["user_id"],
            action="claim_access_denied",
            resource_type="denial_claim",
            resource_id=claim_id,
            details={"reason": "claim_not_found", "attempted_claim_id": claim_id}
        )
        raise HTTPException(status_code=404, detail="Claim not found")
    
    # Check organization access
    if claim["organization_id"] != user["organization_id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Audit log
    audit = AuditLogger(db)
    await audit.log_action(
        actor_type="user",
        actor_id=user["user_id"],
        action="claim_viewed",
        resource_type="denial_claim",
        resource_id=claim_id
    )
    
    return {
        "id": str(claim["_id"]),
        "status": claim["status"],
        "patient": claim["patient"],
        "procedure": claim["procedure"],
        "denial": claim["denial"],
        "analysis": claim.get("analysis"),
        "appeal_drafts": claim.get("appeal_drafts", []),
        "created_at": claim["created_at"],
        "updated_at": claim["updated_at"]
    }


@app.post("/claims/{claim_id}/approve")
async def approve_claim(
    claim_id: str,
    request: ApprovalRequest,
    user: dict = Depends(get_current_user)
):
    """
    Approve and submit appeal (human-in-the-loop)
    """
    db = await get_db()
    
    claim = await db.denial_claims.find_one({"_id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    # Sanitize user inputs to prevent XSS
    safe_modifications = bleach.clean(request.modifications) if request.modifications else None
    safe_notes = bleach.clean(request.notes) if request.notes else None
    
    # Update approval
    approval = ApprovalRecord(
        approval_id=f"appr_{datetime.utcnow().timestamp()}",
        approver_user_id=user["user_id"],
        approver_name=user.get("name", "Billing Analyst"),
        approval_timestamp=datetime.utcnow(),
        approval_action=request.action,
        modifications_made=safe_modifications,
        notes=safe_notes,
        v0_session_id=safe_notes  # Track v0 session
    )
    
    await db.denial_claims.update_one(
        {"_id": claim_id},
        {
            "$set": {
                "approval": approval.dict(),
                "status": "pending_submission" if request.action == "approved" else "approval_rejected",
                "updated_at": datetime.utcnow()
            }
        }
    )
    
    # If approved, trigger submission
    if request.action == "approved":
        orchestrator = create_orchestrator()
        result = await orchestrator.approve_and_submit(
            claim_id=claim_id,
            draft_id=request.draft_id,
            approver_id=user["user_id"],
            modifications=request.modifications
        )
        
        return {
            "status": "submitted",
            "claim_id": claim_id,
            "approval": approval.dict(),
            "submission": result
        }
    
    return {
        "status": "rejected",
        "claim_id": claim_id,
        "approval": approval.dict()
    }


@app.get("/claims/{claim_id}/audit-trail")
async def get_claim_audit_trail(
    claim_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Get complete audit trail for a claim (HIPAA compliance)
    """
    db = await get_db()
    audit = AuditLogger(db)
    
    trail = await audit.get_audit_trail(
        resource_type="denial_claim",
        resource_id=claim_id,
        limit=100
    )
    
    # Verify chain integrity
    integrity = await audit.verify_chain_integrity(
        resource_type="denial_claim",
        resource_id=claim_id
    )
    
    return {
        "claim_id": claim_id,
        "audit_entries": trail,
        "integrity_check": integrity
    }


# Dashboard endpoints - DEMO: Optional auth
@app.get("/dashboard/stats")
async def get_dashboard_stats(
    period: str = Query("30d", regex="^(7d|30d|90d|1y)$"),
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Get dashboard analytics (DEMO: no auth required)
    """
    db = await get_db()
    
    # Calculate date range
    days_map = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
    days = days_map.get(period, 30)
    
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Aggregate pipeline - DEMO: skip org filter
    pipeline = [
        {
            "$match": {
                "created_at": {"$gte": start_date}
            }
        },
        {
            "$group": {
                "_id": None,
                "total_denials": {"$sum": 1},
                "appeals_submitted": {
                    "$sum": {"$cond": [{"$eq": ["$status", "submitted"]}, 1, 0]}
                },
                "resolved": {
                    "$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}
                },
                "total_billed": {"$sum": "$procedure.billed_amount"},
                "total_recovery": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", "resolved"]},
                            "$procedure.billed_amount",
                            0
                        ]
                    }
                }
            }
        }
    ]
    
    result = await db.denial_claims.aggregate(pipeline).to_list(length=1)
    stats = result[0] if result else {}
    
    submitted = stats.get("appeals_submitted") or 0
    resolved = stats.get("resolved") or 0
    success_rate = (resolved / submitted * 100) if submitted > 0 else 0
    
    total_billed = stats.get("total_billed") or 0
    total_recovery = stats.get("total_recovery") or 0
    recovery_rate = round((total_recovery / total_billed * 100), 2) if total_billed > 0 else 0
    
    return {
        "period": period,
        "total_denials": stats.get("total_denials") or 0,
        "appeals_submitted": submitted,
        "appeals_resolved": resolved,
        "success_rate": round(success_rate, 2),
        "total_billed": total_billed,
        "total_recovery": total_recovery,
        "recovery_rate": recovery_rate
    }


@app.get("/dashboard/pending-approval")
async def get_pending_approval_claims(
    limit: int = Query(20, ge=1, le=50),
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Get claims pending human approval (v0 dashboard)
    """
    db = await get_db()
    
    # DEMO: Skip org filter if no auth
    query = {"status": "appeal_drafted"}
    if user and user.get("organization_id"):
        query["organization_id"] = user["organization_id"]
    
    cursor = db.denial_claims.find(query).limit(limit).sort("priority_score", -1)
    
    claims = await cursor.to_list(length=limit)
    
    return [
        {
            "id": str(c["_id"]),
            "claim_number": c.get("denial", {}).get("claim_number", "Unknown"),
            "patient_name": f"{c.get('patient', {}).get('first_name', '')} {c.get('patient', {}).get('last_name', '')}".strip() or "Unknown Patient",
            "denial_code": c.get("denial", {}).get("denial_code", "Unknown"),
            "denial_reason": c.get("denial", {}).get("denial_description", "Unknown"),
            "billed_amount": c.get("procedure", {}).get("billed_amount", 0.0),
            "appeal_probability": c.get("analysis", {}).get("appeal_probability", 0.5),
            "expected_recovery": c.get("analysis", {}).get("expected_recovery_amount", 0.0),
            "appeal_draft_preview": (c.get("appeal_drafts") or [{}])[0].get("appeal_letter", "")[:500] + "...",
            "created_at": c.get("created_at")
        }
        for c in claims
    ]


# Payer portal management
@app.post("/payer-portals/{payer_id}/trigger-scrape")
async def trigger_manual_scrape(
    payer_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """
    Manually trigger payer portal scraping
    """
    db = await get_db()
    
    # Get portal config
    portal = await db.payer_portals.find_one({"payer_id": payer_id})
    if not portal:
        raise HTTPException(status_code=404, detail="Payer portal not found")
    
    # Trigger scrape in background with timeout
    from ..scrapers.tinyfish_scraper import ScraperScheduler
    
    async def scrape_with_timeout():
        try:
            await asyncio.wait_for(
                ScraperScheduler.scheduled_scrape_job(
                    payer_portal_id=str(portal["_id"]),
                    organization_id=user["organization_id"]
                ),
                timeout=300  # 5 minute timeout
            )
        except asyncio.TimeoutError:
            # Log timeout for monitoring via AuditLogger
            audit = AuditLogger(db)
            await audit.log_action(
                actor_type="system",
                actor_id="scraper_scheduler",
                action="scrape_job_timeout",
                resource_type="payer_portal",
                resource_id=payer_id,
                details={"timeout_seconds": 300}
            )
    
    background_tasks.add_task(scrape_with_timeout)
    
    return {
        "status": "triggered",
        "payer_id": payer_id,
        "message": "Scrape job started in background"
    }


# Compliance endpoints
@app.get("/compliance/hipaa-check/{claim_id}")
async def run_hipaa_compliance_check(
    claim_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Run HIPAA compliance check on claim data
    """
    db = await get_db()
    
    claim = await db.denial_claims.find_one({"_id": claim_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    # Validate PHI handling
    violations = HIPAACompliance.validate_phi_handling(claim)
    
    return {
        "claim_id": claim_id,
        "compliant": len(violations) == 0,
        "violations": violations,
        "encrypted_fields": [
            "patient.mrn",
            "patient.first_name",
            "patient.last_name",
            "patient.date_of_birth",
            "patient.insurance_member_id"
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
