# CodeRabbit AI Code Review Setup

## Overview

CodeRabbit provides AI-powered code reviews for the Clinic Ops Agent project, ensuring:
- HIPAA compliance
- High code quality
- Security best practices
- Performance optimization

---

## Installation

### 1. GitHub Integration (Recommended)

1. Visit [coderabbit.ai](https://coderabbit.ai)
2. Sign in with GitHub
3. Select the `clinic-ops-enterprise` repository
4. Grant permissions

### 2. Configuration

The configuration file `.coderabbit.yaml` is already created with:
- **HIPAA-aware review guidelines**
- **Security-focused checks**
- **Performance requirements**
- **Healthcare domain context**

### 3. Repository Setup

Ensure these files are committed:
```
.coderabbit.yaml          # Main configuration
docs/CODERABBIT_SETUP.md  # This guide
```

---

## Usage

### Automatic Reviews

CodeRabbit automatically reviews:
- **Pull Requests** - Full code review on PR creation
- **Commits** - Incremental reviews on new commits
- **Draft PRs** - Optional, can be enabled

### Manual Commands

In PR comments, use:

| Command | Description |
|---------|-------------|
| `@coderabbit` | Trigger review of entire PR |
| `@coderabbit summary` | Generate high-level summary |
| `@coderabbit resolve` | Mark all comments as resolved |
| `@coderabbit pause` | Pause reviews on this PR |
| `@coderabbit resume` | Resume reviews on this PR |
| `@coderabbit ignore` | Ignore specific file/path |

---

## Review Features

### 1. Security & HIPAA Compliance ✅

CodeRabbit checks for:
- Hardcoded secrets (API keys, passwords)
- Missing input validation
- Insecure cryptographic practices
- PHI exposure risks
- Missing audit logging
- Improper error handling

**Example:**
```python
# ❌ BAD - CodeRabbit will flag this
api_key = "sk-1234567890abcdef"

# ✅ GOOD
api_key = os.getenv("API_KEY")
if not api_key:
    raise ValueError("API_KEY not set")
```

### 2. Performance Optimization 🚀

CodeRabbit suggests:
- Async/await usage
- Connection pooling
- Caching strategies
- Database query optimization
- Memory leak prevention

**Example:**
```python
# ❌ BAD - Blocking I/O
response = requests.get(url)

# ✅ GOOD - Async I/O
async with aiohttp.ClientSession() as session:
    async with session.get(url) as response:
        data = await response.json()
```

### 3. Type Safety 📦

CodeRabbit enforces:
- Pydantic models for data
- Type hints throughout
- Optional[] for nullable fields
- Proper return types

**Example:**
```python
# ❌ BAD - No types
def process_claim(data):
    return data

# ✅ GOOD - Fully typed
from pydantic import BaseModel
from typing import Optional

class ClaimInput(BaseModel):
    patient_id: str
    procedure_code: str
    amount: Optional[float] = None

async def process_claim(data: ClaimInput) -> dict:
    """Process a medical claim."""
    return {"status": "processed"}
```

### 4. Error Handling & Resilience ⚡

CodeRabbit validates:
- Try-except blocks present
- Proper exception types
- Circuit breakers for external APIs
- Retry logic with backoff
- Graceful degradation

**Example:**
```python
# ❌ BAD - No error handling
data = await fetch_from_api()

# ✅ GOOD - Proper error handling
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10)
)
async def fetch_from_api() -> dict:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(API_URL) as response:
                response.raise_for_status()
                return await response.json()
    except aiohttp.ClientError as e:
        logger.error(f"API call failed: {e}")
        raise ExternalAPIError(f"Failed to fetch data: {e}") from e
```

### 5. Documentation 📝

CodeRabbit checks:
- Google-style docstrings
- Type information
- Exception documentation
- Usage examples

**Example:**
```python
# ❌ BAD - No documentation
def calculate_risk(patient):
    return risk_score

# ✅ GOOD - Comprehensive documentation
def calculate_risk_score(
    patient: PatientData,
    include_history: bool = True
) -> RiskAssessment:
    """Calculate denial risk score for a patient.
    
    Uses clinical data and historical patterns to predict
    the likelihood of prior authorization denial.
    
    Args:
        patient: Patient demographic and clinical data
        include_history: Whether to include claim history
        
    Returns:
        RiskAssessment with score (0-1) and reasoning
        
    Raises:
        ValidationError: If patient data is incomplete
        ExternalAPIError: If AI analysis fails
        
    Example:
        >>> patient = PatientData(patient_id="PT-123", ...)
        >>> result = calculate_risk_score(patient)
        >>> print(f"Risk: {result.score:.2%}")
    """
    # Implementation
    return RiskAssessment(score=0.15, reasoning="Low risk profile")
```

---

## Custom Review Rules

### For HIPAA-Related Code

CodeRabbit pays special attention to:

1. **PHI Handling**
   - Encryption at rest (Fernet)
   - Encryption in transit (TLS)
   - Audit logging (compliance/audit.py)
   - Access controls (compliance/abac_engine.py)

2. **External APIs**
   - Fireworks AI (LLM processing)
   - TinyFish (web automation)
   - EHR integrations (Epic, Cerner, Athena)
   - PBM systems

3. **Database Operations**
   - MongoDB queries
   - Redis caching
   - Connection management
   - Index usage

### For New Features

When adding Features 16-20:

1. **Underpayment Recovery** - Check contract parsing logic
2. **AI Negotiation** - Verify clinical guardrails
3. **Payer Analytics** - Validate aggregation accuracy
4. **White-Label** - Test multi-tenant isolation
5. **Pharmacy/DME** - Check HL7/FHIR compliance

---

## Review Status Labels

CodeRabbit applies labels based on review:

| Label | Meaning | Action Required |
|-------|---------|-----------------|
| `coderabbit:approved` | No issues found | Ready to merge |
| `coderabbit:needs-work` | Minor issues | Address comments |
| `coderabbit:changes-requested` | Significant issues | Must fix before merge |
| `coderabbit:security-issue` | Security concern | Fix immediately |

---

## Best Practices

### For Developers

1. **Address all comments** - Even suggestions improve code quality
2. **Ask questions** - Reply to CodeRabbit comments for clarification
3. **Fix security issues first** - Always prioritize security flags
4. **Add tests** - CodeRabbit checks test coverage
5. **Update docs** - Ensure docstrings are comprehensive

### For Code Reviewers

1. **Use CodeRabbit as a first pass** - It catches common issues
2. **Focus on domain logic** - Human reviewers focus on business rules
3. **Validate HIPAA compliance** - Double-check PHI handling
4. **Check test coverage** - Ensure new code has tests

---

## Troubleshooting

### CodeRabbit Not Reviewing

1. Check `.coderabbit.yaml` is in repo root
2. Verify CodeRabbit has repository access
3. Check PR doesn't have `WIP` or `DRAFT` in title
4. Ensure files are in `path_filters.include`

### Too Many Comments

Adjust in `.coderabbit.yaml`:
```yaml
reviews:
  high_level_summary: true
  poem: false  # Disable fun features for serious PRs
```

### Missing Domain Context

Add to `knowledge_base.docs`:
```yaml
knowledge_base:
  docs:
    - name: "Business Logic"
      path: "docs/business_rules.md"
```

---

## Integration with CI/CD

CodeRabbit works alongside existing workflows:

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  # CodeRabbit runs automatically via GitHub App
  
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: pytest
      
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Security scan
        run: python scripts/security_audit.py
```

---

## Metrics & Reporting

Track CodeRabbit effectiveness:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Issues caught before merge | >80% | CodeRabbit vs manual review |
| False positive rate | <10% | Developer feedback |
| Time to review | <5 min | PR comment timestamps |
| Security issues prevented | 100% | Post-deployment audit |

---

## Support

- **Documentation**: [coderabbit.ai/docs](https://coderabbit.ai/docs)
- **Support**: support@coderabbit.ai
- **Status**: [status.coderabbit.ai](https://status.coderabbit.ai)

---

**Setup Date**: 2024-01-15
**Configuration Version**: 1.0
