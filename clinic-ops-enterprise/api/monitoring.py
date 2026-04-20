"""
Monitoring & Metrics Module
Integrates Prometheus metrics and health checks
"""

import time
import functools
from typing import Callable, Any
from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, CONTENT_TYPE_LATEST
from fastapi import APIRouter, Response
import psutil
import os


# Prometheus metrics
REQUEST_COUNT = Counter(
    'api_requests_total',
    'Total API requests',
    ['method', 'endpoint', 'status']
)

REQUEST_DURATION = Histogram(
    'api_request_duration_seconds',
    'API request duration',
    ['method', 'endpoint'],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

ACTIVE_REQUESTS = Gauge(
    'api_active_requests',
    'Number of active requests'
)

DB_CONNECTIONS = Gauge(
    'db_connections_total',
    'Database connection count'
)

AI_REQUEST_DURATION = Histogram(
    'ai_request_duration_seconds',
    'AI API request duration',
    ['provider'],  # fireworks, mixedbread, tinyfish
    buckets=[0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0]
)

CLAIMS_PROCESSED = Counter(
    'claims_processed_total',
    'Claims processed',
    ['status']  # created, approved, denied, appealed
)

DENIALS_DETECTED = Counter(
    'denials_detected_total',
    'Denials detected',
    ['payer', 'reason']
)

APPEALS_SUBMITTED = Counter(
    'appeals_submitted_total',
    'Appeals submitted',
    ['method']  # online, fax, mail
)

SYSTEM_MEMORY = Gauge(
    'system_memory_bytes',
    'System memory usage',
    ['type']  # used, free, total
)

SYSTEM_CPU = Gauge(
    'system_cpu_percent',
    'System CPU usage'
)

APP_INFO = Info(
    'app',
    'Application information'
)


class MetricsCollector:
    """Collects and exposes application metrics"""
    
    def __init__(self):
        # Set static info
        APP_INFO.info({
            'version': os.getenv('APP_VERSION', '2.0.0'),
            'environment': os.getenv('APP_ENV', 'production'),
            'name': 'Clinic Ops Agent Enterprise'
        })
    
    def record_request(self, method: str, endpoint: str, status: int, duration: float):
        """Record API request metrics"""
        REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=status).inc()
        REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration)
    
    def record_ai_request(self, provider: str, duration: float):
        """Record AI API request duration"""
        AI_REQUEST_DURATION.labels(provider=provider).observe(duration)
    
    def record_claim(self, status: str):
        """Record claim processing"""
        CLAIMS_PROCESSED.labels(status=status).inc()
    
    def record_denial(self, payer: str, reason: str):
        """Record detected denial"""
        DENIALS_DETECTED.labels(payer=payer, reason=reason[:50]).inc()
    
    def record_appeal(self, method: str):
        """Record appeal submission"""
        APPEALS_SUBMITTED.labels(method=method).inc()
    
    def update_system_metrics(self):
        """Update system resource metrics"""
        memory = psutil.virtual_memory()
        SYSTEM_MEMORY.labels(type='used').set(memory.used)
        SYSTEM_MEMORY.labels(type='free').set(memory.available)
        SYSTEM_MEMORY.labels(type='total').set(memory.total)
        
        cpu = psutil.cpu_percent(interval=1)
        SYSTEM_CPU.set(cpu)


# Global metrics collector
metrics = MetricsCollector()


# FastAPI router for metrics endpoint
monitoring_router = APIRouter(prefix="/metrics", tags=["Monitoring"])


@monitoring_router.get("/prometheus")
async def prometheus_metrics():
    """Expose Prometheus metrics"""
    metrics.update_system_metrics()
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


def track_request(endpoint: str):
    """Decorator to track request metrics"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            ACTIVE_REQUESTS.inc()
            start_time = time.time()
            
            try:
                response = await func(*args, **kwargs)
                status = 200
                return response
            except Exception as e:
                status = 500
                raise
            finally:
                duration = time.time() - start_time
                ACTIVE_REQUESTS.dec()
                metrics.record_request(
                    method=func.__name__,
                    endpoint=endpoint,
                    status=status,
                    duration=duration
                )
        return wrapper
    return decorator


def track_ai_request(provider: str):
    """Decorator to track AI API calls"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                return result
            finally:
                duration = time.time() - start_time
                metrics.record_ai_request(provider, duration)
        return wrapper
    return decorator
