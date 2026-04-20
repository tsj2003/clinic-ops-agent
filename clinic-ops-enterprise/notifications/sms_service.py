"""
SMS Notification Service
Multi-provider SMS delivery (Twilio, AWS SNS, MessageBird)
for appointment reminders, payment notifications, and alerts
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
import re


class SMSProvider(str, Enum):
    """Supported SMS providers"""
    TWILIO = "twilio"
    AWS_SNS = "aws_sns"
    MESSAGEBIRD = "messagebird"
    TELNYX = "telnyx"


class MessageType(str, Enum):
    """Types of SMS messages"""
    APPOINTMENT_REMINDER = "appointment_reminder"
    APPOINTMENT_CONFIRMATION = "appointment_confirmation"
    PAYMENT_REMINDER = "payment_reminder"
    PAYMENT_CONFIRMATION = "payment_confirmation"
    STATEMENT_READY = "statement_ready"
    CLAIM_STATUS_UPDATE = "claim_status_update"
    DENIAL_ALERT = "denial_alert"
    TWO_FACTOR_AUTH = "two_factor_auth"
    MARKETING = "marketing"  # Requires opt-in
    EMERGENCY = "emergency"


class MessagePriority(str, Enum):
    """Message priority levels"""
    LOW = "low"           # Marketing, non-urgent
    NORMAL = "normal"     # Standard notifications
    HIGH = "high"         # Payment reminders, status updates
    URGENT = "urgent"     # Critical alerts, 2FA


@dataclass
class SMSMessage:
    """SMS message structure"""
    message_id: str
    to_phone: str
    message_type: MessageType
    body: str
    priority: MessagePriority
    scheduled_time: Optional[datetime] = None
    sent_time: Optional[datetime] = None
    delivered_time: Optional[datetime] = None
    status: str = "pending"  # pending, queued, sent, delivered, failed
    provider: Optional[SMSProvider] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    metadata: Dict[str, Any] = None


class SMSConfig(BaseModel):
    """SMS service configuration"""
    # Provider settings
    primary_provider: SMSProvider = Field(default=SMSProvider.TWILIO)
    fallback_enabled: bool = True
    
    # Twilio settings
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_from_number: Optional[str] = None
    
    # AWS SNS settings
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_region: str = "us-east-1"
    
    # MessageBird settings
    messagebird_api_key: Optional[str] = None
    
    # Telnyx settings
    telnyx_api_key: Optional[str] = None
    telnyx_from_number: Optional[str] = None
    
    # Rate limiting
    max_messages_per_second: int = Field(default=10, ge=1, le=100)
    max_messages_per_minute: int = Field(default=300, ge=10, le=1000)
    
    # Retry settings
    retry_delay_seconds: int = Field(default=60, ge=10, le=300)
    max_retry_attempts: int = Field(default=3, ge=1, le=5)
    
    # Compliance
    require_opt_in: bool = True
    opt_out_keywords: List[str] = Field(default=["STOP", "UNSUBSCRIBE", "QUIT"])
    honor_quiet_hours: bool = True
    quiet_hours_start: int = Field(default=21, ge=0, le=23)  # 9 PM
    quiet_hours_end: int = Field(default=8, ge=0, le=23)    # 8 AM


class SMSService:
    """
    Multi-provider SMS notification service
    
    Features:
    - Multi-provider support with automatic failover
    - Message queuing and rate limiting
    - Scheduled message delivery
    - Opt-in/opt-out compliance
    - Delivery tracking and analytics
    - Template management
    """
    
    def __init__(self, config: SMSConfig):
        self.config = config
        self.message_queue: asyncio.Queue = asyncio.Queue()
        self.rate_limiter = RateLimiter(
            max_per_second=config.max_messages_per_second,
            max_per_minute=config.max_messages_per_minute
        )
        self.delivery_callbacks: List[Callable] = []
        self.opt_out_list: set = set()  # Phone numbers that opted out
        
        # Provider clients (initialized on demand)
        self._twilio_client = None
        self._sns_client = None
        self._messagebird_client = None
        self._telnyx_client = None
    
    async def start(self):
        """Start the SMS service worker"""
        asyncio.create_task(self._process_queue())
    
    # ==================== PROVIDER INITIALIZATION ====================
    
    def _get_twilio_client(self):
        """Get or create Twilio client"""
        if self._twilio_client is None:
            from twilio.rest import Client
            self._twilio_client = Client(
                self.config.twilio_account_sid,
                self.config.twilio_auth_token
            )
        return self._twilio_client
    
    def _get_sns_client(self):
        """Get or create AWS SNS client"""
        if self._sns_client is None:
            import boto3
            self._sns_client = boto3.client(
                'sns',
                aws_access_key_id=self.config.aws_access_key_id,
                aws_secret_access_key=self.config.aws_secret_access_key,
                region_name=self.config.aws_region
            )
        return self._sns_client
    
    # ==================== MESSAGE TEMPLATES ====================
    
    TEMPLATES: Dict[MessageType, str] = {
        MessageType.APPOINTMENT_REMINDER: (
            "Reminder: You have an appointment with {provider_name} "
            "on {appointment_date} at {appointment_time}. "
            "Reply CONFIRM to confirm or CANCEL to cancel."
        ),
        MessageType.APPOINTMENT_CONFIRMATION: (
            "Your appointment with {provider_name} is confirmed for "
            "{appointment_date} at {appointment_time}. "
            "Location: {location}. Reply HELP for assistance."
        ),
        MessageType.PAYMENT_REMINDER: (
            "Payment reminder: Your balance of ${balance_due} is due by {due_date}. "
            "Pay online at {payment_link} or call {phone}."
        ),
        MessageType.PAYMENT_CONFIRMATION: (
            "Thank you for your payment of ${amount}. Your confirmation "
            "number is {confirmation_number}. Balance remaining: ${remaining_balance}."
        ),
        MessageType.STATEMENT_READY: (
            "Your monthly statement is ready. Balance: ${balance}. "
            "View and pay at {portal_link}"
        ),
        MessageType.CLAIM_STATUS_UPDATE: (
            "Claim #{claim_id} status: {status}. Amount: ${amount}. "
            "View details: {portal_link}"
        ),
        MessageType.DENIAL_ALERT: (
            "URGENT: Claim #{claim_id} was denied. Reason: {denial_reason}. "
            "Call {phone} to discuss appeal options."
        ),
        MessageType.TWO_FACTOR_AUTH: (
            "Your Clinic Ops verification code is: {code}. "
            "This code expires in 10 minutes."
        ),
    }
    
    def format_message(
        self,
        message_type: MessageType,
        variables: Dict[str, str]
    ) -> str:
        """Format message from template"""
        template = self.TEMPLATES.get(message_type, "")
        
        try:
            return template.format(**variables)
        except KeyError as e:
            # Missing variable, return template with placeholders
            return template
    
    # ==================== MESSAGE QUEUING ====================
    
    async def send_message(
        self,
        to_phone: str,
        message_type: MessageType,
        variables: Dict[str, str],
        priority: MessagePriority = MessagePriority.NORMAL,
        scheduled_time: Optional[datetime] = None
    ) -> str:
        """
        Queue an SMS message for delivery
        
        Returns message ID for tracking
        """
        # Normalize phone number
        to_phone = self._normalize_phone(to_phone)
        
        # Check opt-out status
        if self.config.require_opt_in and to_phone in self.opt_out_list:
            raise ValueError(f"Phone number {to_phone} has opted out")
        
        # Format message
        body = self.format_message(message_type, variables)
        
        # Check quiet hours
        if self.config.honor_quiet_hours and priority != MessagePriority.URGENT:
            if self._is_quiet_hours():
                # Schedule for after quiet hours
                scheduled_time = self._next_allowed_time()
        
        # Create message
        message_id = self._generate_message_id()
        message = SMSMessage(
            message_id=message_id,
            to_phone=to_phone,
            message_type=message_type,
            body=body,
            priority=priority,
            scheduled_time=scheduled_time,
            metadata={"variables": variables}
        )
        
        # Add to queue
        await self.message_queue.put(message)
        
        return message_id
    
    async def send_bulk_messages(
        self,
        recipients: List[Dict[str, Any]],
        message_type: MessageType,
        priority: MessagePriority = MessagePriority.NORMAL
    ) -> List[str]:
        """Send messages to multiple recipients"""
        message_ids = []
        
        for recipient in recipients:
            try:
                message_id = await self.send_message(
                    to_phone=recipient["phone"],
                    message_type=message_type,
                    variables=recipient.get("variables", {}),
                    priority=priority
                )
                message_ids.append(message_id)
            except Exception as e:
                # Log error but continue with other recipients
                print(f"Failed to queue message for {recipient.get('phone')}: {e}")
        
        return message_ids
    
    # ==================== QUEUE PROCESSING ====================
    
    async def _process_queue(self):
        """Background worker to process message queue"""
        while True:
            try:
                message: SMSMessage = await self.message_queue.get()
                
                # Check if scheduled for later
                if message.scheduled_time and message.scheduled_time > datetime.utcnow():
                    # Re-queue with delay
                    await asyncio.sleep((message.scheduled_time - datetime.utcnow()).total_seconds())
                
                # Check rate limit
                await self.rate_limiter.acquire()
                
                # Send message
                await self._send_via_provider(message)
                
                self.message_queue.task_done()
                
            except Exception as e:
                print(f"Error processing SMS queue: {e}")
                await asyncio.sleep(1)
    
    async def _send_via_provider(self, message: SMSMessage):
        """Send message through configured provider"""
        providers = [self.config.primary_provider]
        
        if self.config.fallback_enabled:
            # Add fallback providers
            all_providers = [p for p in SMSProvider]
            for provider in all_providers:
                if provider not in providers:
                    providers.append(provider)
        
        for provider in providers:
            try:
                if provider == SMSProvider.TWILIO:
                    result = await self._send_twilio(message)
                elif provider == SMSProvider.AWS_SNS:
                    result = await self._send_sns(message)
                elif provider == SMSProvider.MESSAGEBIRD:
                    result = await self._send_messagebird(message)
                elif provider == SMSProvider.TELNYX:
                    result = await self._send_telnyx(message)
                else:
                    continue
                
                if result["success"]:
                    message.status = "sent"
                    message.provider = provider
                    message.sent_time = datetime.utcnow()
                    
                    # Trigger callbacks
                    for callback in self.delivery_callbacks:
                        await callback(message)
                    
                    return
                    
            except Exception as e:
                message.error_message = str(e)
                message.retry_count += 1
                
                if message.retry_count >= message.max_retries:
                    message.status = "failed"
                    break
                
                # Wait before retry
                await asyncio.sleep(self.config.retry_delay_seconds)
        
        # If we get here, all providers failed
        message.status = "failed"
    
    async def _send_twilio(self, message: SMSMessage) -> Dict[str, Any]:
        """Send via Twilio"""
        client = self._get_twilio_client()
        
        result = client.messages.create(
            body=message.body,
            from_=self.config.twilio_from_number,
            to=message.to_phone
        )
        
        return {
            "success": result.sid is not None,
            "provider_message_id": result.sid,
            "status": result.status
        }
    
    async def _send_sns(self, message: SMSMessage) -> Dict[str, Any]:
        """Send via AWS SNS"""
        client = self._get_sns_client()
        
        # Format phone for SNS (E.164)
        phone = message.to_phone
        if not phone.startswith("+"):
            phone = "+" + phone
        
        result = client.publish(
            PhoneNumber=phone,
            Message=message.body,
            MessageAttributes={
                'SMSType': {
                    'DataType': 'String',
                    'StringValue': 'Transactional' if message.priority in [MessagePriority.HIGH, MessagePriority.URGENT] else 'Promotional'
                }
            }
        )
        
        return {
            "success": "MessageId" in result,
            "provider_message_id": result.get("MessageId")
        }
    
    async def _send_messagebird(self, message: SMSMessage) -> Dict[str, Any]:
        """Send via MessageBird"""
        # Implementation would use MessageBird SDK
        return {"success": False, "error": "Not implemented"}
    
    async def _send_telnyx(self, message: SMSMessage) -> Dict[str, Any]:
        """Send via Telnyx"""
        # Implementation would use Telnyx SDK
        return {"success": False, "error": "Not implemented"}
    
    # ==================== DELIVERY TRACKING ====================
    
    async def handle_delivery_status(
        self,
        provider: SMSProvider,
        provider_message_id: str,
        status: str,
        timestamp: datetime
    ):
        """Handle delivery status update from provider webhook"""
        # Update message status in database
        # Trigger callbacks
        pass
    
    def register_delivery_callback(self, callback: Callable):
        """Register callback for delivery status updates"""
        self.delivery_callbacks.append(callback)
    
    # ==================== OPT-OUT MANAGEMENT ====================
    
    def process_opt_out(self, phone_number: str, keyword: str):
        """Process opt-out request"""
        normalized = self._normalize_phone(phone_number)
        
        if keyword.upper() in [k.upper() for k in self.config.opt_out_keywords]:
            self.opt_out_list.add(normalized)
            return True
        
        return False
    
    def process_opt_in(self, phone_number: str):
        """Process opt-in request"""
        normalized = self._normalize_phone(phone_number)
        self.opt_out_list.discard(normalized)
    
    def is_opted_out(self, phone_number: str) -> bool:
        """Check if phone number has opted out"""
        return self._normalize_phone(phone_number) in self.opt_out_list
    
    # ==================== UTILITY METHODS ====================
    
    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone number to E.164 format"""
        # Remove non-numeric characters
        digits = re.sub(r'\D', '', phone)
        
        # Add country code if missing (assuming US)
        if len(digits) == 10:
            digits = "1" + digits
        
        return "+" + digits
    
    def _is_quiet_hours(self) -> bool:
        """Check if currently in quiet hours"""
        now = datetime.utcnow()
        hour = now.hour
        
        if self.config.quiet_hours_start > self.config.quiet_hours_end:
            # Overnight quiet hours (e.g., 9 PM to 8 AM)
            return hour >= self.config.quiet_hours_start or hour < self.config.quiet_hours_end
        else:
            return self.config.quiet_hours_start <= hour < self.config.quiet_hours_end
    
    def _next_allowed_time(self) -> datetime:
        """Get next time outside quiet hours"""
        now = datetime.utcnow()
        
        if self.config.quiet_hours_start > self.config.quiet_hours_end:
            # Overnight quiet hours
            if now.hour >= self.config.quiet_hours_start:
                # After quiet hours start, next allowed is tomorrow morning
                return (now + timedelta(days=1)).replace(
                    hour=self.config.quiet_hours_end,
                    minute=0,
                    second=0
                )
            elif now.hour < self.config.quiet_hours_end:
                # During quiet hours, next allowed is this morning
                return now.replace(
                    hour=self.config.quiet_hours_end,
                    minute=0,
                    second=0
                )
        
        return now
    
    def _generate_message_id(self) -> str:
        """Generate unique message ID"""
        import uuid
        return f"SMS-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    
    # ==================== ANALYTICS ====================
    
    async def get_delivery_stats(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """Get SMS delivery statistics"""
        # Query database for stats
        return {
            "total_sent": 0,
            "delivered": 0,
            "failed": 0,
            "pending": 0,
            "delivery_rate": 0.0,
            "average_delivery_time_seconds": 0
        }


class RateLimiter:
    """Rate limiter for SMS sending"""
    
    def __init__(self, max_per_second: int, max_per_minute: int):
        self.max_per_second = max_per_second
        self.max_per_minute = max_per_minute
        self.second_bucket: List[datetime] = []
        self.minute_bucket: List[datetime] = []
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Acquire rate limit token"""
        async with self._lock:
            now = datetime.utcnow()
            
            # Clean old entries
            self.second_bucket = [
                t for t in self.second_bucket
                if now - t < timedelta(seconds=1)
            ]
            self.minute_bucket = [
                t for t in self.minute_bucket
                if now - t < timedelta(minutes=1)
            ]
            
            # Check limits
            while len(self.second_bucket) >= self.max_per_second:
                await asyncio.sleep(0.1)
                now = datetime.utcnow()
                self.second_bucket = [
                    t for t in self.second_bucket
                    if now - t < timedelta(seconds=1)
                ]
            
            while len(self.minute_bucket) >= self.max_per_minute:
                await asyncio.sleep(1)
                now = datetime.utcnow()
                self.minute_bucket = [
                    t for t in self.minute_bucket
                    if now - t < timedelta(minutes=1)
                ]
            
            # Add current timestamp
            self.second_bucket.append(now)
            self.minute_bucket.append(now)


# ==================== API ENDPOINTS ====================

async def send_sms_endpoint(
    to_phone: str,
    message_type: MessageType,
    variables: Dict[str, str]
) -> Dict[str, Any]:
    """API endpoint to send SMS"""
    config = SMSConfig()  # Load from environment
    service = SMSService(config)
    await service.start()
    
    message_id = await service.send_message(
        to_phone=to_phone,
        message_type=message_type,
        variables=variables
    )
    
    return {
        "success": True,
        "message_id": message_id,
        "status": "queued"
    }


async def handle_twilio_webhook(
    request_body: Dict[str, Any]
) -> Dict[str, Any]:
    """Handle Twilio delivery status webhook"""
    # Extract status info
    message_sid = request_body.get("MessageSid")
    status = request_body.get("MessageStatus")
    to = request_body.get("To")
    
    # Update message status
    return {"success": True}


async def handle_incoming_sms(
    from_phone: str,
    body: str
) -> str:
    """Handle incoming SMS (opt-out, replies, etc.)"""
    config = SMSConfig()
    service = SMSService(config)
    
    # Check for opt-out keywords
    if service.process_opt_out(from_phone, body):
        return "You have been unsubscribed. Reply START to resubscribe."
    
    # Check for opt-in
    if body.upper() in ["START", "SUBSCRIBE", "YES"]:
        service.process_opt_in(from_phone)
        return "You are now subscribed to notifications."
    
    # Handle appointment confirmations
    if body.upper() == "CONFIRM":
        # Process confirmation
        return "Your appointment is confirmed."
    
    if body.upper() == "CANCEL":
        # Process cancellation
        return "Your appointment has been cancelled."
    
    return "Reply STOP to unsubscribe. Call (555) 123-4567 for assistance."
