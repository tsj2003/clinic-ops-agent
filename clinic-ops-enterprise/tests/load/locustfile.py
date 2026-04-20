"""
Load Testing Script for Clinic Ops Agent API
Tests performance under 1000+ concurrent users
"""

from locust import HttpUser, task, between, events
from locust.runners import MasterRunner
import random
import json


class ClinicOpsUser(HttpUser):
    """Simulates a typical API user"""
    
    wait_time = between(1, 5)  # Random wait between requests
    
    def on_start(self):
        """Called when user starts"""
        # Store any session data
        self.claim_ids = []
    
    @task(3)
    def health_check(self):
        """Health endpoint - most frequent"""
        with self.client.get("/health", catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Health check failed: {response.status_code}")
    
    @task(2)
    def list_claims(self):
        """List claims endpoint"""
        with self.client.get(
            "/claims?limit=20",
            headers={"Authorization": "Bearer test-token"},
            catch_response=True
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"List claims failed: {response.status_code}")
    
    @task(2)
    def get_dashboard_stats(self):
        """Dashboard stats endpoint"""
        with self.client.get(
            "/analytics/dashboard",
            headers={"Authorization": "Bearer test-token"},
            catch_response=True
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Dashboard stats failed: {response.status_code}")
    
    @task(1)
    def create_claim(self):
        """Create new claim (less frequent)"""
        claim_data = {
            "patient_id": f"PT-{random.randint(10000, 99999)}",
            "procedure_code": random.choice(["99213", "99214", "99285", "99281"]),
            "diagnosis_codes": [random.choice(["M25.561", "R50.9", "R06.02", "J18.9"])],
            "provider_npi": "1234567890",
            "payer_id": random.choice(["aetna", "united_healthcare", "cigna", "anthem"]),
            "place_of_service": str(random.randint(11, 22)),
            "clinical_notes": "Patient presents with symptoms...",
            "estimated_amount": round(random.uniform(100, 5000), 2)
        }
        
        with self.client.post(
            "/claims",
            json=claim_data,
            headers={"Authorization": "Bearer test-token"},
            catch_response=True
        ) as response:
            if response.status_code == 201:
                response.success()
                # Store claim ID for future requests
                try:
                    data = response.json()
                    if 'claim_id' in data:
                        self.claim_ids.append(data['claim_id'])
                except:
                    pass
            else:
                response.failure(f"Create claim failed: {response.status_code}")
    
    @task(1)
    def analyze_claim(self):
        """Analyze claim endpoint"""
        if not self.claim_ids:
            return
        
        claim_id = random.choice(self.claim_ids)
        
        with self.client.post(
            f"/claims/{claim_id}/analyze",
            json={"include_nlp_analysis": True},
            headers={"Authorization": "Bearer test-token"},
            catch_response=True
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Analyze claim failed: {response.status_code}")


class HeavyUser(HttpUser):
    """Simulates a heavy API user (BPO client)"""
    
    wait_time = between(0.5, 2)  # More aggressive
    weight = 1  # 1 heavy user for every 10 regular users
    
    def on_start(self):
        self.batch_claims = []
    
    @task(5)
    def batch_create_claims(self):
        """Create multiple claims in batch"""
        for _ in range(5):
            claim_data = {
                "patient_id": f"PT-{random.randint(10000, 99999)}",
                "procedure_code": random.choice(["99213", "99214", "99285"]),
                "diagnosis_codes": ["M25.561"],
                "provider_npi": "1234567890",
                "payer_id": "aetna",
                "place_of_service": "11",
                "clinical_notes": "Batch test claim"
            }
            
            with self.client.post(
                "/claims",
                json=claim_data,
                headers={"Authorization": "Bearer test-token"},
                catch_response=True
            ) as response:
                if response.status_code == 201:
                    response.success()
    
    @task(3)
    def list_denials(self):
        """List denials (high frequency for BPO)"""
        with self.client.get(
            "/denials?status=new&urgency=high",
            headers={"Authorization": "Bearer test-token"},
            catch_response=True
        ) as response:
            if response.status_code == 200:
                response.success()


class ReadOnlyUser(HttpUser):
    """Simulates a read-only user (auditor/analyst)"""
    
    wait_time = between(5, 15)  # Longer wait between requests
    weight = 2
    
    @task(4)
    def view_dashboard(self):
        """View dashboard"""
        self.client.get(
            "/analytics/dashboard",
            headers={"Authorization": "Bearer test-token"}
        )
    
    @task(2)
    def view_payer_analytics(self):
        """View payer behavior analytics"""
        self.client.get(
            "/analytics/payer-behavior?payer_id=aetna&period=30d",
            headers={"Authorization": "Bearer test-token"}
        )
    
    @task(2)
    def view_audit_logs(self):
        """View audit trail (compliance officer)"""
        self.client.get(
            "/audit/logs?limit=50",
            headers={"Authorization": "Bearer test-token"}
        )


# Custom event handlers
@events.request.add_listener
def on_request(request_type, name, response_time, response_length, 
               response, context, exception, **kwargs):
    """Log slow requests"""
    if response_time > 2000:  # 2 seconds
        print(f"⚠️  Slow request: {name} took {response_time}ms")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Called when load test starts"""
    print("🚀 Load test starting...")
    print(f"Target: {environment.host}")
    print(f"Users: {environment.runner.target_user_count}")


@events.test_stop.add_listener  
def on_test_stop(environment, **kwargs):
    """Called when load test ends"""
    print("\n📊 Load test complete!")
    
    if isinstance(environment.runner, MasterRunner):
        return
    
    # Print summary stats
    stats = environment.runner.stats
    
    print("\n" + "="*70)
    print("LOAD TEST SUMMARY")
    print("="*70)
    
    for name in stats.entries.keys():
        entry = stats.entries[name]
        print(f"\n{name}")
        print(f"  Requests: {entry.num_requests}")
        print(f"  Failures: {entry.num_failures}")
        print(f"  Avg Response Time: {entry.avg_response_time:.2f}ms")
        print(f"  Max Response Time: {entry.max_response_time:.2f}ms")
        print(f"  95th Percentile: {entry.get_response_time_percentile(0.95):.2f}ms")
        print(f"  RPS: {entry.total_rps:.2f}")
