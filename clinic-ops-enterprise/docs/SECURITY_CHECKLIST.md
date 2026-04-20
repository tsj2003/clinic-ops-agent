# Security Checklist - Clinic Ops Agent

## Pre-Deployment Security Verification

### Authentication & Authorization
- [ ] JWT tokens use secure algorithm (HS256 or RS256)
- [ ] Token expiration is set (max 30 minutes)
- [ ] Refresh token rotation enabled
- [ ] ABAC policies tested for all 6 roles
- [ ] API rate limiting configured per tier
- [ ] Failed auth attempts are logged

### Data Protection
- [ ] PHI encryption at rest (AES-256)
- [ ] TLS 1.3 for all data in transit
- [ ] Fernet keys are 32 bytes and properly encoded
- [ ] MongoDB encryption enabled
- [ ] Backup encryption verified
- [ ] Data retention policy configured (7 years)

### API Security
- [ ] Input validation on all endpoints
- [ ] SQL/NoSQL injection prevention
- [ ] XSS protection headers
- [ ] CSRF tokens for state-changing operations
- [ ] CORS policy configured
- [ ] Content Security Policy (CSP) headers

### Infrastructure
- [ ] Docker containers run as non-root user
- [ ] Read-only root filesystem
- [ ] No privileged containers
- [ ] Secrets not in environment variables (use K8s secrets)
- [ ] Network policies configured
- [ ] Resource limits set (CPU/memory)

### Dependencies
- [ ] `pip-audit` run - no critical vulnerabilities
- [ ] `bandit` scan passed
- [ ] `safety` check passed
- [ ] All dependencies pinned to specific versions
- [ ] No unused dependencies

### Secrets Management
- [ ] No hardcoded secrets in code
- [ ] `.env` files in `.gitignore`
- [ ] API keys rotated (not default/placeholder)
- [ ] Webhook secrets configured
- [ ] Database credentials not in logs

### Monitoring & Logging
- [ ] Axiom audit logging enabled
- [ ] AgentOps monitoring active
- [ ] Prometheus metrics exposed
- [ ] Failed login attempts logged
- [ ] Unusual activity alerts configured
- [ ] Log retention policy set

### Compliance
- [ ] HIPAA BAA agreement in place
- [ ] Business Associate Agreement signed
- [ ] Audit trails configured (SHA-256)
- [ ] Tamper-evident logging enabled
- [ ] Data breach response plan documented
- [ ] Incident response procedures tested

### Network Security
- [ ] Firewall rules configured
- [ ] DDoS protection enabled
- [ ] VPN/restricted access for admin endpoints
- [ ] IP whitelisting for sensitive operations
- [ ] TLS certificate valid and not expiring
- [ ] HSTS headers enabled

### Testing
- [ ] Penetration testing completed
- [ ] Security unit tests pass
- [ ] ABAC enforcement tests pass
- [ ] HIPAA compliance tests pass
- [ ] Load testing completed (1000+ concurrent)
- [ ] Dependency vulnerability scan clean

## Security Scanning Commands

```bash
# Run all security checks
cd clinic-ops-enterprise

# 1. Dependency vulnerability scan
pip-audit -r requirements.txt

# 2. Static code analysis
bandit -r . -f json -o bandit-report.json

# 3. Secret detection
detect-secrets scan > .secrets.baseline
detect-secrets audit .secrets.baseline

# 4. Comprehensive security audit
python scripts/security_audit.py

# 5. Environment validation
python scripts/validate_env.py
```

## Security Baseline

| Metric | Target | Current |
|--------|--------|---------|
| Dependency vulnerabilities (Critical) | 0 | TBD |
| Dependency vulnerabilities (High) | ≤ 2 | TBD |
| Bandit issues (Critical) | 0 | TBD |
| Bandit issues (High) | ≤ 2 | TBD |
| Hardcoded secrets | 0 | TBD |
| Security test coverage | ≥ 90% | TBD |

## Incident Response

### Severity Levels
- **Critical**: Data breach, unauthorized PHI access
- **High**: Authentication bypass, privilege escalation
- **Medium**: Information disclosure, DoS vulnerability
- **Low**: Configuration issues, missing headers

### Response Steps
1. **Detect** - Alert triggers
2. **Contain** - Isolate affected systems
3. **Investigate** - Determine scope and impact
4. **Remediate** - Fix vulnerability
5. **Report** - Document incident (HIPAA requires 60-day breach notification)
6. **Review** - Post-incident analysis

## Security Contacts

- **Security Team**: security@clinic-ops.ai
- **On-Call**: +1-XXX-XXX-XXXX
- **Escalation**: ceo@clinic-ops.ai

---

**Last Updated**: 2024-01-15
**Next Review**: 2024-04-15
