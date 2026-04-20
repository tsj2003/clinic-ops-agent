# Clinic Ops Agent - API Integration Guide

## Quick Start (5 minutes)

### 1. Get API Key
```bash
# Sign up at https://clinic-ops.ai
# Copy your API key from dashboard
export CLINIC_OPS_API_KEY="your_api_key_here"
```

### 2. Test Connection
```bash
curl -X GET https://api.clinic-ops.ai/v2/health
```

### 3. Submit First Claim
```bash
curl -X POST https://api.clinic-ops.ai/v2/claims \
  -H "Authorization: Bearer $CLINIC_OPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "PT-12345",
    "procedure_code": "99213",
    "diagnosis_codes": ["M25.561"],
    "provider_npi": "1234567890",
    "payer_id": "aetna",
    "place_of_service": "11",
    "clinical_notes": "Patient presents with knee pain..."
  }'
```

---

## Authentication

All API requests require a Bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

For white-label deployments, also include:
```
X-Tenant-ID: your_tenant_id
```

---

## Core Workflows

### Workflow 1: Prior Authorization

```python
import requests

# Step 1: Submit claim with AI analysis
response = requests.post(
    "https://api.clinic-ops.ai/v2/claims",
    headers={"Authorization": "Bearer YOUR_KEY"},
    json={
        "patient_id": "PT-001",
        "procedure_code": "99285",
        "diagnosis_codes": ["R50.9", "R06.02"],
        "provider_npi": "1234567890",
        "payer_id": "united_healthcare",
        "clinical_notes": "Emergency department visit..."
    }
)

claim = response.json()
print(f"Claim created: {claim['claim_id']}")

# Step 2: AI pre-submission analysis
analysis = requests.post(
    f"https://api.clinic-ops.ai/v2/claims/{claim['claim_id']}/analyze",
    headers={"Authorization": "Bearer YOUR_KEY"},
    json={"include_nlp_analysis": True}
).json()

print(f"Risk score: {analysis['risk_score']}")
print(f"Can submit: {analysis['submission_readiness']}")

# Step 3: Submit to payer
submission = requests.post(
    f"https://api.clinic-ops.ai/v2/claims/{claim['claim_id']}/submit",
    headers={"Authorization": "Bearer YOUR_KEY"}
).json()

print(f"Submission ID: {submission['submission_id']}")
```

### Workflow 2: Denial Management

```python
# Step 1: List denied claims
denials = requests.get(
    "https://api.clinic-ops.ai/v2/denials?status=new&urgency=high",
    headers={"Authorization": "Bearer YOUR_KEY"}
).json()

# Step 2: AI analysis of each denial
for denial in denials['denials']:
    analysis = requests.post(
        f"https://api.clinic-ops.ai/v2/denials/{denial['denial_id']}/analyze",
        headers={"Authorization": "Bearer YOUR_KEY"}
    ).json()
    
    print(f"Appeal probability: {analysis['appeal_probability']}")
    print(f"Recommended strategy: {analysis['recommended_strategy']}")

# Step 3: Generate and submit appeal
appeal = requests.post(
    f"https://api.clinic-ops.ai/v2/denials/{denial['denial_id']}/appeal",
    headers={"Authorization": "Bearer YOUR_KEY"},
    json={"submit_immediately": True}
).json()

print(f"Appeal submitted: {appeal['confirmation_number']}")
```

### Workflow 3: Payer Behavior Analytics

```python
# Get payer behavior insights
analytics = requests.get(
    "https://api.clinic-ops.ai/v2/analytics/payer-behavior?payer_id=aetna&period=30d",
    headers={"Authorization": "Bearer YOUR_KEY"}
).json()

print(f"Approval rate: {analytics['metrics']['approval_rate']}")
print(f"Denial rate: {analytics['metrics']['denial_rate']}")
print(f"Contract leverage score: {analytics['contract_leverage_score']}")
```

---

## Webhooks

Configure webhooks to receive real-time updates:

```bash
POST /webhooks/configure
{
  "url": "https://your-clinic.com/webhooks/clinic-ops",
  "events": [
    "claim.status_changed",
    "denial.detected",
    "appeal.submitted",
    "payment.received"
  ],
  "secret": "your_webhook_secret"
}
```

### Webhook Payload Example
```json
{
  "event": "claim.status_changed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "claim_id": "CLM-12345",
    "previous_status": "pending",
    "new_status": "approved",
    "payer_response": "Authorization approved"
  }
}
```

---

## Error Handling

### Common HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad Request | Check request format |
| 401 | Unauthorized | Check API key |
| 429 | Rate Limited | Wait and retry |
| 500 | Server Error | Contact support |

### Error Response Format
```json
{
  "error": "Invalid procedure code",
  "code": "INVALID_PROCEDURE_CODE",
  "details": {
    "field": "procedure_code",
    "provided": "99999",
    "suggestion": "Use valid CPT/HCPCS code"
  }
}
```

---

## Rate Limits

| Tier | Requests/Hour | Burst |
|------|--------------|-------|
| Starter | 1,000 | 100/min |
| Professional | 5,000 | 500/min |
| Enterprise | 25,000 | 2,500/min |
| Unlimited | 100,000 | 10,000/min |

**Rate limit headers:**
```
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4999
X-RateLimit-Reset: 1640995200
```

---

## SDK Examples

### Python SDK
```bash
pip install clinic-ops-sdk
```

```python
from clinic_ops import Client

client = Client(api_key="YOUR_KEY")

# Submit claim
claim = client.claims.submit(
    patient_id="PT-001",
    procedure_code="99213",
    diagnosis_codes=["M25.561"],
    provider_npi="1234567890",
    payer_id="aetna"
)

# Check status
status = client.claims.get(claim.id)
print(status.ai_analysis.risk_score)
```

### Node.js SDK
```bash
npm install clinic-ops-sdk
```

```javascript
const { Client } = require('clinic-ops-sdk');

const client = new Client({ apiKey: 'YOUR_KEY' });

// Submit claim
const claim = await client.claims.submit({
  patientId: 'PT-001',
  procedureCode: '99213',
  diagnosisCodes: ['M25.561'],
  providerNpi: '1234567890',
  payerId: 'aetna'
});

// Check status
const status = await client.claims.get(claim.id);
console.log(status.aiAnalysis.riskScore);
```

---

## White-Label Integration (BPO)

For billing companies and RCM BPOs:

```python
# Include tenant ID in headers
headers = {
    "Authorization": "Bearer YOUR_KEY",
    "X-Tenant-ID": "TENANT-ABC123"
}

# All requests are isolated to your tenant
response = requests.post(
    "https://api.clinic-ops.ai/v2/claims",
    headers=headers,
    json={...}
)
```

### Tenant-Specific Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /analytics/dashboard` | Tenant-scoped metrics |
| `GET /claims` | Only tenant's claims |
| `GET /denials` | Only tenant's denials |

---

## Support

- **Documentation**: https://docs.clinic-ops.ai
- **API Status**: https://status.clinic-ops.ai
- **Support Email**: api-support@clinic-ops.ai
- **Discord**: https://discord.gg/clinic-ops

---

## Changelog

### v2.0.0 (2024-01-15)
- Added AI-to-AI negotiation endpoints
- Added underpayment recovery
- Added payer behavior analytics
- Added white-label multi-tenant support
- Improved rate limits

### v1.5.0 (2023-12-01)
- Added pharmacy/DME workflows
- Added contract analysis
- Enhanced pre-submission engine

### v1.0.0 (2023-10-01)
- Initial release
- Core claims and denial management
