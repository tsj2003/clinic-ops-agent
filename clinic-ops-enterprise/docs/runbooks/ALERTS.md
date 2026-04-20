# Alert Runbooks - Clinic Ops Agent

## Alert Severity Levels

- **Critical (P1)**: Service down, data loss, security breach
- **High (P2)**: Degraded performance, failed payments
- **Medium (P3)**: Non-critical failures, resource warnings
- **Low (P4)**: Informational, capacity planning

---

## Critical Alerts (P1)

### API Down
**Alert:** `api_up == 0`

**Runbook:**
1. Check pod status: `kubectl get pods -n clinic-ops`
2. Check pod logs: `kubectl logs -f deployment/clinic-ops-api -n clinic-ops`
3. Check events: `kubectl get events -n clinic-ops`
4. If pod crashed:
   - Check for OOM: `kubectl describe pod <pod>`
   - Check recent deployments
   - Rollback if needed: `kubectl rollout undo`
5. If database issue:
   - Check MongoDB connectivity
   - Verify credentials in secrets
6. Escalate to on-call if not resolved in 15 minutes

---

### High Error Rate
**Alert:** `rate(api_requests_total{status=~"5.."}[5m]) > 0.1`

**Runbook:**
1. Check logs for error patterns
2. Identify affected endpoints
3. Check external dependencies (Fireworks, MongoDB)
4. If AI API failing:
   - Check API key validity
   - Check rate limits
   - Switch to fallback if available
5. If database failing:
   - Check connection pool
   - Check query performance

---

### Database Connection Failure
**Alert:** `mongodb_up == 0`

**Runbook:**
1. Check MongoDB pod status
2. Verify connection string in secrets
3. Check network policies
4. Check MongoDB resource usage
5. If persistent issue:
   - Check for IP whitelist changes
   - Verify TLS certificates
   - Check firewall rules

---

## High Alerts (P2)

### Slow Response Time
**Alert:** `histogram_quantile(0.95, rate(api_request_duration_seconds_bucket[5m])) > 2`

**Runbook:**
1. Identify slow endpoints
2. Check database query performance
3. Check AI API latency
4. Scale up if needed: `kubectl scale deployment --replicas=5`
5. Enable caching if not already

---

### High Memory Usage
**Alert:** `system_memory_bytes{type="used"} / system_memory_bytes{type="total"} > 0.85`

**Runbook:**
1. Check for memory leaks in logs
2. Check for large request payloads
3. Restart pods if memory leak suspected
4. Increase memory limits if sustained growth

---

### High CPU Usage
**Alert:** `system_cpu_percent > 80`

**Runbook:**
1. Check for resource-intensive operations
2. Scale horizontally if CPU bound
3. Check for infinite loops or busy waiting
4. Profile if needed: `py-spy top --pid <pid>`

---

## Medium Alerts (P3)

### AI API Slow
**Alert:** `histogram_quantile(0.95, rate(ai_request_duration_seconds_bucket[5m])) > 30`

**Runbook:**
1. Check Fireworks/Mixbread status page
2. Monitor for degradation
3. Enable fallback to local models if configured
4. Adjust timeout settings

---

### Queue Depth High
**Alert:** `work_queue_depth > 1000`

**Runbook:**
1. Check worker pod status
2. Scale workers: `kubectl scale deployment/worker --replicas=5`
3. Check for processing bottlenecks

---

### Disk Space Low
**Alert:** `disk_usage_percent > 80`

**Runbook:**
1. Check log rotation
2. Clean up temporary files
3. Archive old data
4. Resize volume if needed

---

## Low Alerts (P4)

### Deployment Successful
**Alert:** `deployment_status == 1`

**Action:** None, informational only

---

### Backup Failed
**Alert:** `backup_success == 0`

**Runbook:**
1. Check backup job logs
2. Verify storage credentials
3. Retry backup manually
4. Schedule for next window

---

## Alert Routing

| Severity | Channel | Response Time |
|----------|---------|---------------|
| Critical | PagerDuty + Slack #alerts-critical | 5 min |
| High | Slack #alerts-high + Email | 15 min |
| Medium | Slack #alerts-medium | 30 min |
| Low | Slack #alerts-info | 4 hours |

## On-Call Rotation

- **Primary:** On-call engineer
- **Secondary:** Engineering manager
- **Escalation:** CTO

## After-Incident Actions

1. Document incident in runbook
2. Update alert thresholds if noisy
3. Post-mortem within 24 hours for P1/P2
4. Implement preventive measures

---

**Last Updated:** 2024-01-15
**Next Review:** 2024-02-15
