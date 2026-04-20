"""
Patient Portal API Module
Secure patient-facing portal for viewing statements, making payments, accessing records
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, EmailStr
from fastapi import APIRouter, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from enum import Enum
import hashlib


# ==================== DATA MODELS ====================

class PatientPortalUser(BaseModel):
    """Patient portal user account"""
    patient_id: str
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    date_of_birth: str
    mrn: str  # Medical Record Number
    is_active: bool = True
    email_verified: bool = False
    mfa_enabled: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None


class StatementSummary(BaseModel):
    """Patient statement summary"""
    statement_id: str
    statement_date: datetime
    total_charges: float
    insurance_payments: float
    patient_payments: float
    adjustments: float
    balance_due: float
    due_date: Optional[datetime] = None
    status: str  # open, closed, overdue
    visit_count: int


class StatementDetail(BaseModel):
    """Detailed patient statement"""
    statement_id: str
    patient: Dict[str, str]
    guarantor: Optional[Dict[str, str]] = None
    
    visits: List[Dict[str, Any]]  # Date, provider, charges, etc.
    transactions: List[Dict[str, Any]]  # Payments, adjustments
    
    summary: StatementSummary
    
    insurance_info: Optional[Dict[str, Any]] = None
    payment_plans: List[Dict[str, Any]] = []


class PaymentMethodType(str, Enum):
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    HSA = "hsa"
    FSA = "fsa"
    BANK_ACCOUNT = "bank_account"
    DIGITAL_WALLET = "digital_wallet"


class PaymentMethod(BaseModel):
    """Stored payment method"""
    method_id: str
    patient_id: str
    type: PaymentMethodType
    
    # Masked info for display
    card_last4: Optional[str] = None
    card_brand: Optional[str] = None  # visa, mastercard, amex, discover
    expiration_month: Optional[int] = None
    expiration_year: Optional[int] = None
    
    bank_account_last4: Optional[str] = None
    bank_name: Optional[str] = None
    
    is_default: bool = False
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentRequest(BaseModel):
    """Payment request from patient"""
    patient_id: str
    amount: float = Field(gt=0)
    currency: str = "USD"
    
    statement_ids: List[str] = []  # Which statements to apply to
    claim_ids: List[str] = []  # Or specific claims
    
    payment_method_id: str
    
    # Optional payment plan info
    is_payment_plan_installment: bool = False
    payment_plan_id: Optional[str] = None
    
    # Receipt info
    email_receipt: bool = True
    receipt_email: Optional[EmailStr] = None


class PaymentResult(BaseModel):
    """Payment processing result"""
    payment_id: str
    status: str  # success, failed, pending
    amount: float
    currency: str
    payment_method: str
    
    transaction_id: str  # Gateway transaction ID
    timestamp: datetime
    
    receipt_url: Optional[str] = None
    statement_ids_applied: List[str] = []
    remaining_balance: float


class AppointmentRequest(BaseModel):
    """Patient appointment request"""
    patient_id: str
    appointment_type: str
    preferred_date_start: datetime
    preferred_date_end: Optional[datetime] = None
    preferred_times: List[str] = []  # morning, afternoon, evening
    
    provider_id: Optional[str] = None  # Specific provider preference
    reason: str
    notes: Optional[str] = None
    
    is_urgent: bool = False


class HealthRecordAccess(BaseModel):
    """Patient health record access request"""
    patient_id: str
    record_type: str  # lab_results, imaging, visit_notes, allergies, medications
    date_range_start: Optional[datetime] = None
    date_range_end: Optional[datetime] = None
    
    # HIPAA authorization tracking
    access_requested_at: datetime
    access_granted_at: Optional[datetime] = None
    access_purpose: str = "patient_review"


class CommunicationPreference(BaseModel):
    """Patient communication preferences"""
    patient_id: str
    
    # Email preferences
    email_enabled: bool = True
    email_statement_ready: bool = True
    email_payment_confirmation: bool = True
    email_appointment_reminder: bool = True
    
    # SMS preferences
    sms_enabled: bool = False
    sms_phone: Optional[str] = None
    sms_statement_ready: bool = True
    sms_payment_confirmation: bool = True
    sms_appointment_reminder: bool = True
    
    # Portal notifications
    browser_notifications: bool = False
    
    # Language
    preferred_language: str = "en"
    
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ==================== SECURITY ====================

security = HTTPBearer()

class PortalAuth:
    """Patient portal authentication"""
    
    def __init__(self, secret_key: str):
        self.secret_key = secret_key
        self.token_expiry_hours = 24
    
    def create_access_token(self, patient_id: str, email: str) -> str:
        """Create JWT access token"""
        payload = {
            "sub": patient_id,
            "email": email,
            "type": "patient_portal",
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(hours=self.token_expiry_hours)
        }
        return jwt.encode(payload, self.secret_key, algorithm="HS256")
    
    def verify_token(self, token: str) -> Dict[str, Any]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=["HS256"])
            if payload.get("type") != "patient_portal":
                raise HTTPException(status_code=401, detail="Invalid token type")
            return payload
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
    
    async def get_current_patient(
        self,
        credentials: HTTPAuthorizationCredentials = Security(security)
    ) -> Dict[str, Any]:
        """Dependency to get current authenticated patient"""
        token = credentials.credentials
        return self.verify_token(token)


# ==================== API ROUTER ====================

router = APIRouter(prefix="/patient-portal", tags=["Patient Portal"])
auth = PortalAuth(secret_key="your-secret-key-change-in-production")

# ==================== AUTHENTICATION ENDPOINTS ====================

@router.post("/auth/register")
async def register_patient_portal(
    patient_id: str,
    email: EmailStr,
    first_name: str,
    last_name: str,
    date_of_birth: str,
    phone: Optional[str] = None
):
    """
    Register for patient portal access
    
    Verifies patient identity against EHR system
    Sends verification email
    """
    # Verify patient exists in EHR
    # patient = await ehr_client.get_patient(patient_id)
    # if not patient:
    #     raise HTTPException(status_code=404, detail="Patient not found")
    
    # Check if already registered
    # existing = await db.patient_portal_users.find_one({"patient_id": patient_id})
    # if existing:
    #     raise HTTPException(status_code=400, detail="Patient already registered")
    
    # Create portal user
    portal_user = PatientPortalUser(
        patient_id=patient_id,
        email=email,
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        date_of_birth=date_of_birth,
        mrn=patient_id  # Placeholder
    )
    
    # Send verification email
    # await email_service.send_verification_email(email, verification_token)
    
    # Store in database
    # await db.patient_portal_users.insert_one(portal_user.dict())
    
    return {
        "success": True,
        "message": "Registration successful. Please verify your email.",
        "patient_id": patient_id
    }


@router.post("/auth/login")
async def login_patient_portal(email: EmailStr, password: str):
    """
    Login to patient portal
    
    Returns access token on successful authentication
    """
    # Verify credentials
    # user = await db.patient_portal_users.find_one({"email": email})
    # if not user or not verify_password(password, user["password_hash"]):
    #     raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Check if email verified
    # if not user.get("email_verified"):
    #     raise HTTPException(status_code=403, detail="Email not verified")
    
    # Check if account active
    # if not user.get("is_active"):
    #     raise HTTPException(status_code=403, detail="Account disabled")
    
    # Update last login
    # await db.patient_portal_users.update_one(
    #     {"patient_id": user["patient_id"]},
    #     {"$set": {"last_login": datetime.utcnow()}}
    # )
    
    # Create token
    # token = auth.create_access_token(user["patient_id"], email)
    
    return {
        "access_token": "placeholder-token",
        "token_type": "bearer",
        "expires_in": 86400,
        "patient_id": "placeholder-patient-id"
    }


@router.post("/auth/forgot-password")
async def forgot_password(email: EmailStr):
    """Request password reset"""
    # Generate reset token
    # Send reset email
    return {"message": "If an account exists, password reset instructions have been sent"}


@router.post("/auth/reset-password")
async def reset_password(token: str, new_password: str):
    """Reset password with token"""
    # Verify token
    # Update password
    return {"message": "Password reset successful"}


# ==================== STATEMENT ENDPOINTS ====================

@router.get("/statements", response_model=List[StatementSummary])
async def get_patient_statements(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get list of patient statements"""
    patient_id = current_patient["sub"]
    
    # Fetch from billing system
    # statements = await billing_service.get_patient_statements(patient_id)
    
    # Return sample data
    return [
        StatementSummary(
            statement_id="STMT-001",
            statement_date=datetime.utcnow() - timedelta(days=30),
            total_charges=1250.00,
            insurance_payments=800.00,
            patient_payments=0.00,
            adjustments=50.00,
            balance_due=400.00,
            status="open",
            visit_count=3
        ),
        StatementSummary(
            statement_id="STMT-002",
            statement_date=datetime.utcnow() - timedelta(days=60),
            total_charges=500.00,
            insurance_payments=400.00,
            patient_payments=100.00,
            adjustments=0.00,
            balance_due=0.00,
            status="closed",
            visit_count=1
        )
    ]


@router.get("/statements/{statement_id}", response_model=StatementDetail)
async def get_statement_detail(
    statement_id: str,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get detailed statement information"""
    # Verify statement belongs to patient
    # Fetch full statement details
    
    return StatementDetail(
        statement_id=statement_id,
        patient={
            "name": "John Doe",
            "address": "123 Main St, City, State 12345"
        },
        visits=[
            {
                "date": "2024-01-15",
                "provider": "Dr. Smith",
                "description": "Office Visit",
                "charges": 250.00
            }
        ],
        transactions=[
            {
                "date": "2024-02-01",
                "type": "insurance_payment",
                "description": "Insurance Payment",
                "amount": -200.00
            }
        ],
        summary=StatementSummary(
            statement_id=statement_id,
            statement_date=datetime.utcnow() - timedelta(days=30),
            total_charges=250.00,
            insurance_payments=200.00,
            patient_payments=0.00,
            adjustments=0.00,
            balance_due=50.00,
            status="open",
            visit_count=1
        )
    )


@router.get("/statements/{statement_id}/pdf")
async def download_statement_pdf(
    statement_id: str,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Download statement as PDF"""
    # Generate or retrieve PDF
    # Return file response
    return {"download_url": f"https://api.clinic-ops.ai/statements/{statement_id}/download"}


# ==================== PAYMENT ENDPOINTS ====================

@router.get("/payment-methods", response_model=List[PaymentMethod])
async def get_payment_methods(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get patient's stored payment methods"""
    patient_id = current_patient["sub"]
    
    # Return stored payment methods (masked)
    return [
        PaymentMethod(
            method_id="pm-001",
            patient_id=patient_id,
            type=PaymentMethodType.CREDIT_CARD,
            card_last4="4242",
            card_brand="visa",
            expiration_month=12,
            expiration_year=2025,
            is_default=True
        )
    ]


@router.post("/payment-methods")
async def add_payment_method(
    payment_method: Dict[str, Any],
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Add new payment method (tokenized)"""
    patient_id = current_patient["sub"]
    
    # Tokenize with payment gateway (Stripe, etc.)
    # Store token, not actual card number
    
    return {
        "method_id": "pm-new",
        "status": "added",
        "message": "Payment method added successfully"
    }


@router.delete("/payment-methods/{method_id}")
async def delete_payment_method(
    method_id: str,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Remove payment method"""
    # Verify method belongs to patient
    # Remove from payment gateway
    return {"message": "Payment method removed"}


@router.post("/payments", response_model=PaymentResult)
async def make_payment(
    request: PaymentRequest,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """
    Process patient payment
    
    Supports one-time payments and payment plan installments
    """
    patient_id = current_patient["sub"]
    
    # Verify patient owns the statements/claims
    # Process payment through gateway
    # Apply payment to statements
    # Send receipt
    
    return PaymentResult(
        payment_id="pay-001",
        status="success",
        amount=request.amount,
        currency=request.currency,
        payment_method=request.payment_method_id,
        transaction_id="txn-12345",
        timestamp=datetime.utcnow(),
        receipt_url="https://portal.clinic-ops.ai/receipts/pay-001",
        statement_ids_applied=request.statement_ids,
        remaining_balance=0.00
    )


@router.get("/payments/history")
async def get_payment_history(
    current_patient: Dict = Depends(auth.get_current_patient),
    limit: int = 20,
    offset: int = 0
):
    """Get payment history"""
    return {
        "payments": [
            {
                "payment_id": "pay-001",
                "date": "2024-01-20T10:30:00Z",
                "amount": 100.00,
                "method": "Visa ending in 4242",
                "applied_to": ["STMT-001"],
                "receipt_url": "..."
            }
        ],
        "total": 1
    }


# ==================== APPOINTMENT ENDPOINTS ====================

@router.get("/appointments")
async def get_appointments(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get patient's upcoming and past appointments"""
    patient_id = current_patient["sub"]
    
    return {
        "upcoming": [
            {
                "appointment_id": "appt-001",
                "date": "2024-02-15",
                "time": "10:00 AM",
                "provider": "Dr. Smith",
                "type": "Follow-up Visit",
                "location": "Main Office",
                "status": "confirmed",
                "can_cancel": True,
                "can_reschedule": True
            }
        ],
        "past": [
            {
                "appointment_id": "appt-000",
                "date": "2024-01-10",
                "provider": "Dr. Smith",
                "type": "Office Visit",
                "status": "completed"
            }
        ]
    }


@router.post("/appointments/request")
async def request_appointment(
    request: AppointmentRequest,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Request new appointment"""
    patient_id = current_patient["sub"]
    
    # Submit to scheduling system
    # Send confirmation
    
    return {
        "request_id": "req-001",
        "status": "pending",
        "message": "Appointment request submitted. You will be contacted within 24 hours."
    }


@router.post("/appointments/{appointment_id}/cancel")
async def cancel_appointment(
    appointment_id: str,
    reason: Optional[str] = None,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Cancel appointment"""
    # Verify appointment belongs to patient
    # Check cancellation policy
    # Cancel in scheduling system
    
    return {"message": "Appointment cancelled successfully"}


# ==================== HEALTH RECORDS ENDPOINTS ====================

@router.get("/health-records/summary")
async def get_health_records_summary(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get summary of available health records"""
    return {
        "categories": [
            {"type": "lab_results", "count": 12, "last_updated": "2024-01-15"},
            {"type": "imaging", "count": 3, "last_updated": "2023-12-10"},
            {"type": "visit_notes", "count": 45, "last_updated": "2024-01-20"},
            {"type": "medications", "count": 5, "last_updated": "2024-01-18"},
            {"type": "allergies", "count": 2, "last_updated": "2023-06-15"},
            {"type": "immunizations", "count": 8, "last_updated": "2023-09-20"}
        ]
    }


@router.get("/health-records/{record_type}")
async def get_health_records(
    record_type: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get specific type of health records"""
    patient_id = current_patient["sub"]
    
    # Log access for HIPAA compliance
    # access_log = HealthRecordAccess(
    #     patient_id=patient_id,
    #     record_type=record_type,
    #     date_range_start=start_date,
    #     date_range_end=end_date,
    #     access_requested_at=datetime.utcnow(),
    #     access_purpose="patient_review"
    # )
    # await log_record_access(access_log)
    
    # Fetch from EHR
    if record_type == "lab_results":
        return {
            "records": [
                {
                    "record_id": "lab-001",
                    "date": "2024-01-15",
                    "provider": "Quest Diagnostics",
                    "test": "Comprehensive Metabolic Panel",
                    "status": "final",
                    "results": [
                        {"name": "Glucose", "value": "95", "unit": "mg/dL", "reference": "70-100"},
                        {"name": "Sodium", "value": "140", "unit": "mEq/L", "reference": "136-145"}
                    ],
                    "pdf_url": "https://..."
                }
            ]
        }
    
    return {"records": []}


# ==================== COMMUNICATION PREFERENCES ====================

@router.get("/preferences")
async def get_communication_preferences(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get communication preferences"""
    patient_id = current_patient["sub"]
    
    return CommunicationPreference(
        patient_id=patient_id,
        email_enabled=True,
        email_statement_ready=True,
        sms_enabled=False,
        preferred_language="en"
    )


@router.put("/preferences")
async def update_communication_preferences(
    preferences: CommunicationPreference,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Update communication preferences"""
    patient_id = current_patient["sub"]
    
    # Update in database
    return {"message": "Preferences updated successfully"}


# ==================== PROFILE MANAGEMENT ====================

@router.get("/profile")
async def get_patient_profile(
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Get patient profile information"""
    patient_id = current_patient["sub"]
    
    return {
        "patient_id": patient_id,
        "name": "John Doe",
        "email": current_patient["email"],
        "phone": "+1-555-0123",
        "date_of_birth": "1985-03-15",
        "address": {
            "street": "123 Main Street",
            "city": "Anytown",
            "state": "CA",
            "zip": "12345"
        },
        "emergency_contact": {
            "name": "Jane Doe",
            "relationship": "Spouse",
            "phone": "+1-555-0456"
        },
        "insurance": {
            "primary": {
                "name": "Blue Cross Blue Shield",
                "policy_number": "BC123456789",
                "group_number": "GRP001"
            }
        }
    }


@router.put("/profile")
async def update_patient_profile(
    updates: Dict[str, Any],
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Update patient profile"""
    patient_id = current_patient["sub"]
    
    # Validate updates
    # Update in EHR and portal
    
    return {"message": "Profile updated successfully"}


@router.post("/profile/change-password")
async def change_password(
    current_password: str,
    new_password: str,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Change portal password"""
    patient_id = current_patient["sub"]
    
    # Verify current password
    # Update password hash
    
    return {"message": "Password changed successfully"}


# ==================== MESSAGING ====================

@router.get("/messages")
async def get_messages(
    current_patient: Dict = Depends(auth.get_current_patient),
    unread_only: bool = False
):
    """Get secure messages from practice"""
    return {
        "messages": [
            {
                "message_id": "msg-001",
                "from": "Billing Department",
                "subject": "Statement Ready",
                "preview": "Your January statement is now available...",
                "date": "2024-01-20",
                "unread": True
            }
        ],
        "unread_count": 1
    }


@router.post("/messages")
async def send_message(
    to_department: str,
    subject: str,
    message: str,
    current_patient: Dict = Depends(auth.get_current_patient)
):
    """Send secure message to practice"""
    return {
        "message_id": "msg-new",
        "status": "sent",
        "message": "Message sent successfully. You will receive a response within 1-2 business days."
    }
