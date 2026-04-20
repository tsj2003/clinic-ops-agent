"""
AI-to-AI Payer Negotiation Protocol
Autonomous clinical evidence presentation and negotiation against payer AI
"""

import os
import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
import asyncio
import aiohttp


class NegotiationState(Enum):
    """States in AI-to-AI negotiation"""
    INITIATED = auto()
    EVIDENCE_PRESENTATION = auto()
    PAYER_RESPONSE = auto()
    COUNTER_ARGUMENT = auto()
    RESOLUTION_REACHED = auto()
    ESCALATION_REQUIRED = auto()
    NEGOTIATION_CLOSED = auto()


class NegotiationOutcome(Enum):
    """Possible negotiation outcomes"""
    APPROVED = "approved"
    PARTIAL_APPROVAL = "partial_approval"
    DENIED = "denied"
    ESCALATED_TO_HUMAN = "escalated_to_human"
    PENDING_ADDITIONAL_INFO = "pending_additional_info"


@dataclass
class ClinicalEvidence:
    """Clinical evidence for negotiation"""
    evidence_type: str  # "guideline", "literature", "clinical_notes", "prior_auth"
    source: str
    content: str
    relevance_score: float  # 0-1
    confidence: float  # 0-1
    timestamp: datetime


@dataclass
class NegotiationRound:
    """Single round of AI-to-AI negotiation"""
    round_number: int
    our_agent_message: str
    payer_agent_response: str
    evidence_presented: List[ClinicalEvidence]
    clinical_arguments: List[str]
    payer_objections: List[str]
    our_counter_arguments: List[str]
    state_change: str
    timestamp: datetime


@dataclass
class NegotiationSession:
    """Complete AI-to-AI negotiation session"""
    session_id: str
    claim_id: str
    payer_id: str
    procedure_code: str
    diagnosis_codes: List[str]
    current_state: NegotiationState
    rounds: List[NegotiationRound]
    outcome: Optional[NegotiationOutcome]
    final_decision: Optional[str]
    confidence_score: float
    started_at: datetime
    ended_at: Optional[datetime]
    requires_human_review: bool


class AIToAIPayerNegotiationEngine:
    """
    AI-to-AI negotiation engine for payer disputes
    Presents clinical evidence and negotiates autonomously
    """
    
    def __init__(
        self,
        fireworks_api_key: Optional[str] = None,
        mixedbread_api_key: Optional[str] = None,
        clinical_guidelines_db: Optional[Dict] = None
    ):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.mixedbread_api_key = mixedbread_api_key or os.getenv("MIXEDBREAD_API_KEY")
        self.clinical_guidelines_db = clinical_guidelines_db or {}
        self.active_sessions: Dict[str, NegotiationSession] = {}
        self.max_rounds = 5  # Prevent infinite negotiation
    
    async def initiate_negotiation(
        self,
        claim_id: str,
        payer_id: str,
        procedure_code: str,
        diagnosis_codes: List[str],
        denial_reason: str,
        clinical_notes: str,
        patient_history: Optional[List[Dict]] = None
    ) -> NegotiationSession:
        """
        Initiate AI-to-AI negotiation with payer
        """
        session_id = f"NEG-{claim_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        session = NegotiationSession(
            session_id=session_id,
            claim_id=claim_id,
            payer_id=payer_id,
            procedure_code=procedure_code,
            diagnosis_codes=diagnosis_codes,
            current_state=NegotiationState.INITIATED,
            rounds=[],
            outcome=None,
            final_decision=None,
            confidence_score=0.0,
            started_at=datetime.utcnow(),
            ended_at=None,
            requires_human_review=False
        )
        
        self.active_sessions[session_id] = session
        
        # Gather clinical evidence
        evidence = await self._gather_clinical_evidence(
            procedure_code=procedure_code,
            diagnosis_codes=diagnosis_codes,
            clinical_notes=clinical_notes,
            patient_history=patient_history
        )
        
        # Start first round of negotiation
        await self._conduct_negotiation_round(session, evidence, denial_reason)
        
        return session
    
    async def _gather_clinical_evidence(
        self,
        procedure_code: str,
        diagnosis_codes: List[str],
        clinical_notes: str,
        patient_history: Optional[List[Dict]]
    ) -> List[ClinicalEvidence]:
        """Gather comprehensive clinical evidence"""
        evidence = []
        
        # 1. Query medical guidelines (RAG)
        guideline_evidence = await self._query_medical_guidelines(
            procedure_code, diagnosis_codes
        )
        evidence.extend(guideline_evidence)
        
        # 2. Analyze clinical notes for supporting evidence
        note_evidence = await self._analyze_clinical_notes(clinical_notes, procedure_code)
        if note_evidence:
            evidence.append(note_evidence)
        
        # 3. Check patient history for precedents
        if patient_history:
            history_evidence = await self._analyze_patient_history(
                patient_history, procedure_code
            )
            if history_evidence:
                evidence.append(history_evidence)
        
        # 4. Query peer-reviewed literature
        literature_evidence = await self._query_medical_literature(
            procedure_code, diagnosis_codes
        )
        evidence.extend(literature_evidence)
        
        # Sort by relevance and confidence
        evidence.sort(key=lambda e: (e.relevance_score * e.confidence), reverse=True)
        
        return evidence[:10]  # Top 10 most relevant pieces
    
    async def _query_medical_guidelines(
        self,
        procedure_code: str,
        diagnosis_codes: List[str]
    ) -> List[ClinicalEvidence]:
        """Query medical guidelines for procedure appropriateness"""
        if not self.mixedbread_api_key:
            return []
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.mixedbread.ai/v1/rag",
                    headers={"Authorization": f"Bearer {self.mixedbread_api_key}"},
                    json={
                        "query": f"medical necessity guidelines CPT {procedure_code} for {', '.join(diagnosis_codes)}",
                        "filters": {"document_type": "clinical_guideline"},
                        "top_k": 5
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        docs = data.get("documents", [])
                        
                        return [
                            ClinicalEvidence(
                                evidence_type="guideline",
                                source=doc.get("metadata", {}).get("source", "Unknown"),
                                content=doc.get("content", "")[:1000],
                                relevance_score=doc.get("score", 0.5),
                                confidence=0.85,
                                timestamp=datetime.utcnow()
                            )
                            for doc in docs
                        ]
        except Exception:
            pass
        
        return []
    
    async def _analyze_clinical_notes(
        self,
        clinical_notes: str,
        procedure_code: str
    ) -> Optional[ClinicalEvidence]:
        """Analyze clinical notes for medical necessity evidence"""
        if not clinical_notes:
            return None
        
        # Use LLM to assess medical necessity from notes
        if not self.fireworks_api_key:
            return None
        
        prompt = f"""Analyze these clinical notes and extract evidence supporting medical necessity for procedure {procedure_code}.

Clinical Notes:
{clinical_notes[:3000]}

Respond with a JSON object:
{{
    "medical_necessity_supported": true/false,
    "supporting_evidence": ["list of specific evidence from notes"],
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
                        text = data.get("choices", [{}])[0].get("text", "{}").strip()
                        
                        try:
                            result = json.loads(text)
                            if result.get("medical_necessity_supported", False):
                                return ClinicalEvidence(
                                    evidence_type="clinical_notes",
                                    source="Provider Documentation",
                                    content="; ".join(result.get("supporting_evidence", [])),
                                    relevance_score=0.9,
                                    confidence=result.get("confidence", 0.7),
                                    timestamp=datetime.utcnow()
                                )
                        except json.JSONDecodeError:
                            pass
        except Exception:
            pass
        
        return None
    
    async def _analyze_patient_history(
        self,
        patient_history: List[Dict],
        procedure_code: str
    ) -> Optional[ClinicalEvidence]:
        """Analyze patient history for precedents"""
        # Find similar prior authorizations
        similar_procedures = [
            h for h in patient_history
            if h.get("procedure_code") == procedure_code
            and h.get("outcome") == "approved"
        ]
        
        if similar_procedures:
            return ClinicalEvidence(
                evidence_type="prior_auth",
                source="Patient History",
                content=f"Patient has {len(similar_procedures)} prior approved procedures of this type",
                relevance_score=0.8,
                confidence=0.9,
                timestamp=datetime.utcnow()
            )
        
        return None
    
    async def _query_medical_literature(
        self,
        procedure_code: str,
        diagnosis_codes: List[str]
    ) -> List[ClinicalEvidence]:
        """Query peer-reviewed medical literature"""
        # Would integrate with PubMed or similar
        # For now, return empty
        return []
    
    async def _conduct_negotiation_round(
        self,
        session: NegotiationSession,
        evidence: List[ClinicalEvidence],
        payer_denial_reason: str
    ):
        """Conduct a round of AI-to-AI negotiation"""
        round_num = len(session.rounds) + 1
        
        if round_num > self.max_rounds:
            session.current_state = NegotiationState.ESCALATION_REQUIRED
            session.requires_human_review = True
            session.outcome = NegotiationOutcome.ESCALATED_TO_HUMAN
            return
        
        # Generate our clinical argument
        our_message, clinical_arguments = await self._generate_clinical_argument(
            session.procedure_code,
            session.diagnosis_codes,
            evidence,
            payer_denial_reason
        )
        
        # Simulate payer AI response (in production, this would be actual API call to payer)
        payer_response, payer_objections = await self._simulate_payer_response(
            our_message,
            payer_denial_reason,
            evidence
        )
        
        # Generate counter-arguments if needed
        counter_args = []
        if payer_objections:
            counter_args = await self._generate_counter_arguments(
                payer_objections,
                evidence
            )
        
        # Create round record
        round_record = NegotiationRound(
            round_number=round_num,
            our_agent_message=our_message,
            payer_agent_response=payer_response,
            evidence_presented=evidence,
            clinical_arguments=clinical_arguments,
            payer_objections=payer_objections,
            our_counter_arguments=counter_args,
            state_change="continuing",
            timestamp=datetime.utcnow()
        )
        
        session.rounds.append(round_record)
        
        # Determine if negotiation should continue or conclude
        await self._evaluate_negotiation_outcome(session, payer_response)
    
    async def _generate_clinical_argument(
        self,
        procedure_code: str,
        diagnosis_codes: List[str],
        evidence: List[ClinicalEvidence],
        payer_denial_reason: str
    ) -> Tuple[str, List[str]]:
        """Generate clinical argument for negotiation"""
        
        if not self.fireworks_api_key:
            # Fallback simple message
            evidence_summary = "; ".join([e.content[:200] for e in evidence[:3]])
            return (
                f"Clinical evidence supports medical necessity: {evidence_summary}",
                [e.content for e in evidence[:3]]
            )
        
        prompt = f"""Generate a clinical argument to counter this denial:

Procedure: {procedure_code}
Diagnoses: {', '.join(diagnosis_codes)}
Payer Denial Reason: {payer_denial_reason}

Clinical Evidence:
{chr(10).join([f"- {e.source}: {e.content[:300]}" for e in evidence[:5]])}

Generate a professional, evidence-based argument addressing the denial reason. 
Respond in JSON:
{{
    "argument": "main clinical argument text",
    "key_points": ["point 1", "point 2", "point 3"]
}}"""
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://api.fireworks.ai/inference/v1/completions",
                    headers={"Authorization": f"Bearer {self.fireworks_api_key}"},
                    json={
                        "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        "prompt": prompt,
                        "max_tokens": 800,
                        "temperature": 0.2
                    }
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "{}").strip()
                        
                        try:
                            if "```json" in text:
                                text = text.split("```json")[1].split("```")[0]
                            elif "```" in text:
                                text = text.split("```")[1].split("```")[0]
                            
                            result = json.loads(text)
                            return (
                                result.get("argument", "Medical necessity is supported by clinical evidence."),
                                result.get("key_points", [])
                            )
                        except json.JSONDecodeError:
                            pass
        except Exception:
            pass
        
        return (
            "Medical necessity is established through clinical documentation and evidence-based guidelines.",
            [e.content[:200] for e in evidence[:3]]
        )
    
    async def _simulate_payer_response(
        self,
        our_message: str,
        original_denial: str,
        evidence: List[ClinicalEvidence]
    ) -> Tuple[str, List[str]]:
        """
        Simulate payer AI response
        In production, this would be an actual API call to payer's AI system
        """
        # Calculate likelihood of approval based on evidence strength
        avg_confidence = sum(e.confidence for e in evidence) / len(evidence) if evidence else 0.5
        
        if avg_confidence > 0.8:
            return (
                "Clinical evidence reviewed. Medical necessity criteria met. Approval recommended.",
                []
            )
        elif avg_confidence > 0.6:
            return (
                "Partial review complete. Additional documentation may strengthen case.",
                ["Need more specific documentation of symptoms", "Clinical guidelines citation needed"]
            )
        else:
            return (
                "Insufficient clinical evidence to support medical necessity at this time.",
                ["Documentation does not meet criteria", "Additional clinical information required"]
            )
    
    async def _generate_counter_arguments(
        self,
        payer_objections: List[str],
        evidence: List[ClinicalEvidence]
    ) -> List[str]:
        """Generate counter-arguments to payer objections"""
        counter_args = []
        
        for objection in payer_objections:
            # Find evidence that counters this objection
            relevant_evidence = [
                e for e in evidence
                if any(word in e.content.lower() for word in objection.lower().split())
            ]
            
            if relevant_evidence:
                counter_args.append(
                    f"Re: '{objection}' - {relevant_evidence[0].content[:200]}"
                )
            else:
                counter_args.append(f"Re: '{objection}' - Clinical documentation supports medical necessity.")
        
        return counter_args
    
    async def _evaluate_negotiation_outcome(
        self,
        session: NegotiationSession,
        payer_response: str
    ):
        """Evaluate if negotiation should conclude"""
        response_lower = payer_response.lower()
        
        if "approval" in response_lower or "approved" in response_lower:
            session.current_state = NegotiationState.RESOLUTION_REACHED
            session.outcome = NegotiationOutcome.APPROVED
            session.final_decision = "Approved"
            session.confidence_score = 0.9
            session.ended_at = datetime.utcnow()
        
        elif "partial" in response_lower or "modified" in response_lower:
            session.current_state = NegotiationState.RESOLUTION_REACHED
            session.outcome = NegotiationOutcome.PARTIAL_APPROVAL
            session.final_decision = "Partially Approved"
            session.confidence_score = 0.7
            session.ended_at = datetime.utcnow()
        
        elif "denied" in response_lower or "not approved" in response_lower:
            # Check if we should escalate or accept
            if len(session.rounds) >= 3:
                session.current_state = NegotiationState.ESCALATION_REQUIRED
                session.requires_human_review = True
                session.outcome = NegotiationOutcome.ESCALATED_TO_HUMAN
                session.final_decision = "Escalated for human review"
                session.ended_at = datetime.utcnow()
            else:
                # Continue negotiation
                session.current_state = NegotiationState.COUNTER_ARGUMENT
        
        elif "additional" in response_lower and "information" in response_lower:
            session.current_state = NegotiationState.RESOLUTION_REACHED
            session.outcome = NegotiationOutcome.PENDING_ADDITIONAL_INFO
            session.final_decision = "Additional information requested"
            session.ended_at = datetime.utcnow()
    
    async def continue_negotiation(
        self,
        session_id: str,
        additional_evidence: Optional[List[ClinicalEvidence]] = None
    ) -> NegotiationSession:
        """Continue an ongoing negotiation with new evidence"""
        if session_id not in self.active_sessions:
            raise ValueError(f"Session {session_id} not found")
        
        session = self.active_sessions[session_id]
        
        if session.current_state in [NegotiationState.RESOLUTION_REACHED, NegotiationState.NEGOTIATION_CLOSED]:
            return session
        
        # Add new evidence if provided
        if additional_evidence:
            # Combine with existing evidence from last round
            last_round = session.rounds[-1] if session.rounds else None
            if last_round:
                combined_evidence = last_round.evidence_presented + additional_evidence
            else:
                combined_evidence = additional_evidence
            
            await self._conduct_negotiation_round(
                session,
                combined_evidence,
                session.rounds[-1].payer_agent_response if session.rounds else ""
            )
        
        return session
    
    def get_negotiation_summary(self, session_id: str) -> Dict[str, Any]:
        """Get summary of negotiation session"""
        if session_id not in self.active_sessions:
            return {"error": "Session not found"}
        
        session = self.active_sessions[session_id]
        
        return {
            "session_id": session.session_id,
            "claim_id": session.claim_id,
            "payer_id": session.payer_id,
            "current_state": session.current_state.name,
            "rounds_conducted": len(session.rounds),
            "outcome": session.outcome.value if session.outcome else "ongoing",
            "final_decision": session.final_decision,
            "confidence_score": session.confidence_score,
            "requires_human_review": session.requires_human_review,
            "started_at": session.started_at.isoformat(),
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "evidence_presented": sum(len(r.evidence_presented) for r in session.rounds),
            "negotiation_duration_minutes": (
                (session.ended_at - session.started_at).total_seconds() / 60
                if session.ended_at else None
            )
        }


class ClinicalGuardrails:
    """
    Clinical guardrails for AI-to-AI negotiation
    Ensures safe and accurate clinical arguments
    """
    
    def __init__(self):
        self.prohibited_claims = [
            "guaranteed cure",
            "100% effective",
            "no side effects",
            "always appropriate"
        ]
        self.required_elements = [
            "evidence_based",
            "patient_specific",
            "medically_accurate"
        ]
    
    def validate_clinical_argument(self, argument: str) -> Dict[str, Any]:
        """Validate clinical argument meets safety standards"""
        issues = []
        
        # Check for prohibited claims
        for claim in self.prohibited_claims:
            if claim.lower() in argument.lower():
                issues.append(f"Prohibited claim detected: '{claim}'")
        
        # Check length (should be detailed but not excessive)
        if len(argument) < 100:
            issues.append("Argument too brief - needs more clinical detail")
        
        if len(argument) > 5000:
            issues.append("Argument too long - may be overwhelming")
        
        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "safety_score": max(0, 1.0 - (len(issues) * 0.2))
        }


# Global instances
ai_negotiation_engine = AIToAIPayerNegotiationEngine()
clinical_guardrails = ClinicalGuardrails()
