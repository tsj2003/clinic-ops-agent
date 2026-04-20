# 🔑 FULL PRODUCTION - API KEYS CHECKLIST

**Goal:** All 17 services REAL - No mocks  
**Time:** 45 minutes  
**Cost:** ~$650/month  

---

## ✅ SIGNUP ORDER (Do in this sequence)

### TIER 1: CRITICAL (Start here - 15 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **Fireworks AI** | [fireworks.ai](https://fireworks.ai) | Sign up → Dashboard → Create API Key | 3 min | $20-50/mo |
| ⬜ | **MongoDB Atlas** | [mongodb.com/atlas](https://www.mongodb.com/atlas) | Create M10 cluster → Add user → Whitelist IP | 5 min | $60/mo |
| ⬜ | **JWT Secret** | Terminal | Run: `openssl rand -base64 32` | 1 min | FREE |
| ⬜ | **Fernet Key** | Terminal | Run: `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | 1 min | FREE |
| ⬜ | **API Secret** | Terminal | Generate random 32+ char string | 1 min | FREE |

**Fill these 5 in .env.local FIRST, then test:**
```bash
FIREWORKS_API_KEY=fw_your_key
MONGODB_ATLAS_URI=mongodb+srv://user:pass@cluster.mongodb.net/clinic_ops_prod
JWT_SECRET=your_jwt_secret
FERNET_KEY=your_fernet_key=
API_SECRET_KEY=your_api_secret
```

---

### TIER 2: AI/ML Services (10 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **TinyFish** | [tinyfish.ai](https://tinyfish.ai) | Request beta access → Wait for approval → Get key | 5 min | Contact sales |
| ⬜ | **Mixedbread** | [mixedbread.ai](https://mixedbread.ai) | Sign up → API Keys → Copy | 2 min | $5-10/mo |
| ⬜ | **AgentOps** | [agentops.ai](https://agentops.ai) | Sign up → Copy API key | 2 min | FREE tier |
| ⬜ | **Axiom** | [axiom.co](https://axiom.co) | Sign up → Create dataset → Copy ingest key | 1 min | FREE tier |

**Add to .env.local:**
```bash
TINYFISH_API_KEY=tf_your_key
TINYFISH_MODE=live
TINYFISH_API_BASE_URL=https://agent.tinyfish.ai

MIXEDBREAD_API_KEY=mb_your_key

AGENTOPS_API_KEY=ao_your_key

AXIOM_API_KEY=xaat-your-key
AXIOM_DATASET=clinic-ops-prod
```

---

### TIER 3: EHR Integrations (10 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **Epic FHIR** | [fhir.epic.com](https://fhir.epic.com) | Register → Create app → Get client ID/secret | 4 min | Contact Epic for prod |
| ⬜ | **Cerner** | [code.cerner.com](https://code.cerner.com) | Register → Create app → Get credentials | 3 min | Contact sales |
| ⬜ | **athenahealth** | [docs.athenahealth.com/api](https://docs.athenahealth.com/api) | Sign up → Get practice ID + keys | 3 min | Included with subscription |

**Add to .env.local:**
```bash
# Epic
EPIC_CLIENT_ID=your-epic-client-id
EPIC_CLIENT_SECRET=your-epic-secret
EPIC_FHIR_URL=https://fhir.epic.com/interconnect-fhir-oauth

# Cerner
CERNER_CLIENT_ID=your-cerner-id
CERNER_CLIENT_SECRET=your-cerner-secret
CERNER_TENANT_ID=your-tenant

# athenahealth
ATHENA_PRACTICE_ID=your-practice-id
ATHENA_CLIENT_ID=your-athena-id
ATHENA_CLIENT_SECRET=your-athena-secret
```

---

### TIER 4: Clearinghouses (5 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **Waystar** | [waystar.com](https://waystar.com) | Contact sales → Get API credentials | 3 min | Per claim |
| ⬜ | **Change Healthcare** | [developers.changehealthcare.com](https://developers.changehealthcare.com) | Register → Create app → Get sandbox keys | 2 min | Per transaction |

**Add to .env.local:**
```bash
# Waystar
WAYSTAR_API_KEY=ws_your_key
WAYSTAR_CLIENT_ID=your-client-id
WAYSTAR_CLIENT_SECRET=your-secret
WAYSTAR_BASE_URL=https://api.waystar.com

# Change Healthcare
CHANGE_HEALTHCARE_CLIENT_ID=your-ch-id
CHANGE_HEALTHCARE_CLIENT_SECRET=your-ch-secret
CHANGE_HEALTHCARE_TOKEN_URL=https://api.changehealthcare.com/apigateway
```

---

### TIER 5: Communications (5 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **Twilio** | [twilio.com](https://twilio.com) | Sign up → Get Account SID + Auth Token → Buy number | 3 min | $7.50/1000 SMS |
| ⬜ | **SendGrid** | [sendgrid.com](https://sendgrid.com) | Sign up → Create API key | 2 min | FREE tier |

**Add to .env.local:**
```bash
TWILIO_ACCOUNT_SID=AC_your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

SENDGRID_API_KEY=SG.your_key
```

---

### TIER 6: Infrastructure (5 mins)

| # | Service | URL | Action | Time | Cost |
|---|---------|-----|--------|------|------|
| ⬜ | **Redis (Upstash)** | [upstash.com](https://upstash.com) | Sign up → Create Redis → Copy URL | 2 min | FREE tier |
| ⬜ | **MinIO/S3** | AWS Console | Create bucket → Get access keys | 3 min | ~$5/mo |

**Add to .env.local:**
```bash
REDIS_URL=rediss://default:password@your-redis.upstash.io:6379

MINIO_ENDPOINT=https://s3.amazonaws.com
MINIO_ACCESS_KEY=your-aws-access-key
MINIO_SECRET_KEY=your-aws-secret-key
MINIO_BUCKET=clinic-ops-production
```

---

## 🎯 QUICK SIGNUP LINKS

**Open all at once:**
```bash
open https://fireworks.ai
open https://www.mongodb.com/cloud/atlas
open https://tinyfish.ai
open https://mixedbread.ai
open https://agentops.ai
open https://axiom.co
open https://twilio.com
open https://sendgrid.com
open https://upstash.com
open https://fhir.epic.com
open https://waystar.com
```

---

## 📝 COPY-PASTE TEMPLATE

Create `.env.local` with this complete template:

```bash
# ============================================
# PRODUCTION - ALL SERVICES REAL
# ============================================

ENVIRONMENT=production
DEBUG=false

# TIER 1: CRITICAL
FIREWORKS_API_KEY=fw_
MONGODB_ATLAS_URI=mongodb+srv://:password@.mongodb.net/clinic_ops_prod?retryWrites=true&w=majority
JWT_SECRET=
FERNET_KEY=
API_SECRET_KEY=

# TIER 2: AI/ML
TINYFISH_API_KEY=tf_
TINYFISH_MODE=live
TINYFISH_API_BASE_URL=https://agent.tinyfish.ai
MIXEDBREAD_API_KEY=mb_
AGENTOPS_API_KEY=ao_
AXIOM_API_KEY=xaat-
AXIOM_DATASET=clinic-ops-prod

# TIER 3: EHR
EPIC_CLIENT_ID=
EPIC_CLIENT_SECRET=
EPIC_FHIR_URL=https://fhir.epic.com/interconnect-fhir-oauth
CERNER_CLIENT_ID=
CERNER_CLIENT_SECRET=
CERNER_TENANT_ID=
ATHENA_PRACTICE_ID=
ATHENA_CLIENT_ID=
ATHENA_CLIENT_SECRET=

# TIER 4: CLEARINGHOUSES
WAYSTAR_API_KEY=ws_
WAYSTAR_CLIENT_ID=
WAYSTAR_CLIENT_SECRET=
WAYSTAR_BASE_URL=https://api.waystar.com
CHANGE_HEALTHCARE_CLIENT_ID=
CHANGE_HEALTHCARE_CLIENT_SECRET=
CHANGE_HEALTHCARE_TOKEN_URL=https://api.changehealthcare.com/apigateway

# TIER 5: COMMUNICATIONS
TWILIO_ACCOUNT_SID=AC_
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+
SENDGRID_API_KEY=SG.

# TIER 6: INFRASTRUCTURE
REDIS_URL=rediss://default:@.upstash.io:6379
MINIO_ENDPOINT=https://s3.amazonaws.com
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=clinic-ops-production

# SECURITY
RATE_LIMIT_REQUESTS_PER_MINUTE=60
CORS_ALLOWED_ORIGINS=https://clinic-ops.ai
MAX_UPLOAD_SIZE_MB=50
SESSION_TIMEOUT_HOURS=24

# COMPLIANCE
HIPAA_BAA_ENABLED=true
BAA_AGREEMENT_ID=baa_2025_001
DATA_RETENTION_YEARS=7
```

---

## 🚀 DEPLOY COMMAND

After filling ALL keys:

```bash
cd /Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise

# Make script executable
chmod +x FULL_PRODUCTION_SETUP.sh

# Run full setup
./FULL_PRODUCTION_SETUP.sh
```

---

## 💰 COST SUMMARY

| Category | Services | Monthly Cost |
|----------|----------|--------------|
| AI/ML | Fireworks, TinyFish, Mixedbread | $525-550 |
| Database | MongoDB Atlas M10 | $60 |
| Communications | Twilio, SendGrid | $10-20 |
| Infrastructure | Redis, S3 | $5-10 |
| Monitoring | AgentOps, Axiom | FREE |
| **TOTAL** | | **~$600-650** |

---

## ✅ VERIFICATION

After starting, verify all services:

```bash
# 1. API Health
curl http://localhost:8000/health

# 2. Fireworks AI Test
curl -X POST http://localhost:8000/api/v2/denial-management/pre-submission-check \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"PAT-001","cpt_code":"99214","payer":"Aetna","billed_amount":450}'

# 3. Check AgentOps Dashboard
echo "Open https://app.agentops.ai to see traces"

# 4. Check Axiom Logs
echo "Open https://axiom.co to see structured logs"

# 5. Dashboard
echo "Open file:///Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise/frontend/dashboard.html"
```

---

**Ready? Start with Tier 1 (Fireworks + MongoDB + secrets) and work down!** 🚀
