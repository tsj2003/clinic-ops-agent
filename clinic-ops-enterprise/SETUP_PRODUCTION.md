# 🚀 PRODUCTION SETUP GUIDE

**Goal:** Get ALL real services working - see the actual product in action

---

## 📊 WHAT YOU'LL SEE WITH REAL SERVICES

| Feature | Mock Mode | Real Production |
|---------|-----------|-----------------|
| Denial Prediction | Random 70-90% | Actual AI inference with Fireworks |
| Appeal Letters | Template text | GPT-4 generated, payer-specific |
| Payer Portals | Simulated | Real Aetna/United/Cigna scraping |
| CAPTCHA Solving | Skipped | TinyFish AI solves it |
| Audit Logs | Local only | Axiom + Tamper-evident chain |
| Agent Tracing | Console logs | AgentOps full observability |
| EHR Integration | Fake data | Real Epic/Cerner FHIR calls |
| Claims Submission | Simulated | Actual Waystar/Change Healthcare |
| SMS Notifications | Console only | Real Twilio SMS to phone |
| Vector Search | In-memory | Mixedbread embeddings |

---

## 🎯 OPTION A: FULL PRODUCTION (~$650/month)

### Step 1: Get ALL API Keys (30 minutes)

```bash
# 1. Fireworks AI (5 mins)
# https://fireworks.ai → Sign up → API Keys → Create
# Cost: $20-50/month

# 2. MongoDB Atlas (5 mins)  
# https://mongodb.com/atlas → Create M10 cluster ($60/month)
# OR use M0 FREE tier for demo

# 3. TinyFish (10 mins - apply for beta)
# https://tinyfish.ai → Request access
# Cost: Contact sales (~$500/month)

# 4. Mixedbread (3 mins)
# https://mixedbread.ai → Sign up → API Keys
# Cost: ~$5/month

# 5. AgentOps (2 mins)
# https://agentops.ai → Sign up → Copy API key
# Cost: FREE tier

# 6. Axiom (2 mins)
# https://axiom.co → Sign up → Create dataset → Copy key
# Cost: FREE tier (500GB)

# 7. Twilio (3 mins)
# https://twilio.com → Sign up → Get SID + Token
# Cost: ~$7.50/1000 SMS
```

### Step 2: Configure Production

```bash
cd /Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise

# Copy production template
cp .env.production.template .env.local

# Edit and fill ALL keys
nano .env.local  # or use VS Code

# Set environment
export ENVIRONMENT=production
```

### Step 3: Deploy

```bash
# Validate everything
python scripts/validate_env.py

# Start production server
uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 4

# Or use Docker
docker-compose -f docker-compose.yml up -d
```

---

## 💰 OPTION B: DEMO MODE (~$20/month)

**Get only essential services, mock the rest:**

```bash
# MUST HAVE (real):
# - Fireworks AI: $20-50
# - MongoDB Atlas M0: FREE
# - JWT Secret: FREE

# MOCK (don't pay for):
# - TinyFish → Set TINYFISH_MODE=mock
# - Twilio → Console notifications only
# - AgentOps → Use logging
# - Axiom → Local file logging
# - EHR → Use synthetic data
```

**Create .env.local:**

```bash
ENVIRONMENT=development
DEBUG=false  # Production-like

# REAL
FIREWORKS_API_KEY=fw_your_real_key_here
MONGODB_ATLAS_URI=mongodb+srv://user:pass@cluster.mongodb.net/clinic_ops
JWT_SECRET=your_32_char_secret_here

# MOCK MODE
TINYFISH_API_KEY=mock
TINYFISH_MODE=mock
MIXEDBREAD_API_KEY=mock
TWILIO_ACCOUNT_SID=mock
AGENTOPS_API_KEY=mock
AXIOM_API_KEY=mock
```

**Result:** AI works, database real, other services simulated

---

## 🔧 OPTION C: HYBRID (Recommended for Demo)

**Real services that matter, mock the expensive ones:**

| Service | Real/Mock | Why |
|---------|-----------|-----|
| Fireworks AI | ✅ REAL | Core AI functionality |
| MongoDB Atlas | ✅ REAL | Data persistence |
| TinyFish | ❌ MOCK | Expensive, can demo without |
| Mixedbread | ✅ REAL | Cheap, improves RAG |
| AgentOps | ✅ REAL | FREE tier, great for demo |
| Axiom | ❌ MOCK | Can use local logs |
| Twilio | ❌ MOCK | Console OK for demo |
| EHR | ❌ MOCK | Synthetic data works |

**Cost: ~$25/month**

---

## 🎬 QUICK START (Hybrid Mode)

### Step 1: Get 3 Keys (10 minutes)

**Fireworks AI:**
```bash
# 1. Go to https://fireworks.ai
# 2. Click "Get Started" → Google Sign In
# 3. Dashboard → API Keys → Create New Key
# 4. Copy key starting with "fw_"
```

**MongoDB Atlas:**
```bash
# 1. Go to https://mongodb.com/atlas
# 2. Sign up → "Build Database" → "Create FREE"
# 3. Choose AWS → US East → Create
# 4. Database Access → Add User → clinic_ops_user / password
# 5. Network Access → Add IP → Allow Anywhere (0.0.0.0/0)
# 6. Click "Connect" → Drivers → Python → Copy connection string
# 7. Replace <password> with actual password
```

**AgentOps (FREE):**
```bash
# 1. Go to https://agentops.ai
# 2. Sign up → Copy API key
```

### Step 2: Create Config (2 minutes)

```bash
cd /Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise

# Create env file
cat > .env.local << 'EOF'
ENVIRONMENT=development
DEBUG=false

# REAL SERVICES
FIREWORKS_API_KEY=fw_YOUR_FIREWORKS_KEY
MONGODB_ATLAS_URI=mongodb+srv://clinic_ops_user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/clinic_ops?retryWrites=true&w=majority
MIXEDBREAD_API_KEY=mb_YOUR_MIXEDBREAD_KEY
AGENTOPS_API_KEY=ao_YOUR_AGENTOPS_KEY
JWT_SECRET=$(openssl rand -base64 32)

# MOCK SERVICES (for demo)
TINYFISH_API_KEY=mock
TINYFISH_MODE=mock
WAYSTAR_CREDENTIALS=mock
TWILIO_ACCOUNT_SID=mock
AXIOM_API_KEY=mock
OPENAI_API_KEY=mock

# INFRASTRUCTURE
REDIS_URL=redis://localhost:6379
EOF
```

### Step 3: Start & Test (2 minutes)

```bash
# Validate
python scripts/validate_env.py

# Start
uvicorn api.main:app --reload

# Test in new terminal
curl http://localhost:8000/health

# Open dashboard
open frontend/dashboard.html
```

---

## ✅ VERIFICATION CHECKLIST

After starting, verify these work:

```bash
# 1. Health check
✅ curl http://localhost:8000/health

# 2. API documentation
✅ open http://localhost:8000/docs

# 3. Submit a test claim
✅ curl -X POST http://localhost:8000/api/v2/denial-management/pre-submission-check \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"PAT-001","cpt_code":"99214","payer":"Aetna","billed_amount":450}'

# 4. Check audit logs
✅ curl http://localhost:8000/api/v2/compliance/audit-logs

# 5. View dashboard (manual)
✅ open frontend/dashboard.html
```

---

## 🚨 TROUBLESHOOTING

**Issue: "FIREWORKS_API_KEY not set"**
```bash
# Check env loaded
python -c "from config.settings import settings; print(settings.FIREWORKS_API_KEY)"

# If empty, env file not loaded
# Make sure .env.local exists and keys are set
```

**Issue: "Cannot connect to MongoDB"**
```bash
# Test connection
python -c "import motor.motor_asyncio; client = motor.motor_asyncio.AsyncIOMotorClient('YOUR_URI'); print('Connected')"

# Common fix: Replace <password> with actual password in URI
```

**Issue: "Module not found"**
```bash
# Install dependencies
pip install -r requirements.txt
```

---

## 🎯 FINAL COMMAND

**One-liner to start everything:**

```bash
cd /Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise && \
python scripts/validate_env.py && \
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

---

**Ready? Get your Fireworks + MongoDB keys and run the command above!** 🚀
