"""
TinyFish Web Agent Scraper for Payer Portal Denial Detection
Logs into Aetna/UHC portals, scrapes denied claims, pushes to MongoDB
"""

import os
import json
import asyncio
from datetime import datetime
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
import aiohttp


@dataclass
class ScrapedClaim:
    """Scraped denial claim from portal"""
    claim_number: str
    patient_name: str
    patient_member_id: str
    service_date: str
    procedure_code: str
    billed_amount: float
    denial_code: str
    denial_reason: str
    denial_date: str
    raw_text: str
    confidence: float


class TinyFishScraper:
    """
    TinyFish Web Agent API client for automated portal scraping
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://agent.tinyfish.ai",
        timeout: int = 300
    ):
        self.api_key = api_key or os.getenv("TINYFISH_API_KEY")
        self.base_url = base_url
        self.timeout = timeout
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            }
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def run_workflow(
        self,
        workflow_url: str,
        goal: str,
        variables: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute a TinyFish workflow with SSE streaming
        """
        payload = {
            "workflowUrl": workflow_url,
            "goal": goal,
            "variables": variables or {},
            "options": {
                "screenshot": True,
                "extractText": True,
                "maxSteps": 50,
                "timeoutSeconds": self.timeout,
            }
        }
        
        results = {
            "steps": [],
            "final_answer": None,
            "screenshots": [],
            "error": None,
            "completed": False
        }
        
        try:
            async with self.session.post(
                f"{self.base_url}/v1/run",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            ) as response:
                
                async for line in response.content:
                    line = line.decode('utf-8').strip()
                    if not line or not line.startswith('data:'):
                        continue
                    
                    data_str = line[5:].strip()
                    try:
                        event = json.loads(data_str)
                        event_type = event.get('type')
                        
                        if event_type == 'step':
                            results["steps"].append(event)
                        elif event_type == 'answer':
                            results["final_answer"] = event.get('payload', {}).get('answer')
                            results["completed"] = True
                        elif event_type == 'screenshot':
                            results["screenshots"].append(event.get('payload', {}).get('url'))
                        elif event_type == 'error':
                            results["error"] = event.get('payload', {}).get('message')
                            
                    except json.JSONDecodeError:
                        continue
                        
        except asyncio.TimeoutError:
            results["error"] = "Workflow timeout"
        except Exception as e:
            results["error"] = str(e)
        
        return results
    
    async def scrape_aetna_denials(
        self,
        portal_username: str,
        portal_password: str,
        date_from: str,
        date_to: str
    ) -> List[ScrapedClaim]:
        """
        Scrape denied claims from Aetna provider portal
        """
        # Aetna portal workflow - using provided workflow URL or default
        workflow_url = os.getenv(
            "AETNA_WORKFLOW_URL",
            "https://gist.githubusercontent.com/tsj2003/aetna-portal-workflow.json"
        )
        
        goal = f"""
        Log into Aetna provider portal at https://provider.aetna.com
        Navigate to Claims > Claim Status
        Search for denied claims from {date_from} to {date_to}
        Extract all denied claim details:
        - Claim number
        - Patient name and member ID
        - Service date
        - Procedure codes
        - Billed amount
        - Denial code and reason
        Return structured JSON array of all denied claims found.
        """
        
        variables = {
            "username": portal_username,
            "password": portal_password,
            "dateFrom": date_from,
            "dateTo": date_to,
        }
        
        results = await self.run_workflow(workflow_url, goal, variables)
        
        if results["error"]:
            raise RuntimeError(f"Scraping failed: {results['error']}")
        
        # Parse scraped claims from final answer
        claims = self._parse_claims_from_answer(
            results["final_answer"],
            results.get("screenshots", [])
        )
        
        return claims
    
    async def scrape_uhc_denials(
        self,
        portal_username: str,
        portal_password: str,
        date_from: str,
        date_to: str
    ) -> List[ScrapedClaim]:
        """
        Scrape denied claims from UnitedHealthcare provider portal
        """
        workflow_url = os.getenv(
            "UHC_WORKFLOW_URL",
            "https://gist.githubusercontent.com/tsj2003/uhc-portal-workflow.json"
        )
        
        goal = f"""
        Log into UnitedHealthcare provider portal at https://providerlink.uhc.com
        Navigate to Claims & Payments > Claim Status
        Filter for denied claims from {date_from} to {date_to}
        Extract all denied claim details including:
        - Claim number, patient info, service dates
        - Procedure codes, billed amounts
        - Denial codes and descriptions
        Return structured JSON of all denied claims.
        """
        
        variables = {
            "username": portal_username,
            "password": portal_password,
            "dateFrom": date_from,
            "dateTo": date_to,
        }
        
        results = await self.run_workflow(workflow_url, goal, variables)
        
        if results["error"]:
            raise RuntimeError(f"UHC scraping failed: {results['error']}")
        
        claims = self._parse_claims_from_answer(
            results["final_answer"],
            results.get("screenshots", [])
        )
        
        return claims
    
    def _parse_claims_from_answer(
        self,
        answer: Optional[str],
        screenshots: List[str]
    ) -> List[ScrapedClaim]:
        """
        Parse JSON claims from TinyFish workflow output
        """
        if not answer:
            return []
        
        claims = []
        try:
            # Try to extract JSON from the answer
            if '```json' in answer:
                json_str = answer.split('```json')[1].split('```')[0].strip()
            elif '```' in answer:
                json_str = answer.split('```')[1].split('```')[0].strip()
            else:
                json_str = answer
            
            data = json.loads(json_str)
            
            if isinstance(data, list):
                claim_list = data
            elif isinstance(data, dict) and 'claims' in data:
                claim_list = data['claims']
            elif isinstance(data, dict):
                claim_list = [data]
            else:
                claim_list = []
            
            for item in claim_list:
                claim = ScrapedClaim(
                    claim_number=item.get('claim_number', 'UNKNOWN'),
                    patient_name=item.get('patient_name', ''),
                    patient_member_id=item.get('member_id', ''),
                    service_date=item.get('service_date', ''),
                    procedure_code=item.get('procedure_code', ''),
                    billed_amount=float(item.get('billed_amount', 0)),
                    denial_code=item.get('denial_code', ''),
                    denial_reason=item.get('denial_reason', ''),
                    denial_date=item.get('denial_date', ''),
                    raw_text=json.dumps(item),
                    confidence=0.85 if screenshots else 0.70
                )
                claims.append(claim)
                
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"⚠️  Warning: Could not parse claims: {e}")
            # Return single claim with raw text if parsing fails
            if answer:
                claims.append(ScrapedClaim(
                    claim_number="PARSE_ERROR",
                    patient_name="",
                    patient_member_id="",
                    service_date="",
                    procedure_code="",
                    billed_amount=0.0,
                    denial_code="",
                    denial_reason="",
                    denial_date="",
                    raw_text=answer,
                    confidence=0.3
                ))
        
        return claims
    
    async def submit_appeal_portal(
        self,
        workflow_url: str,
        claim_number: str,
        appeal_letter: str,
        supporting_docs: List[str],
        portal_username: str,
        portal_password: str
    ) -> Dict[str, Any]:
        """
        Submit appeal through payer portal using TinyFish
        """
        goal = f"""
        Log into payer portal and submit an appeal for claim {claim_number}.
        Navigate to Claims > Appeals or Claim Status > Submit Appeal.
        Upload the appeal letter and supporting documents.
        Fill in all required fields and submit.
        Capture confirmation number and submission timestamp.
        Return confirmation details as JSON.
        """
        
        variables = {
            "username": portal_username,
            "password": portal_password,
            "claimNumber": claim_number,
            "appealLetter": appeal_letter,
            "supportingDocs": supporting_docs,
        }
        
        results = await self.run_workflow(workflow_url, goal, variables)
        return results


class ScraperScheduler:
    """
    Google Cloud Scheduler integration for automated scraping
    """
    
    @staticmethod
    async def scheduled_scrape_job(
        payer_portal_id: str,
        organization_id: str
    ) -> Dict[str, Any]:
        """
        Entry point for Google Cloud Scheduler
        """
        from ..database.connection import get_db
        from ..compliance.audit import AuditLogger
        
        db = await get_db()
        audit = AuditLogger(db)
        
        start_time = datetime.utcnow()
        
        try:
            # Get payer portal config
            portal_config = await db.payer_portals.find_one(
                {"_id": payer_portal_id, "is_active": True}
            )
            
            if not portal_config:
                return {"status": "error", "message": "Portal config not found"}
            
            # Decrypt credentials (placeholder - implement actual decryption)
            credentials = portal_config["credentials_encrypted"]
            
            async with TinyFishScraper() as scraper:
                # Scrape denials
                claims = await scraper.scrape_aetna_denials(
                    portal_username=credentials["username"],
                    portal_password=credentials["password"],
                    date_from=(datetime.utcnow().replace(day=1)).strftime("%Y-%m-%d"),
                    date_to=datetime.utcnow().strftime("%Y-%m-%d")
                )
                
                # Store in MongoDB
                stored_count = 0
                for claim in claims:
                    # Check if claim already exists
                    existing = await db.denial_claims.find_one(
                        {"denial.claim_number": claim.claim_number}
                    )
                    if not existing:
                        # Insert new denial claim
                        claim_doc = {
                            "organization_id": organization_id,
                            "patient": {
                                "patient_id": f"auto_{claim.claim_number}",
                                "mrn": "[ENCRYPTED]",
                                "first_name": claim.patient_name.split()[0] if claim.patient_name else "[ENCRYPTED]",
                                "last_name": claim.patient_name.split()[-1] if claim.patient_name else "[ENCRYPTED]",
                                "date_of_birth": "[ENCRYPTED]",
                                "insurance_member_id": claim.patient_member_id,
                                "payer_id": portal_config["payer_id"],
                                "payer_name": portal_config["payer_name"],
                            },
                            "procedure": {
                                "procedure_code": claim.procedure_code,
                                "procedure_description": "",
                                "diagnosis_codes": [],
                                "service_date": datetime.fromisoformat(claim.service_date) if claim.service_date else datetime.utcnow(),
                                "provider_npi": "",
                                "billed_amount": claim.billed_amount,
                            },
                            "denial": {
                                "denial_code": claim.denial_code,
                                "denial_description": claim.denial_reason,
                                "denial_type": "detected",
                                "denial_date": datetime.fromisoformat(claim.denial_date) if claim.denial_date else datetime.utcnow(),
                                "claim_number": claim.claim_number,
                                "internal_claim_id": f"auto_{claim.claim_number}",
                                "raw_portal_text": claim.raw_text,
                            },
                            "status": "detected",
                            "scraper_evidence": {
                                "workflow_id": portal_config.get("tinyfish_workflow_id", ""),
                                "portal_url": portal_config["portal_url"],
                                "scraped_text": claim.raw_text[:1000],
                                "extraction_timestamp": datetime.utcnow(),
                                "confidence_score": claim.confidence,
                                "scraping_agent_version": "1.0.0",
                            },
                            "baa_agreement_id": "baa_2025_001",
                        }
                        
                        await db.denial_claims.insert_one(claim_doc)
                        stored_count += 1
                
                # Update portal last scrape time
                await db.payer_portals.update_one(
                    {"_id": payer_portal_id},
                    {
                        "$set": {
                            "last_successful_scrape": datetime.utcnow(),
                            "fail_count": 0
                        }
                    }
                )
                
                # Audit log
                await audit.log_action(
                    actor_type="system",
                    actor_id="scraper_scheduler",
                    action="scheduled_scrape_complete",
                    resource_type="payer_portal",
                    resource_id=payer_portal_id,
                    changes={
                        "claims_found": len(claims),
                        "claims_stored": stored_count,
                        "duration_seconds": (datetime.utcnow() - start_time).total_seconds()
                    }
                )
                
                return {
                    "status": "success",
                    "claims_found": len(claims),
                    "claims_stored": stored_count,
                    "duration_seconds": (datetime.utcnow() - start_time).total_seconds()
                }
                
        except Exception as e:
            # Update fail count
            await db.payer_portals.update_one(
                {"_id": payer_portal_id},
                {"$inc": {"fail_count": 1}}
            )
            
            await audit.log_action(
                actor_type="system",
                actor_id="scraper_scheduler",
                action="scheduled_scrape_failed",
                resource_type="payer_portal",
                resource_id=payer_portal_id,
                changes={"error": str(e)}
            )
            
            return {"status": "error", "message": str(e)}
