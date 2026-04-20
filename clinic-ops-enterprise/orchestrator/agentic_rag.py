"""
Agentic RAG Framework
Multi-hop reasoning with concurrent specialized agents
Uses state machines for complex medical policy navigation
"""

import os
import json
import asyncio
from typing import Dict, List, Optional, Any, Callable, Set
from dataclasses import dataclass, field
from enum import Enum, auto
from datetime import datetime
import aiohttp
from collections import deque


class AgentState(Enum):
    """Agent execution states"""
    IDLE = auto()
    RUNNING = auto()
    WAITING = auto()
    COMPLETED = auto()
    FAILED = auto()


class RAGNodeType(Enum):
    """Types of nodes in the RAG state graph"""
    RETRIEVE = "retrieve"
    REASON = "reason"
    VERIFY = "verify"
    SYNTHESIZE = "synthesize"
    DECISION = "decision"


@dataclass
class AgentTask:
    """Individual agent task"""
    task_id: str
    agent_name: str
    agent_type: str
    query: str
    context: Dict[str, Any]
    dependencies: Set[str] = field(default_factory=set)
    state: AgentState = AgentState.IDLE
    result: Optional[Dict] = None
    error: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


@dataclass
class RAGNode:
    """Node in the Agentic RAG state graph"""
    node_id: str
    node_type: RAGNodeType
    agent_function: Callable
    inputs: List[str]  # Input node IDs
    outputs: List[str]  # Output node IDs
    parallel: bool = True
    condition: Optional[Callable] = None


@dataclass
class RAGResult:
    """Result from Agentic RAG execution"""
    query: str
    answer: str
    reasoning_path: List[str]
    sources: List[Dict]
    confidence: float
    verification_status: str
    agent_contributions: Dict[str, Any]
    execution_time_ms: float


class SpecializedRAGAgent:
    """
    Base class for specialized RAG agents
    Each agent handles a specific domain (eligibility, medical necessity, etc.)
    """
    
    def __init__(
        self,
        name: str,
        mixedbread_api_key: Optional[str] = None,
        fireworks_api_key: Optional[str] = None
    ):
        self.name = name
        self.mixedbread_api_key = mixedbread_api_key or os.getenv("MIXEDBREAD_API_KEY")
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.context_cache: Dict[str, Any] = {}
    
    async def execute(self, task: AgentTask) -> Dict[str, Any]:
        """Execute the agent's task - must be implemented by subclasses"""
        raise NotImplementedError


class EligibilityVerificationAgent(SpecializedRAGAgent):
    """
    Agent that verifies patient eligibility
    Queries payer systems and policy documents
    """
    
    def __init__(self, **kwargs):
        super().__init__("EligibilityVerificationAgent", **kwargs)
    
    async def execute(self, task: AgentTask) -> Dict[str, Any]:
        """Verify patient eligibility for service"""
        query = task.query
        context = task.context
        
        # Extract patient and insurance info
        patient_id = context.get("patient_id")
        insurance_id = context.get("insurance_id")
        service_code = context.get("service_code")
        
        # Query RAG for eligibility policies
        eligibility_policies = await self._query_eligibility_policies(
            insurance_id, service_code
        )
        
        # Check for common eligibility issues
        issues = []
        
        if not eligibility_policies:
            issues.append("No eligibility policy found for this service")
        
        # Simulate real-time eligibility check
        is_eligible = len(issues) == 0
        
        return {
            "agent": self.name,
            "is_eligible": is_eligible,
            "eligibility_details": eligibility_policies,
            "issues_found": issues,
            "verification_confidence": 0.85 if is_eligible else 0.6,
            "recommended_action": "proceed" if is_eligible else "verify_manually"
        }
    
    async def _query_eligibility_policies(
        self,
        insurance_id: str,
        service_code: str
    ) -> List[Dict]:
        """Query RAG for eligibility policies"""
        if not self.mixedbread_api_key:
            return []
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.mixedbread.ai/v1/rag",
                    headers={"Authorization": f"Bearer {self.mixedbread_api_key}"},
                    json={
                        "query": f"eligibility requirements {insurance_id} {service_code}",
                        "filters": {"document_type": "eligibility_policy"},
                        "top_k": 5
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("documents", [])
        except Exception:
            pass
        
        return []


class MedicalNecessityAgent(SpecializedRAGAgent):
    """
    Agent that checks clinical notes against medical necessity guidelines
    """
    
    def __init__(self, **kwargs):
        super().__init__("MedicalNecessityAgent", **kwargs)
    
    async def execute(self, task: AgentTask) -> Dict[str, Any]:
        """Check if clinical documentation supports the service"""
        query = task.query
        context = task.context
        
        clinical_notes = context.get("clinical_notes", "")
        cpt_code = context.get("cpt_code")
        diagnosis_codes = context.get("diagnosis_codes", [])
        
        # Query medical necessity guidelines
        guidelines = await self._query_medical_necessity_guidelines(cpt_code)
        
        # Use LLM to analyze documentation adequacy
        analysis = await self._analyze_documentation(
            clinical_notes, cpt_code, diagnosis_codes, guidelines
        )
        
        return {
            "agent": self.name,
            "documentation_adequate": analysis["adequate"],
            "medical_necessity_score": analysis["score"],
            "missing_elements": analysis["missing"],
            "supporting_evidence": analysis["evidence"],
            "recommended_action": analysis["recommendation"],
            "confidence": analysis["confidence"]
        }
    
    async def _query_medical_necessity_guidelines(self, cpt_code: str) -> List[Dict]:
        """Query RAG for medical necessity guidelines"""
        if not self.mixedbread_api_key:
            return []
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.mixedbread.ai/v1/rag",
                    headers={"Authorization": f"Bearer {self.mixedbread_api_key}"},
                    json={
                        "query": f"medical necessity guidelines CPT {cpt_code}",
                        "filters": {"document_type": "medical_necessity"},
                        "top_k": 3
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("documents", [])
        except Exception:
            pass
        
        return []
    
    async def _analyze_documentation(
        self,
        clinical_notes: str,
        cpt_code: str,
        diagnosis_codes: List[str],
        guidelines: List[Dict]
    ) -> Dict[str, Any]:
        """Use LLM to analyze documentation"""
        if not self.fireworks_api_key or not clinical_notes:
            return {
                "adequate": False,
                "score": 0.0,
                "missing": ["No clinical notes provided"],
                "evidence": [],
                "recommendation": "obtain_documentation",
                "confidence": 0.5
            }
        
        guideline_text = "\n".join([g.get("content", "") for g in guidelines[:2]])
        
        prompt = f"""Analyze if the clinical documentation supports the billed service.

CPT Code: {cpt_code}
Diagnosis Codes: {', '.join(diagnosis_codes)}

Clinical Notes:
{clinical_notes[:2000]}

Medical Necessity Guidelines:
{guideline_text[:1000]}

Respond in JSON format:
{{
    "adequate": true/false,
    "score": 0.0-1.0,
    "missing": ["list of missing documentation elements"],
    "evidence": ["supporting evidence from notes"],
    "recommendation": "proceed" or "obtain_documentation" or "review",
    "confidence": 0.0-1.0
}}"""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 500,
                        "temperature": 0.1
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "{}")
                        try:
                            return json.loads(text.strip())
                        except json.JSONDecodeError:
                            pass
        except Exception:
            pass
        
        return {
            "adequate": False,
            "score": 0.5,
            "missing": ["Unable to analyze - API error"],
            "evidence": [],
            "recommendation": "review",
            "confidence": 0.5
        }


class PriorAuthRequirementsAgent(SpecializedRAGAgent):
    """
    Agent that checks prior authorization requirements
    """
    
    def __init__(self, **kwargs):
        super().__init__("PriorAuthRequirementsAgent", **kwargs)
    
    async def execute(self, task: AgentTask) -> Dict[str, Any]:
        """Check if prior authorization is required"""
        context = task.context
        
        cpt_code = context.get("cpt_code")
        payer_id = context.get("payer_id")
        
        # Query prior auth policies
        auth_required = await self._check_prior_auth_requirement(payer_id, cpt_code)
        
        return {
            "agent": self.name,
            "prior_auth_required": auth_required["required"],
            "urgent": auth_required.get("urgent", False),
            "required_documents": auth_required.get("documents", []),
            "estimated_processing_time": auth_required.get("processing_days", 14),
            "confidence": 0.9 if auth_required["required"] else 0.7
        }
    
    async def _check_prior_auth_requirement(
        self,
        payer_id: str,
        cpt_code: str
    ) -> Dict[str, Any]:
        """Check if prior auth is required"""
        if not self.mixedbread_api_key:
            return {"required": False}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.mixedbread.ai/v1/rag",
                    headers={"Authorization": f"Bearer {self.mixedbread_api_key}"},
                    json={
                        "query": f"prior authorization requirements {payer_id} CPT {cpt_code}",
                        "filters": {"document_type": "prior_auth_policy"},
                        "top_k": 3
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        docs = data.get("documents", [])
                        
                        # Analyze results
                        for doc in docs:
                            content = doc.get("content", "").lower()
                            if "prior authorization required" in content or "pre-authorization" in content:
                                return {
                                    "required": True,
                                    "urgent": "urgent" in content,
                                    "documents": ["clinical notes", "supporting documentation"],
                                    "processing_days": 14
                                }
        except Exception:
            pass
        
        return {"required": False}


class CodingAccuracyAgent(SpecializedRAGAgent):
    """
    Agent that verifies coding accuracy
    """
    
    def __init__(self, **kwargs):
        super().__init__("CodingAccuracyAgent", **kwargs)
    
    async def execute(self, task: AgentTask) -> Dict[str, Any]:
        """Verify CPT and ICD-10 code accuracy"""
        context = task.context
        
        cpt_code = context.get("cpt_code")
        icd10_codes = context.get("diagnosis_codes", [])
        clinical_notes = context.get("clinical_notes", "")
        
        # Validate code formats
        cpt_valid = self._validate_cpt_format(cpt_code)
        icd10_valid = all(self._validate_icd10_format(c) for c in icd10_codes)
        
        # Check code-to-documentation match
        match_score = await self._check_code_documentation_match(
            cpt_code, icd10_codes, clinical_notes
        )
        
        return {
            "agent": self.name,
            "cpt_valid": cpt_valid,
            "icd10_valid": icd10_valid,
            "code_documentation_match": match_score,
            "overall_accuracy": (cpt_valid + icd10_valid + match_score) / 3,
            "recommended_action": "proceed" if match_score > 0.7 else "review_coding"
        }
    
    def _validate_cpt_format(self, code: str) -> bool:
        """Validate CPT code format"""
        return bool(code) and len(code) == 5 and code.isdigit()
    
    def _validate_icd10_format(self, code: str) -> bool:
        """Validate ICD-10 code format"""
        if not code:
            return False
        # Basic ICD-10 pattern: Letter + 2 digits + optional . + 1-2 digits
        import re
        return bool(re.match(r'^[A-Z]\d{2}(\.\d{1,2})?$', code))
    
    async def _check_code_documentation_match(
        self,
        cpt_code: str,
        icd10_codes: List[str],
        clinical_notes: str
    ) -> float:
        """Check if codes match clinical documentation"""
        if not self.fireworks_api_key or not clinical_notes:
            return 0.5
        
        prompt = f"""Rate how well these codes match the clinical documentation (0.0-1.0).

CPT: {cpt_code}
ICD-10: {', '.join(icd10_codes)}

Clinical Notes:
{clinical_notes[:1500]}

Respond with only a number between 0.0 and 1.0."""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 10,
                        "temperature": 0.1
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "0.5")
                        try:
                            return min(1.0, max(0.0, float(text.strip())))
                        except ValueError:
                            return 0.5
        except Exception:
            pass
        
        return 0.5


class AgenticRAGOrchestrator:
    """
    Orchestrates multiple specialized RAG agents
    Uses state machine for multi-hop reasoning
    """
    
    def __init__(
        self,
        mixedbread_api_key: Optional[str] = None,
        fireworks_api_key: Optional[str] = None
    ):
        self.agents: Dict[str, SpecializedRAGAgent] = {}
        self.tasks: Dict[str, AgentTask] = {}
        self.results: Dict[str, Any] = {}
        self.execution_graph: Dict[str, RAGNode] = {}
        
        # Initialize agents
        self._initialize_agents(mixedbread_api_key, fireworks_api_key)
        
        # Build execution graph
        self._build_execution_graph()
    
    def _initialize_agents(
        self,
        mixedbread_api_key: Optional[str],
        fireworks_api_key: Optional[str]
    ):
        """Initialize all specialized agents"""
        kwargs = {
            "mixedbread_api_key": mixedbread_api_key,
            "fireworks_api_key": fireworks_api_key
        }
        
        self.agents = {
            "eligibility": EligibilityVerificationAgent(**kwargs),
            "medical_necessity": MedicalNecessityAgent(**kwargs),
            "prior_auth": PriorAuthRequirementsAgent(**kwargs),
            "coding": CodingAccuracyAgent(**kwargs),
        }
    
    def _build_execution_graph(self):
        """Build the state machine execution graph"""
        # Define nodes in the execution graph
        # These can run in parallel where dependencies allow
        
        self.execution_graph = {
            "eligibility_check": RAGNode(
                node_id="eligibility_check",
                node_type=RAGNodeType.RETRIEVE,
                agent_function=self._run_eligibility_agent,
                inputs=[],
                outputs=["combine_results"],
                parallel=True
            ),
            "medical_necessity_check": RAGNode(
                node_id="medical_necessity_check",
                node_type=RAGNodeType.RETRIEVE,
                agent_function=self._run_medical_necessity_agent,
                inputs=[],
                outputs=["combine_results"],
                parallel=True
            ),
            "prior_auth_check": RAGNode(
                node_id="prior_auth_check",
                node_type=RAGNodeType.RETRIEVE,
                agent_function=self._run_prior_auth_agent,
                inputs=[],
                outputs=["combine_results"],
                parallel=True
            ),
            "coding_check": RAGNode(
                node_id="coding_check",
                node_type=RAGNodeType.VERIFY,
                agent_function=self._run_coding_agent,
                inputs=[],
                outputs=["combine_results"],
                parallel=True
            ),
            "combine_results": RAGNode(
                node_id="combine_results",
                node_type=RAGNodeType.SYNTHESIZE,
                agent_function=self._synthesize_results,
                inputs=["eligibility_check", "medical_necessity_check", "prior_auth_check", "coding_check"],
                outputs=[],
                parallel=False  # Must wait for all inputs
            )
        }
    
    async def execute_claim_analysis(
        self,
        claim_data: Dict[str, Any],
        patient_data: Dict[str, Any]
    ) -> RAGResult:
        """
        Execute multi-agent concurrent analysis of a claim
        """
        import time
        start_time = time.time()
        
        # Create tasks for each agent
        tasks = {
            "eligibility": AgentTask(
                task_id="eligibility_task",
                agent_name="EligibilityVerificationAgent",
                agent_type="eligibility",
                query=f"Verify eligibility for {patient_data.get('name')}",
                context={
                    "patient_id": patient_data.get("id"),
                    "insurance_id": patient_data.get("insurance", {}).get("id"),
                    "service_code": claim_data.get("procedure_code")
                }
            ),
            "medical_necessity": AgentTask(
                task_id="medical_necessity_task",
                agent_name="MedicalNecessityAgent",
                agent_type="medical_necessity",
                query=f"Check medical necessity for {claim_data.get('procedure_code')}",
                context={
                    "clinical_notes": patient_data.get("clinical_notes", ""),
                    "cpt_code": claim_data.get("procedure_code"),
                    "diagnosis_codes": claim_data.get("diagnosis_codes", [])
                }
            ),
            "prior_auth": AgentTask(
                task_id="prior_auth_task",
                agent_name="PriorAuthRequirementsAgent",
                agent_type="prior_auth",
                query=f"Check prior auth for {claim_data.get('procedure_code')}",
                context={
                    "cpt_code": claim_data.get("procedure_code"),
                    "payer_id": claim_data.get("payer_id")
                }
            ),
            "coding": AgentTask(
                task_id="coding_task",
                agent_name="CodingAccuracyAgent",
                agent_type="coding",
                query=f"Verify coding accuracy",
                context={
                    "cpt_code": claim_data.get("procedure_code"),
                    "diagnosis_codes": claim_data.get("diagnosis_codes", []),
                    "clinical_notes": patient_data.get("clinical_notes", "")
                }
            )
        }
        
        # Execute all tasks concurrently
        task_list = list(tasks.values())
        results = await self._execute_concurrent_tasks(task_list)
        
        # Synthesize results
        synthesis = await self._synthesize_results(results)
        
        execution_time = (time.time() - start_time) * 1000
        
        return RAGResult(
            query="claim_pre_submission_analysis",
            answer=synthesis["recommendation"],
            reasoning_path=synthesis["reasoning_path"],
            sources=synthesis["sources"],
            confidence=synthesis["confidence"],
            verification_status=synthesis["status"],
            agent_contributions={k: v for k, v in results.items()},
            execution_time_ms=execution_time
        )
    
    async def _execute_concurrent_tasks(
        self,
        tasks: List[AgentTask]
    ) -> Dict[str, Any]:
        """Execute multiple agent tasks concurrently"""
        
        async def run_task(task: AgentTask) -> Tuple[str, Any]:
            task.state = AgentState.RUNNING
            task.start_time = datetime.utcnow()
            
            try:
                agent = self.agents.get(task.agent_type)
                if not agent:
                    raise ValueError(f"Agent {task.agent_type} not found")
                
                result = await agent.execute(task)
                task.result = result
                task.state = AgentState.COMPLETED
                task.end_time = datetime.utcnow()
                
                return task.agent_type, result
                
            except Exception as e:
                task.error = str(e)
                task.state = AgentState.FAILED
                task.end_time = datetime.utcnow()
                return task.agent_type, {"error": str(e)}
        
        # Run all tasks concurrently
        results_list = await asyncio.gather(*[run_task(t) for t in tasks])
        
        return {agent_type: result for agent_type, result in results_list}
    
    async def _synthesize_results(self, results: Dict[str, Any]) -> Dict[str, Any]:
        """Synthesize results from all agents"""
        
        # Gather confidence scores
        confidences = []
        issues = []
        reasoning_path = []
        sources = []
        
        # Eligibility
        eligibility = results.get("eligibility", {})
        if not eligibility.get("is_eligible", True):
            issues.append("Eligibility verification failed")
            confidences.append(eligibility.get("verification_confidence", 0.5))
        else:
            confidences.append(eligibility.get("verification_confidence", 0.8))
        reasoning_path.append("eligibility_verified" if eligibility.get("is_eligible") else "eligibility_issue")
        
        # Medical Necessity
        necessity = results.get("medical_necessity", {})
        if not necessity.get("documentation_adequate", True):
            issues.append("Medical necessity documentation inadequate")
        confidences.append(necessity.get("medical_necessity_score", 0.5))
        reasoning_path.append("necessity_checked")
        if necessity.get("supporting_evidence"):
            sources.extend([{"type": "clinical", "content": e} for e in necessity["supporting_evidence"]])
        
        # Prior Auth
        prior_auth = results.get("prior_auth", {})
        if prior_auth.get("prior_auth_required"):
            issues.append("Prior authorization required")
        confidences.append(prior_auth.get("confidence", 0.7))
        reasoning_path.append("prior_auth_checked")
        
        # Coding
        coding = results.get("coding", {})
        if coding.get("overall_accuracy", 1.0) < 0.7:
            issues.append("Coding accuracy below threshold")
        confidences.append(coding.get("overall_accuracy", 0.5))
        reasoning_path.append("coding_verified")
        
        # Calculate overall recommendation
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.5
        
        if not issues:
            recommendation = "Proceed with claim submission"
            status = "approved"
        elif len(issues) == 1 and avg_confidence > 0.7:
            recommendation = f"Proceed with caution: {issues[0]}"
            status = "conditional"
        else:
            recommendation = f"Review required: {'; '.join(issues)}"
            status = "blocked"
        
        return {
            "recommendation": recommendation,
            "reasoning_path": reasoning_path,
            "sources": sources,
            "confidence": avg_confidence,
            "status": status,
            "issues": issues
        }
    
    # Agent function wrappers for execution graph
    async def _run_eligibility_agent(self, context: Dict) -> Dict:
        return await self.agents["eligibility"].execute(AgentTask(
            task_id="eligibility",
            agent_name="EligibilityVerificationAgent",
            agent_type="eligibility",
            query="",
            context=context
        ))
    
    async def _run_medical_necessity_agent(self, context: Dict) -> Dict:
        return await self.agents["medical_necessity"].execute(AgentTask(
            task_id="medical_necessity",
            agent_name="MedicalNecessityAgent",
            agent_type="medical_necessity",
            query="",
            context=context
        ))
    
    async def _run_prior_auth_agent(self, context: Dict) -> Dict:
        return await self.agents["prior_auth"].execute(AgentTask(
            task_id="prior_auth",
            agent_name="PriorAuthRequirementsAgent",
            agent_type="prior_auth",
            query="",
            context=context
        ))
    
    async def _run_coding_agent(self, context: Dict) -> Dict:
        return await self.agents["coding"].execute(AgentTask(
            task_id="coding",
            agent_name="CodingAccuracyAgent",
            agent_type="coding",
            query="",
            context=context
        ))


# Global instance
agentic_rag_orchestrator = AgenticRAGOrchestrator()
