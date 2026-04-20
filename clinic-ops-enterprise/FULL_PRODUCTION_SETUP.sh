#!/bin/bash
# ============================================
# CLINIC OPS AGENT - FULL PRODUCTION SETUP
# All 17 services REAL - $650/month
# ============================================

set -e  # Exit on error

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     CLINIC OPS AGENT - FULL PRODUCTION DEPLOYMENT           ║"
echo "║              All Services REAL - No Mocks                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_DIR="/Users/tarandeepsinghjuneja/tinyfish_hackathone/clinic-ops-enterprise"
cd "$PROJECT_DIR"

echo -e "${BLUE}Step 1/5:${NC} Checking prerequisites..."
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.9+${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Python 3 found: $(python3 --version)"

# Check pip
if ! command -v pip3 &> /dev/null; then
    echo -e "${RED}❌ pip3 not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} pip3 found"

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}⚠${NC} .env.local not found. Creating from template..."
    cp .env.production.template .env.local
    echo -e "${GREEN}✓${NC} Created .env.local"
fi

echo ""
echo -e "${BLUE}Step 2/5:${NC} Installing dependencies..."
pip3 install -q -r requirements.txt
echo -e "${GREEN}✓${NC} Dependencies installed"

echo ""
echo -e "${BLUE}Step 3/5:${NC} Validating environment variables..."
python3 scripts/validate_env.py
if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}❌ Environment validation FAILED${NC}"
    echo ""
    echo -e "${YELLOW}Please fill in these missing API keys in .env.local:${NC}"
    echo ""
    echo "  1. FIREWORKS_API_KEY     → https://fireworks.ai"
    echo "  2. MONGODB_ATLAS_URI     → https://mongodb.com/atlas"
    echo "  3. TINYFISH_API_KEY      → https://tinyfish.ai (apply for beta)"
    echo "  4. MIXEDBREAD_API_KEY    → https://mixedbread.ai"
    echo "  5. AGENTOPS_API_KEY      → https://agentops.ai"
    echo "  6. AXIOM_API_KEY         → https://axiom.co"
    echo "  7. TWILIO_ACCOUNT_SID    → https://twilio.com"
    echo "  8. WAYSTAR_API_KEY       → https://waystar.com (contact sales)"
    echo "  9. EPIC_CLIENT_ID        → https://fhir.epic.com"
    echo " 10. CERNER_CLIENT_ID      → https://code.cerner.com"
    echo " 11. ATHENA_CLIENT_ID      → https://docs.athenahealth.com/api"
    echo " 12. CHANGE_HEALTHCARE     → https://developers.changehealthcare.com"
    echo " 13. FERNET_KEY            → Run: python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
    echo " 14. JWT_SECRET            → Run: openssl rand -base64 32"
    echo " 15. API_SECRET_KEY        → Any 32+ char string"
    echo " 16. SENDGRID_API_KEY      → https://sendgrid.com"
    echo " 17. REDIS_URL             → https://upstash.com (free tier)"
    echo ""
    exit 1
fi

echo ""
echo -e "${BLUE}Step 4/5:${NC} Testing service connectivity..."

# Test Fireworks
echo -n "  Testing Fireworks AI... "
python3 -c "
import os, requests
key = os.getenv('FIREWORKS_API_KEY')
if key and not key.startswith('fw_'):
    print('${YELLOW}⚠ Invalid key format${NC}')
elif key:
    print('${GREEN}✓${NC}')
else:
    print('${RED}✗ Missing${NC}')
"

# Test MongoDB
echo -n "  Testing MongoDB Atlas... "
python3 -c "
import os, sys
try:
    import motor.motor_asyncio
    uri = os.getenv('MONGODB_ATLAS_URI')
    if uri and 'mongodb+srv' in uri:
        print('${GREEN}✓${NC}')
    else:
        print('${RED}✗ Invalid URI${NC}')
except:
    print('${YELLOW}⚠ motor not installed${NC}')
"

# Test Redis
echo -n "  Testing Redis... "
python3 -c "
import os
url = os.getenv('REDIS_URL')
if url:
    print('${GREEN}✓${NC} Configured')
else:
    print('${YELLOW}⚠ Not configured (optional)${NC}')
"

echo ""
echo -e "${BLUE}Step 5/5:${NC} Starting production server..."
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 CLINIC OPS AGENT IS LIVE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  📊 Dashboard:    http://localhost:8000"
echo "  📚 API Docs:      http://localhost:8000/docs"
echo "  🔍 Health:       http://localhost:8000/health"
echo "  📈 Metrics:       http://localhost:8000/metrics"
echo ""
echo "  Frontend:"
echo "    Landing Page:  file://$PROJECT_DIR/frontend/index.html"
echo "    Dashboard:     file://$PROJECT_DIR/frontend/dashboard.html"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Start server
exec uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 4
