#!/bin/bash
# CodeRabbit Activation Script for Clinic Ops Agent

set -e

echo "🐰 Activating CodeRabbit AI Code Review for Clinic Ops Agent"
echo "==============================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f ".coderabbit.yaml" ]; then
    echo "❌ Error: .coderabbit.yaml not found"
    echo "Please run this script from the clinic-ops-enterprise directory"
    exit 1
fi

echo "${BLUE}Step 1: Committing configuration files...${NC}"
git add .coderabbit.yaml docs/CODERABBIT_SETUP.md 2>/dev/null || true
git commit -m "🔧 Add CodeRabbit AI code review configuration

- HIPAA-aware review rules
- Security scanning (bandit, secrets)
- Performance optimization checks
- Healthcare domain context
- Setup documentation" 2>/dev/null || echo "${YELLOW}⚠️  Git commit skipped (may already be committed)${NC}"

echo ""
echo "${BLUE}Step 2: Verifying configuration...${NC}"
if [ -f ".coderabbit.yaml" ]; then
    echo "${GREEN}✅ .coderabbit.yaml present${NC}"
else
    echo "${YELLOW}⚠️  Configuration file missing${NC}"
fi

if [ -f "docs/CODERABBIT_SETUP.md" ]; then
    echo "${GREEN}✅ Setup documentation present${NC}"
else
    echo "${YELLOW}⚠️  Setup documentation missing${NC}"
fi

echo ""
echo "${BLUE}Step 3: Configuration Summary${NC}"
echo "------------------------------"
echo "Repository: clinic-ops-enterprise"
echo "Enabled Features:"
echo "  ✅ HIPAA Compliance Checking"
echo "  ✅ Security Vulnerability Scanning"
echo "  ✅ Performance Optimization"
echo "  ✅ Type Safety (Pydantic)"
echo "  ✅ Documentation Review"
echo "  ✅ Async/Await Patterns"
echo ""

echo "${YELLOW}Next Steps (Manual):${NC}"
echo "---------------------"
echo ""
echo "1. ${BLUE}Go to https://coderabbit.ai${NC}"
echo "   • Sign in with your GitHub account"
echo "   • Grant repository access"
echo ""
echo "2. ${BLUE}Select Repository:${NC}"
echo "   • Find 'clinic-ops-enterprise' in the list"
echo "   • Click 'Enable' or 'Install'"
echo ""
echo "3. ${BLUE}Verify Integration:${NC}"
echo "   • Create a test PR with any code change"
echo "   • CodeRabbit should comment within 1-2 minutes"
echo ""
echo "4. ${BLUE}Test Commands:${NC}"
echo "   • Comment '@coderabbit' in any PR"
echo "   • Comment '@coderabbit summary' for overview"
echo ""

echo "${GREEN}✅ Configuration ready for activation!${NC}"
echo ""
echo "${YELLOW}Note: Make sure you have admin access to the GitHub repository${NC}"
echo ""
echo "For help: docs/CODERABBIT_SETUP.md"
echo "Support: support@coderabbit.ai"
