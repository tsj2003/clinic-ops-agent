"""
AG2 Multi-Agent Orchestrator for Denial Management Workflow
Coordinates specialized agents: Scraper, Diagnostic, Appeals Writer
"""

import os
import asyncio
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import json


class AgentRole(str, Enum):
    """Agent roles in the denial management workflow"""
    SCRAPER = "scraper"
    DIAGNOSTIC = "diagnostic"
    APPEALS_WRITER = "appeals_writer"
    SUBMITTER = "submitter"
    AUDITOR = "auditor"


class WorkflowStage(str, Enum):
    """Workflow stages"""
    INTAKE = "intake"
    DETECTION = "detection"
    ANALYSIS = "analysis"
    DRAFTING = "drafting"
    APPROVAL = "approval"
    SUBMISSION = "submission"
    COMPLETE = "complete"


@dataclass
class AgentMessage:
    """Message passed between agents"""
    from_agent: AgentRole
    to_agent: AgentRole
    message_type: str
    payload: Dict[str, Any]
    timestamp: datetime


@dataclass
class WorkflowContext:
    """Shared context across workflow"""
    claim_id: str
    organization_id: str
    stage: WorkflowStage
    data: Dict[str, Any]
    messages: List[AgentMessage]
    completed_agents: List[AgentRole]
    failed_agents: List[AgentRole]
    created_at: datetime
    updated_at: datetime


class BaseAgent:
    """Base class for all agents"""
    
    def __init__(self, role: AgentRole, llm_config: Optional[Dict] = None):
        self.role = role
        self.llm_config = llm_config or {}
        self.message_handlers: List[Callable] = []
    
    async def process(self, context: WorkflowContext) -> WorkflowContext:
        """Process the current stage - override in subclasses"""
        raise NotImplementedError
    
    async def send_message(
        self,
        to_agent: AgentRole,
        message_type: str,
        payload: Dict[str, Any]
    ) -> AgentMessage:
        """Send message to another agent"""
        return AgentMessage(
            from_agent=self.role,
            to_agent=to_agent,
            message_type=message_type,
            payload=payload,
            timestamp=datetime.utcnow()
        )


class ScraperAgent(BaseAgent):
    """
    Agent 1: Scraper Agent
    Uses TinyFish to log into payer portals and extract denial data
    """
    
    def __init__(self, tinyfish_config: Optional[Dict] = None):
        super().__init__(AgentRole.SCRAPER)
        self.tinyfish_config = tinyfish_config or {}
    
    async def process(self, context: WorkflowContext) -> WorkflowContext:
        """Run scraping workflow"""
        from ..scrapers.tinyfish_scraper import TinyFishScraper
        
        claim_id = context.claim_id
        payer_id = context.data.get("payer_id")
        
        # Get portal credentials from secure storage
        portal_config = context.data.get("portal_config", {})
        
        try:
            async with TinyFishScraper(
                api_key=self.tinyfish_config.get("api_key")
            ) as scraper:
                
                # Scrape denials
                if payer_id == "aetna":
                    claims = await scraper.scrape_aetna_denials(
                        portal_username=portal_config["username"],
                        portal_password=portal_config["password"],
                        date_from=context.data.get("date_from"),
                        date_to=context.data.get("date_to")
                    )
                else:
                    claims = await scraper.scrape_uhc_denials(
                        portal_username=portal_config["username"],
                        portal_password=portal_config["password"],
                        date_from=context.data.get("date_from"),
                        date_to=context.data.get("date_to")
                    )
                
                # Update context with scraped data
                context.data["scraped_claims"] = [
                    {
                        "claim_number": c.claim_number,
                        "patient_name": c.patient_name,
                        "denial_code": c.denial_code,
                        "denial_reason": c.denial_reason,
                        "billed_amount": c.billed_amount,
                        "raw_text": c.raw_text,
                        "confidence": c.confidence,
                    }
                    for c in claims
                ]
                context.data["scrape_status"] = "success"
                context.completed_agents.append(self.role)
                
                # Send message to Diagnostic Agent
                message = await self.send_message(
                    AgentRole.DIAGNOSTIC,
                    "scraping_complete",
                    {"claim_count": len(claims), "claim_id": claim_id}
                )
                context.messages.append(message)
                
        except Exception as e:
            context.data["scrape_status"] = f"failed: {str(e)}"
            context.failed_agents.append(self.role)
        
        context.updated_at = datetime.utcnow()
        return context


class DiagnosticAgent(BaseAgent):
    """
    Agent 2: Diagnostic Agent
    Uses Fireworks.ai + Mixedbread RAG to analyze denials
    """
    
    def __init__(
        self,
        fireworks_api_key: Optional[str] = None,
        mixedbread_api_key: Optional[str] = None
    ):
        super().__init__(AgentRole.DIAGNOSTIC)
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.mixedbread_api_key = mixedbread_api_key or os.getenv("MIXEDBREAD_API_KEY")
    
    async def process(self, context: WorkflowContext) -> WorkflowContext:
        """Analyze denial and determine appeal strategy"""
        
        scraped_claims = context.data.get("scraped_claims", [])
        
        if not scraped_claims:
            context.data["analysis_status"] = "no_claims_to_analyze"
            return context
        
        # Analyze each scraped claim
        analyses = []
        for claim in scraped_claims:
            analysis = await self._analyze_claim(claim, context)
            analyses.append(analysis)
        
        context.data["analyses"] = analyses
        context.data["analysis_status"] = "complete"
        context.completed_agents.append(self.role)
        
        # Send message to Appeals Writer
        message = await self.send_message(
            AgentRole.APPEALS_WRITER,
            "analysis_complete",
            {"analyzed_count": len(analyses), "claim_id": context.claim_id}
        )
        context.messages.append(message)
        
        context.updated_at = datetime.utcnow()
        return context
    
    async def _analyze_claim(
        self,
        claim: Dict[str, Any],
        context: WorkflowContext
    ) -> Dict[str, Any]:
        """Analyze single claim using Fireworks.ai + RAG"""
        
        # 1. Query Mixedbread RAG for policy lookup
        policy_context = await self._query_rag(
            query=f"Denial code {claim['denial_code']}: {claim['denial_reason']}",
            filters={"document_type": "medical_policy", "payer": context.data.get("payer_name")}
        )
        
        # 2. Query patient chart if available
        chart_context = await self._query_rag(
            query=f"Patient procedures and diagnosis for claim {claim['claim_number']}",
            filters={"document_type": "clinical_notes", "patient_id": claim.get("patient_id")}
        )
        
        # 3. Call Fireworks.ai for analysis
        analysis_result = await self._call_fireworks(
            claim=claim,
            policy_context=policy_context,
            chart_context=chart_context
        )
        
        return {
            "claim_number": claim["claim_number"],
            "denial_type": analysis_result.get("denial_type", "unknown"),
            "appeal_probability": analysis_result.get("appeal_probability", 0.5),
            "recommended_action": analysis_result.get("recommended_action", "review"),
            "medical_necessity_analysis": analysis_result.get("medical_necessity", ""),
            "policy_references": policy_context.get("references", []),
            "clinical_evidence": chart_context.get("evidence", []),
        }
    
    async def _query_rag(
        self,
        query: str,
        filters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Query Mixedbread RAG for relevant documents"""
        import aiohttp
        
        url = "https://api.mixedbread.ai/v1/rag"
        headers = {
            "Authorization": f"Bearer {self.mixedbread_api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "query": query,
            "filters": filters,
            "top_k": 5,
            "return_documents": True
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return {
                            "references": [doc.get("title", "") for doc in data.get("documents", [])],
                            "context": "\n\n".join([doc.get("content", "") for doc in data.get("documents", [])])
                        }
                    else:
                        return {"references": [], "context": ""}
        except Exception as e:
            print(f"⚠️  RAG query failed: {e}")
            return {"references": [], "context": ""}
    
    async def _call_fireworks(
        self,
        claim: Dict[str, Any],
        policy_context: Dict[str, Any],
        chart_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call Fireworks.ai for denial analysis"""
        import aiohttp
        
        url = "https://api.fireworks.ai/inference/v1/completions"
        headers = {
            "Authorization": f"Bearer {self.fireworks_api_key}",
            "Content-Type": "application/json"
        }
        
        prompt = f"""You are a medical billing expert analyzing a claim denial.

Claim Information:
- Claim Number: {claim['claim_number']}
- Denial Code: {claim['denial_code']}
- Denial Reason: {claim['denial_reason']}
- Billed Amount: ${claim['billed_amount']}

Policy Context:
{policy_context.get('context', 'No policy context available')}

Clinical Context:
{chart_context.get('context', 'No clinical context available')}

Analyze this denial and provide:
1. Denial type category
2. Appeal probability (0-1)
3. Recommended action
4. Medical necessity analysis
5. Key supporting arguments

Respond in JSON format."""
        
        payload = {
            "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
            "prompt": prompt,
            "max_tokens": 1000,
            "temperature": 0.3,
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        completion = data.get("choices", [{}])[0].get("text", "")
                        
                        # Parse JSON from completion
                        try:
                            if "```json" in completion:
                                json_str = completion.split("```json")[1].split("```")[0].strip()
                            elif "```" in completion:
                                json_str = completion.split("```")[1].split("```")[0].strip()
                            else:
                                json_str = completion
                            
                            return json.loads(json_str)
                        except json.JSONDecodeError:
                            return {
                                "denial_type": "unknown",
                                "appeal_probability": 0.5,
                                "recommended_action": "manual_review",
                                "medical_necessity": completion[:500]
                            }
                    else:
                        return {"error": f"API returned {resp.status}"}
        except Exception as e:
            print(f"⚠️  Fireworks API call failed: {e}")
            return {"error": str(e)}


class AppealsWriterAgent(BaseAgent):
    """
    Agent 3: Appeals Writer Agent
    Drafts medically sound, highly specific appeal letters
    """
    
    def __init__(self, fireworks_api_key: Optional[str] = None):
        super().__init__(AgentRole.APPEALS_WRITER)
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
    
    async def process(self, context: WorkflowContext) -> WorkflowContext:
        """Draft appeal letters for analyzed claims"""
        
        analyses = context.data.get("analyses", [])
        
        if not analyses:
            context.data["drafting_status"] = "no_analyses_to_draft"
            return context
        
        drafts = []
        for analysis in analyses:
            if analysis.get("appeal_probability", 0) > 0.3:  # Threshold for drafting
                draft = await self._draft_appeal(analysis, context)
                drafts.append(draft)
        
        context.data["appeal_drafts"] = drafts
        context.data["drafting_status"] = "complete"
        context.completed_agents.append(self.role)
        
        # Send message to indicate drafting complete (approval needed)
        message = await self.send_message(
            AgentRole.AUDITOR,
            "drafts_ready_for_approval",
            {"draft_count": len(drafts), "claim_id": context.claim_id}
        )
        context.messages.append(message)
        
        context.updated_at = datetime.utcnow()
        return context
    
    async def _draft_appeal(
        self,
        analysis: Dict[str, Any],
        context: WorkflowContext
    ) -> Dict[str, Any]:
        """Generate appeal letter using Fireworks.ai"""
        import aiohttp
        
        url = "https://api.fireworks.ai/inference/v1/completions"
        headers = {
            "Authorization": f"Bearer {self.fireworks_api_key}",
            "Content-Type": "application/json"
        }
        
        prompt = f"""Draft a professional medical claim appeal letter.

Analysis:
{json.dumps(analysis, indent=2)}

Requirements:
- Formal, professional tone
- Cite specific medical policies and guidelines
- Reference supporting clinical evidence
- Include all relevant procedure and diagnosis codes
- Clearly state the medical necessity
- Request specific action (reconsideration)
- Include space for physician signature if needed

Generate a complete, ready-to-submit appeal letter."""
        
        payload = {
            "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
            "prompt": prompt,
            "max_tokens": 2000,
            "temperature": 0.4,
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        letter = data.get("choices", [{}])[0].get("text", "")
                        
                        return {
                            "claim_number": analysis["claim_number"],
                            "appeal_letter": letter,
                            "word_count": len(letter.split()),
                            "requires_md_signature": "physician" in letter.lower() or "md" in letter.lower(),
                            "supporting_documents": analysis.get("policy_references", []),
                            "created_at": datetime.utcnow().isoformat()
                        }
                    else:
                        return {"error": f"API returned {resp.status}"}
        except Exception as e:
            print(f"⚠️  Appeal drafting failed: {e}")
            return {"error": str(e)}


class AG2Orchestrator:
    """
    Main orchestrator coordinating multi-agent workflow
    """
    
    def __init__(self):
        self.agents: Dict[AgentRole, BaseAgent] = {}
        self.active_contexts: Dict[str, WorkflowContext] = {}
    
    def register_agent(self, agent: BaseAgent):
        """Register an agent with the orchestrator"""
        self.agents[agent.role] = agent
    
    async def start_workflow(
        self,
        claim_id: str,
        organization_id: str,
        initial_data: Dict[str, Any]
    ) -> str:
        """Start a new denial management workflow"""
        
        context = WorkflowContext(
            claim_id=claim_id,
            organization_id=organization_id,
            stage=WorkflowStage.INTAKE,
            data=initial_data,
            messages=[],
            completed_agents=[],
            failed_agents=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        self.active_contexts[claim_id] = context
        
        # Start the workflow
        asyncio.create_task(self._run_workflow(claim_id))
        
        return claim_id
    
    async def _run_workflow(self, claim_id: str):
        """Execute workflow stages sequentially"""
        context = self.active_contexts.get(claim_id)
        if not context:
            return
        
        try:
            # Stage 1: Detection (Scraper)
            context.stage = WorkflowStage.DETECTION
            scraper = self.agents.get(AgentRole.SCRAPER)
            if scraper:
                context = await scraper.process(context)
            
            # Stage 2: Analysis (Diagnostic)
            if AgentRole.SCRAPER in context.completed_agents:
                context.stage = WorkflowStage.ANALYSIS
                diagnostic = self.agents.get(AgentRole.DIAGNOSTIC)
                if diagnostic:
                    context = await diagnostic.process(context)
            
            # Stage 3: Drafting (Appeals Writer)
            if AgentRole.DIAGNOSTIC in context.completed_agents:
                context.stage = WorkflowStage.DRAFTING
                writer = self.agents.get(AgentRole.APPEALS_WRITER)
                if writer:
                    context = await writer.process(context)
            
            # Stage 4: Pending Approval
            if AgentRole.APPEALS_WRITER in context.completed_agents:
                context.stage = WorkflowStage.APPROVAL
                # Store to MongoDB for human approval
                await self._store_for_approval(context)
            
            context.stage = WorkflowStage.COMPLETE
            
        except Exception as e:
            print(f"❌ Workflow {claim_id} failed: {e}")
            context.data["workflow_error"] = str(e)
        
        context.updated_at = datetime.utcnow()
        self.active_contexts[claim_id] = context
    
    async def _store_for_approval(self, context: WorkflowContext):
        """Store drafts in MongoDB for human approval"""
        from ..database.connection import get_db
        
        db = await get_db()
        
        for draft in context.data.get("appeal_drafts", []):
            if "error" not in draft:
                await db.denial_claims.update_one(
                    {"denial.claim_number": draft["claim_number"]},
                    {
                        "$set": {
                            "status": "appeal_drafted",
                            "analysis": context.data.get("analyses", [{}])[0],
                            "appeal_drafts": [draft],
                            "current_draft_id": draft["claim_number"],
                            "updated_at": datetime.utcnow()
                        }
                    }
                )
    
    async def approve_and_submit(
        self,
        claim_id: str,
        draft_id: str,
        approver_id: str,
        modifications: Optional[str] = None
    ) -> Dict[str, Any]:
        """Submit approved appeal via TinyFish"""
        from ..database.connection import get_db
        from ..compliance.audit import AuditLogger
        
        db = await get_db()
        audit = AuditLogger(db)
        
        # Get claim data
        claim = await db.denial_claims.find_one({"_id": claim_id})
        if not claim:
            return {"status": "error", "message": "Claim not found"}
        
        # Get portal config
        portal_config = await db.payer_portals.find_one(
            {"payer_id": claim["patient"]["payer_id"]}
        )
        
        # Update approval record
        await db.denial_claims.update_one(
            {"_id": claim_id},
            {
                "$set": {
                    "status": "submitted",
                    "approval": {
                        "approval_id": f"appr_{datetime.utcnow().timestamp()}",
                        "approver_user_id": approver_id,
                        "approver_name": "Billing Analyst",
                        "approval_timestamp": datetime.utcnow(),
                        "approval_action": "approved",
                        "modifications_made": modifications
                    },
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        # Log audit
        await audit.log_action(
            actor_type="user",
            actor_id=approver_id,
            action="appeal_approved",
            resource_type="denial_claim",
            resource_id=claim_id,
            changes={"draft_id": draft_id, "modifications": modifications}
        )
        
        # Submit via TinyFish
        from ..scrapers.tinyfish_scraper import TinyFishScraper
        
        async with TinyFishScraper() as scraper:
            result = await scraper.submit_appeal_portal(
                workflow_url=portal_config["tinyfish_workflow_url"],
                claim_number=claim["denial"]["claim_number"],
                appeal_letter=claim["appeal_drafts"][0]["appeal_letter"],
                supporting_docs=claim["appeal_drafts"][0].get("supporting_documents", []),
                portal_username=portal_config["credentials_encrypted"]["username"],
                portal_password=portal_config["credentials_encrypted"]["password"]
            )
        
        # Update submission record
        await db.denial_claims.update_one(
            {"_id": claim_id},
            {
                "$set": {
                    "submission": {
                        "submission_id": f"sub_{datetime.utcnow().timestamp()}",
                        "submitted_timestamp": datetime.utcnow(),
                        "submission_method": "portal",
                        "confirmation_number": result.get("final_answer", {}).get("confirmation_number"),
                        "submitted_by_agent": "TinyFish"
                    }
                }
            }
        )
        
        return {"status": "success", "submission_result": result}
    
    def get_workflow_status(self, claim_id: str) -> Optional[WorkflowContext]:
        """Get current workflow status"""
        return self.active_contexts.get(claim_id)


# Factory function to create configured orchestrator
def create_orchestrator(
    tinyfish_api_key: Optional[str] = None,
    fireworks_api_key: Optional[str] = None,
    mixedbread_api_key: Optional[str] = None
) -> AG2Orchestrator:
    """Create and configure the AG2 orchestrator with all agents"""
    
    orchestrator = AG2Orchestrator()
    
    # Register agents
    orchestrator.register_agent(ScraperAgent(
        tinyfish_config={"api_key": tinyfish_api_key}
    ))
    
    orchestrator.register_agent(DiagnosticAgent(
        fireworks_api_key=fireworks_api_key,
        mixedbread_api_key=mixedbread_api_key
    ))
    
    orchestrator.register_agent(AppealsWriterAgent(
        fireworks_api_key=fireworks_api_key
    ))
    
    return orchestrator
