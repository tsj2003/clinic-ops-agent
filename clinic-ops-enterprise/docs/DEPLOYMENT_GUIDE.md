# Deployment Guide - Clinic Ops Agent

## Quick Start

### Local Development
```bash
cd clinic-ops-enterprise
docker-compose up -d
```

### Production Deployment
```bash
# 1. Set environment variables
cp .env.production .env
# Edit .env with production values

# 2. Deploy to Kubernetes
kubectl apply -f k8s/

# 3. Verify deployment
kubectl get pods -n clinic-ops
```

---

## Deployment Environments

### 1. Local Development (Docker Compose)

**Services:**
- API (FastAPI)
- MongoDB
- Redis
- MinIO (S3)
- Prometheus
- Grafana
- NGINX

**Start:**
```bash
docker-compose up -d
```

**Access:**
- API: http://localhost:8000
- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- MinIO Console: http://localhost:9001

**Stop:**
```bash
docker-compose down
```

---

### 2. Staging (Kubernetes)

**Prerequisites:**
- Kubernetes cluster (EKS/GKE/AKS)
- kubectl configured
- Container registry access

**Deploy:**
```bash
# Update image tag
export IMAGE_TAG=ghcr.io/username/clinic-ops-enterprise:develop
sed -i "s|image: .*|image: $IMAGE_TAG|" k8s/deployment.yaml

# Apply manifests
kubectl apply -f k8s/
```

**Verify:**
```bash
kubectl get pods -n clinic-ops
kubectl logs -f deployment/clinic-ops-api -n clinic-ops
```

---

### 3. Production (Kubernetes + Canary)

**Prerequisites:**
- Production Kubernetes cluster
- SSL certificates (Let's Encrypt)
- Domain configured
- Secrets configured in K8s

**Deploy (Canary):**
```bash
# 1. Update image
kubectl set image deployment/clinic-ops-api \
  api=ghcr.io/username/clinic-ops-enterprise:v2.0.0 \
  -n clinic-ops

# 2. Monitor rollout
kubectl rollout status deployment/clinic-ops-api -n clinic-ops

# 3. Verify health
curl https://api.clinic-ops.ai/health
```

**Rollback:**
```bash
kubectl rollout undo deployment/clinic-ops-api -n clinic-ops
```

---

## Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `FIREWORKS_API_KEY` | Fireworks AI API key | `fw_...` |
| `MIXEDBREAD_API_KEY` | Mixedbread API key | `mb_...` |
| `TINYFISH_API_KEY` | TinyFish API key | `tf_...` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://...` |
| `REDIS_URL` | Redis connection string | `redis://...` |
| `API_SECRET_KEY` | JWT secret (32+ chars) | `...` |
| `FERNET_KEY` | Encryption key | `...` |

### Validate Configuration

```bash
python scripts/validate_env.py
```

---

## CI/CD Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci-cd.yml` | Push/PR | Lint, Security, Test, Build, Deploy |
| `nightly-tests.yml` | Daily 2 AM | Full test suite, Security scan |

### Pipeline Stages

```
Push/PR → Lint → Security → Test → Build → Deploy
```

**Stage Details:**
1. **Lint**: Black, Ruff, MyPy
2. **Security**: Bandit, Safety, Pip-audit
3. **Test**: Pytest with MongoDB/Redis services
4. **Build**: Docker multi-platform build
5. **Deploy**: Kubernetes rollout (staging/production)

---

## Security Hardening

### Pre-Deployment Checklist

- [ ] Run security audit: `python scripts/security_audit.py`
- [ ] Validate environment: `python scripts/validate_env.py`
- [ ] Scan dependencies: `pip-audit`
- [ ] Check for secrets: `detect-secrets`
- [ ] Review security checklist: `docs/SECURITY_CHECKLIST.md`

### Container Security

- Multi-stage build (smaller image)
- Non-root user
- Read-only root filesystem
- No secrets in image
- Health checks configured

### Kubernetes Security

- Network policies
- Resource limits
- Security contexts
- Secrets management
- RBAC configured

---

## Monitoring & Observability

### Health Checks

**Endpoint:** `GET /health`

```json
{
  "status": "healthy",
  "version": "2.0.0",
  "services": {
    "database": "connected",
    "ai_engine": "operational",
    "ehr_integration": "operational"
  }
}
```

### Metrics

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
- Custom metrics: `/metrics` endpoint

### Logging

- Structured JSON logging
- Correlation IDs
- Axiom integration
- AgentOps monitoring

---

## Troubleshooting

### Common Issues

**Pod CrashLoopBackOff:**
```bash
kubectl logs deployment/clinic-ops-api -n clinic-ops --previous
```

**Database Connection Issues:**
```bash
# Check MongoDB
kubectl exec -it mongo-0 -n clinic-ops -- mongosh --eval "db.adminCommand('ping')"
```

**High Memory Usage:**
```bash
kubectl top pods -n clinic-ops
```

### Debug Commands

```bash
# Get pod details
kubectl describe pod <pod-name> -n clinic-ops

# Execute into container
kubectl exec -it <pod-name> -n clinic-ops -- /bin/bash

# Check events
kubectl get events -n clinic-ops --sort-by='.lastTimestamp'

# Port forward for local testing
kubectl port-forward svc/clinic-ops-api 8000:80 -n clinic-ops
```

---

## Scaling

### Horizontal Pod Autoscaler (HPA)

```yaml
# k8s/hpa.yaml
minReplicas: 3
maxReplicas: 20
targetCPUUtilizationPercentage: 70
```

### Manual Scaling

```bash
kubectl scale deployment/clinic-ops-api --replicas=5 -n clinic-ops
```

---

## Backup & Recovery

### Database Backup

```bash
# MongoDB backup
mongodump --uri="$MONGODB_URI" --out=/backup/$(date +%Y%m%d)

# S3 backup sync
aws s3 sync /backup s3://clinic-ops-backups/
```

### Disaster Recovery

1. Restore from backup
2. Update DNS
3. Verify data integrity
4. Run health checks

---

## Support

- **Documentation**: `docs/`
- **Runbooks**: `docs/runbooks/`
- **On-Call**: oncall@clinic-ops.ai
- **Slack**: #production-support

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2024-01-15 | Production hardening, M5 complete |
| 1.5.0 | 2023-12-01 | Features 16-20 |
| 1.0.0 | 2023-10-01 | Initial release |
