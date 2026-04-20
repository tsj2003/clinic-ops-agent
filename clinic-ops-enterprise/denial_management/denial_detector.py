"""
Advanced Claims Denial Detection & Management Engine
Autonomous denial detection, categorization, appeal generation, and submission
"""

import os
import re
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import asyncio
import aiohttp


class DenialCategory(str, Enum):
    """Root cause categories for denials"""
    MEDICAL_NECESSITY = "medical_necessity"
    PRIOR_AUTH_MISSING = "prior_auth_missing"
    COVERAGE_EXCLUDED = "coverage_excluded"
    OUT_OF_NETWORK = "out_of_network"
    COORDINATION_OF_BENEFITS = "coordination_of_benefits"
    TIMELY_FILING = "timely_filing"
    INVALID_CODE = "invalid_code"
    DUPLICATE_CLAIM = "duplicate_claim"
    AUTHORIZATION_REQUIRED = "authorization_required"
    ELIGIBILITY_ISSUE = "eligibility_issue"
    OTHER = "other"


@dataclass
class DenialAnalysis:
    """AI-powered denial analysis"""
    claim_number: str
    denial_category: DenialCategory
    root_cause: str
    appeal_probability: float
    expected_recovery: float
    recommended_action: str
    appeal_strategy: str
    medical_necessity_gap: Optional[str]
    supporting_evidence_needed: List[str]
    deadline_date: Optional[datetime]
    confidence_score: float


@dataclass
class AppealLetter:
    """Generated appeal letter"""
    letter_id: str
    claim_number: str
    letter_text: str
    supporting_documents: List[str]
    appeal_method: str
    word_count: int
    requires_md_signature: bool
    medical_evidence_cited: List[str]
    policy_references: List[str]
    generated_at: datetime


class DenialDetectionEngine:
    """
    Autonomous denial detection and categorization engine
    """
    
    # CARC (Claim Adjustment Reason Codes) to category mapping
    CARC_CATEGORIES = {
        "1": DenialCategory.INVALID_CODE,  # Deductible
        "2": DenialCategory.OTHER,  # Coinsurance
        "4": DenialCategory.COVERAGE_EXCLUDED,  # Procedure code inconsistent
        "5": DenialCategory.OTHER,  # Copay
        "6": DenialCategory.COVERAGE_EXCLUDED,  # Deny - not covered
        "7": DenialCategory.OTHER,  # Non-standard amount
        "16": DenialCategory.INVALID_CODE,  # Claim lacks info
        "18": DenialCategory.TIMELY_FILING,  # Duplicate claim
        "22": DenialCategory.COORDINATION_OF_BENEFITS,  # Other payer
        "23": DenialCategory.DUPLICATE_CLAIM,  # Duplicate
        "29": DenialCategory.TIMELY_FILING,  # Time limit
        "31": DenialCategory.ELIGIBILITY_ISSUE,  # Patient not eligible
        "50": DenialCategory.MEDICAL_NECESSITY,  # Non-covered
        "96": DenialCategory.MEDICAL_NECESSITY,  # Non-covered charges
        "151": DenialCategory.MEDICAL_NECESSITY,  # Not reasonable/necessary
        "234": DenialCategory.OUT_OF_NETWORK,  # Out of network
        "B15": DenialCategory.MEDICAL_NECESSITY,  # Medical necessity
        "CO-50": DenialCategory.MEDICAL_NECESSITY,  # Non-covered
        "CO-97": DenialCategory.PRIOR_AUTH_MISSING,  # Authorization required
        "CO-119": DenialCategory.MEDICAL_NECESSITY,  # Benefit maximum
        "CO-252": DenialCategory.COVERAGE_EXCLUDED,  # Coverage guidelines
        "N130": DenialCategory.MEDICAL_NECESSITY,  # Prior auth required
        "N207": DenialCategory.AUTHORIZATION_REQUIRED,  # Missing auth
    }
    
    # Denial patterns for text extraction
    DENIAL_PATTERNS = {
        "medical_necessity": [
            r"not medically necessary",
            r"no medical necessity",
            r"lack of medical necessity",
            r"does not meet medical necessity",
            r"not reasonable and necessary"
        ],
        "prior_auth": [
            r"prior authorization required",
            r"pre-authorization needed",
            r"authorization not obtained",
            r"missing authorization",
            r"authorization not on file"
        ],
        "out_of_network": [
            r"out of network",
            r"non-par provider",
            r"non-participating",
            r"out-of-network"
        ],
        "timely_filing": [
            r"time limit",
            r"timely filing",
            r"filing deadline",
            r"claim received late"
        ]
    }
    
    def __init__(
        self,
        fireworks_api_key: Optional[str] = None,
        mixedbread_api_key: Optional[str] = None
    ):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
        self.mixedbread_api_key = mixedbread_api_key or os.getenv("MIXEDBREAD_API_KEY")
    
    def categorize_denial(
        self,
        denial_code: str,
        denial_description: str
    ) -> Tuple[DenialCategory, float]:
        """
        Categorize denial by code and description
        Returns category and confidence score
        """
        # Try CARC mapping first
        category = self.CARC_CATEGORIES.get(denial_code)
        if category:
            return category, 0.9
        
        # Try pattern matching on description
        denial_lower = denial_description.lower()
        
        for cat, patterns in self.DENIAL_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, denial_lower):
                    category_map = {
                        "medical_necessity": DenialCategory.MEDICAL_NECESSITY,
                        "prior_auth": DenialCategory.PRIOR_AUTH_MISSING,
                        "out_of_network": DenialCategory.OUT_OF_NETWORK,
                        "timely_filing": DenialCategory.TIMELY_FILING
                    }
                    return category_map.get(cat, DenialCategory.OTHER), 0.8
        
        return DenialCategory.OTHER, 0.5
    
    async def analyze_denial_with_ai(
        self,
        claim_data: Dict[str, Any],
        clinical_context: Optional[str] = None,
        policy_context: Optional[str] = None
    ) -> DenialAnalysis:
        """
        AI-powered deep analysis of denial
        """
        denial_code = claim_data.get("denial_code", "")
        denial_desc = claim_data.get("denial_description", "")
        
        # Categorize
        category, category_confidence = self.categorize_denial(denial_code, denial_desc)
        
        # Query RAG for policy context
        if not policy_context:
            policy_context = await self._query_policy_rag(
                denial_code=denial_code,
                procedure_code=claim_data.get("procedure_code", "")
            )
        
        # Call Fireworks for deep analysis
        analysis = await self._call_llm_analysis(
            claim_data=claim_data,
            category=category,
            clinical_context=clinical_context or "",
            policy_context=policy_context or ""
        )
        
        return DenialAnalysis(
            claim_number=claim_data.get("claim_number", ""),
            denial_category=category,
            root_cause=analysis.get("root_cause", denial_desc),
            appeal_probability=analysis.get("appeal_probability", 0.5),
            expected_recovery=analysis.get("expected_recovery", 0.0),
            recommended_action=analysis.get("recommended_action", "review"),
            appeal_strategy=analysis.get("appeal_strategy", ""),
            medical_necessity_gap=analysis.get("medical_necessity_gap"),
            supporting_evidence_needed=analysis.get("supporting_evidence", []),
            deadline_date=self._calculate_deadline(claim_data),
            confidence_score=category_confidence
        )
    
    async def _query_policy_rag(
        self,
        denial_code: str,
        procedure_code: str
    ) -> str:
        """Query Mixedbread RAG for policy information"""
        if not self.mixedbread_api_key:
            return ""
        
        url = "https://api.mixedbread.ai/v1/rag"
        
        query = f"Denial code {denial_code} procedure {procedure_code} coverage policy"
        
        payload = {
            "query": query,
            "filters": {"document_type": "medical_policy"},
            "top_k": 3
        }
        
        headers = {
            "Authorization": f"Bearer {self.mixedbread_api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        docs = data.get("documents", [])
                        return "\n\n".join([d.get("content", "") for d in docs])
        except Exception as e:
            print(f"⚠️ RAG query failed: {e}")
        
        return ""
    
    async def _call_llm_analysis(
        self,
        claim_data: Dict,
        category: DenialCategory,
        clinical_context: str,
        policy_context: str
    ) -> Dict:
        """Call Fireworks LLM for denial analysis"""
        if not self.fireworks_api_key:
            return {"appeal_probability": 0.5, "recommended_action": "manual_review"}
        
        url = "https://api.fireworks.ai/inference/v1/completions"
        
        prompt = f"""You are a medical billing expert analyzing a claim denial.

CLAIM DATA:
- Claim Number: {claim_data.get('claim_number')}
- Denial Code: {claim_data.get('denial_code')}
- Denial Description: {claim_data.get('denial_description')}
- Procedure Code: {claim_data.get('procedure_code')}
- Billed Amount: ${claim_data.get('billed_amount', 0)}
- Denial Category: {category.value}

CLINICAL CONTEXT:
{clinical_context[:1000] if clinical_context else 'No clinical notes available'}

POLICY CONTEXT:
{policy_context[:1000] if policy_context else 'No policy documents available'}

Analyze this denial and provide JSON with:
{{
    "root_cause": "specific technical reason for denial",
    "appeal_probability": 0.0-1.0 score,
    "expected_recovery": dollar amount expected,
    "recommended_action": "appeal|escalate|write_off",
    "appeal_strategy": "detailed strategy for appeal",
    "medical_necessity_gap": "what's missing if applicable",
    "supporting_evidence": ["list of docs needed"]
}}"""
        
        payload = {
            "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
            "prompt": prompt,
            "max_tokens": 1000,
            "temperature": 0.3,
        }
        
        headers = {"Authorization": f"Bearer {self.fireworks_api_key}"}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        text = data.get("choices", [{}])[0].get("text", "")
                        
                        # Parse JSON
                        try:
                            if "```json" in text:
                                json_str = text.split("```json")[1].split("```")[0]
                            elif "```" in text:
                                json_str = text.split("```")[1].split("```")[0]
                            else:
                                json_str = text
                            
                            return json.loads(json_str.strip())
                        except json.JSONDecodeError:
                            return self._fallback_analysis(category)
                    
        except Exception as e:
            print(f"⚠️ LLM analysis failed: {e}")
        
        return self._fallback_analysis(category)
    
    def _fallback_analysis(self, category: DenialCategory) -> Dict:
        """Fallback analysis when LLM fails"""
        fallbacks = {
            DenialCategory.MEDICAL_NECESSITY: {
                "appeal_probability": 0.65,
                "recommended_action": "appeal",
                "appeal_strategy": "Submit detailed clinical notes demonstrating medical necessity"
            },
            DenialCategory.PRIOR_AUTH_MISSING: {
                "appeal_probability": 0.80,
                "recommended_action": "appeal",
                "appeal_strategy": "Submit retroactive prior authorization with clinical justification"
            },
            DenialCategory.OUT_OF_NETWORK: {
                "appeal_probability": 0.40,
                "recommended_action": "escalate",
                "appeal_strategy": "Request exception based on lack of in-network providers"
            },
            DenialCategory.TIMELY_FILING: {
                "appeal_probability": 0.25,
                "recommended_action": "escalate",
                "appeal_strategy": "Submit proof of timely submission or request exception"
            }
        }
        
        return fallbacks.get(category, {
            "appeal_probability": 0.5,
            "recommended_action": "review",
            "appeal_strategy": "Manual review required"
        })
    
    def _calculate_deadline(self, claim_data: Dict) -> Optional[datetime]:
        """Calculate appeal deadline from denial date"""
        denial_date_str = claim_data.get("denial_date")
        if not denial_date_str:
            return None
        
        try:
            # Default 180 days for most payers
            denial_date = datetime.fromisoformat(denial_date_str.replace('Z', '+00:00'))
            return denial_date + timedelta(days=180)
        except:
            return None


class AppealGenerationEngine:
    """
    Generates medically-sound appeal letters
    """
    
    def __init__(self, fireworks_api_key: Optional[str] = None):
        self.fireworks_api_key = fireworks_api_key or os.getenv("FIREWORKS_API_KEY")
    
    async def generate_appeal_letter(
        self,
        analysis: DenialAnalysis,
        patient_data: Dict,
        clinical_notes: Optional[List[str]] = None,
        provider_npi: Optional[str] = None
    ) -> AppealLetter:
        """
        Generate appeal letter based on analysis
        """
        letter_id = f"APL-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{analysis.claim_number[-4:]}"
        
        # Build letter using LLM
        letter_text = await self._generate_letter_with_llm(
            analysis=analysis,
            patient_data=patient_data,
            clinical_notes=clinical_notes or [],
            provider_npi=provider_npi
        )
        
        # Determine supporting docs
        supporting_docs = self._determine_supporting_docs(analysis)
        
        # Check if MD signature needed
        requires_md = analysis.denial_category == DenialCategory.MEDICAL_NECESSITY
        
        return AppealLetter(
            letter_id=letter_id,
            claim_number=analysis.claim_number,
            letter_text=letter_text,
            supporting_documents=supporting_docs,
            appeal_method="portal",  # Default
            word_count=len(letter_text.split()),
            requires_md_signature=requires_md,
            medical_evidence_cited=analysis.supporting_evidence_needed,
            policy_references=analysis.supporting_evidence_needed,  # Simplified
            generated_at=datetime.utcnow()
        )
    
    async def _generate_letter_with_llm(
        self,
        analysis: DenialAnalysis,
        patient_data: Dict,
        clinical_notes: List[str],
        provider_npi: Optional[str]
    ) -> str:
        """Generate letter using Fireworks LLM"""
        if not self.fireworks_api_key:
            return self._generate_template_letter(analysis, patient_data)
        
        url = "https://api.fireworks.ai/inference/v1/completions"
        
        prompt = f"""Write a professional medical claim appeal letter.

CLAIM INFORMATION:
- Claim Number: {analysis.claim_number}
- Denial Code: {analysis.claim_number}  # Reuse claim number as placeholder
- Denial Category: {analysis.denial_category.value}
- Root Cause: {analysis.root_cause}
- Billed Amount: {patient_data.get('billed_amount', 'Unknown')}

APPEAL STRATEGY:
{analysis.appeal_strategy}

SUPPORTING EVIDENCE NEEDED:
{chr(10).join(analysis.supporting_evidence_needed)}

CLINICAL CONTEXT:
{chr(10).join(clinical_notes[:2]) if clinical_notes else 'See attached clinical notes'}

REQUIREMENTS:
1. Professional, formal tone
2. Reference specific medical policies
3. Cite clinical evidence
4. Clearly state medical necessity
5. Request specific reconsideration
6. Include space for physician signature
7. Maximum 2 pages

Generate complete appeal letter:"""
        
        payload = {
            "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
            "prompt": prompt,
            "max_tokens": 2000,
            "temperature": 0.4,
        }
        
        headers = {"Authorization": f"Bearer {self.fireworks_api_key}"}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("choices", [{}])[0].get("text", "")
        except Exception as e:
            print(f"⚠️ Letter generation failed: {e}")
        
        return self._generate_template_letter(analysis, patient_data)
    
    def _generate_template_letter(
        self,
        analysis: DenialAnalysis,
        patient_data: Dict
    ) -> str:
        """Fallback template letter"""
        return f"""[CLINIC LETTERHEAD]

Date: {datetime.utcnow().strftime('%B %d, %Y')}

Re: Appeal of Denied Claim {analysis.claim_number}

Dear Claims Review Department,

We are writing to formally appeal the denial of claim {analysis.claim_number}.

DENIAL INFORMATION:
- Denial Date: {patient_data.get('denial_date', 'Unknown')}
- Denial Code: {patient_data.get('denial_code', 'Unknown')}
- Denial Reason: {analysis.root_cause}

APPEAL JUSTIFICATION:
{analysis.appeal_strategy}

Based on the clinical documentation provided, this service was medically necessary and appropriate for the patient's condition.

We respectfully request that you reconsider this claim and approve payment.

Thank you for your prompt attention to this matter.

Sincerely,

_________________________
[Provider Name], MD
NPI: [Provider NPI]

Attachments:
{chr(10).join(f'- {doc}' for doc in analysis.supporting_evidence_needed)}
"""
    
    def _determine_supporting_docs(self, analysis: DenialAnalysis) -> List[str]:
        """Determine required supporting documents"""
        docs = []
        
        if analysis.denial_category == DenialCategory.MEDICAL_NECESSITY:
            docs.extend([
                "Clinical progress notes",
                "Physician order/ referral",
                "Medical records supporting diagnosis"
            ])
        
        if analysis.denial_category == DenialCategory.PRIOR_AUTH_MISSING:
            docs.extend([
                "Retroactive prior authorization request",
                "Clinical justification statement"
            ])
        
        if analysis.supporting_evidence_needed:
            docs.extend(analysis.supporting_evidence_needed)
        
        return list(set(docs))  # Remove duplicates


class DenialSubmissionManager:
    """
    Manages appeal submission to payer portals
    """
    
    def __init__(self, tinyfish_api_key: Optional[str] = None):
        self.tinyfish_api_key = tinyfish_api_key or os.getenv("TINYFISH_API_KEY")
    
    async def submit_appeal(
        self,
        payer_id: str,
        claim_number: str,
        appeal_letter: AppealLetter,
        portal_credentials: Dict[str, str],
        supporting_docs: List[str]
    ) -> Dict[str, Any]:
        """
        Submit appeal through payer portal using TinyFish
        """
        from ..scrapers.tinyfish_scraper import TinyFishScraper
        
        async with TinyFishScraper(api_key=self.tinyfish_api_key) as scraper:
            # Get payer workflow URL
            workflow_url = await self._get_payer_workflow(payer_id)
            
            # Submit via TinyFish
            result = await scraper.submit_appeal_portal(
                workflow_url=workflow_url,
                claim_number=claim_number,
                appeal_letter=appeal_letter.letter_text,
                supporting_docs=supporting_docs,
                portal_username=portal_credentials["username"],
                portal_password=portal_credentials["password"]
            )
            
            return {
                "success": result.get("completed", False),
                "confirmation_number": self._extract_confirmation(result),
                "submission_timestamp": datetime.utcnow().isoformat(),
                "payer_id": payer_id,
                "claim_number": claim_number
            }
    
    async def _get_payer_workflow(self, payer_id: str) -> str:
        """Get TinyFish workflow URL for payer"""
        workflows = {
            "aetna": os.getenv("AETNA_APPEAL_WORKFLOW", ""),
            "uhc": os.getenv("UHC_APPEAL_WORKFLOW", ""),
            "cigna": os.getenv("CIGNA_APPEAL_WORKFLOW", ""),
            "anthem": os.getenv("ANTHEM_APPEAL_WORKFLOW", ""),
        }
        return workflows.get(payer_id, "")
    
    def _extract_confirmation(self, result: Dict) -> Optional[str]:
        """Extract confirmation number from submission result"""
        answer = result.get("final_answer", "")
        # Look for patterns like "Confirmation: ABC123" or "Ref #: 12345"
        patterns = [
            r"[Cc]onfirmation[:#\s]+([A-Z0-9\-]+)",
            r"[Rr]eference[:#\s]+([A-Z0-9\-]+)",
            r"[Cc]onfirmation [Nn]umber[:#\s]+([A-Z0-9\-]+)"
        ]
        
        for pattern in patterns:
            match = re.search(pattern, answer)
            if match:
                return match.group(1)
        
        return None


# Global instances
denial_detector = DenialDetectionEngine()
appeal_generator = AppealGenerationEngine()
submission_manager = DenialSubmissionManager()
