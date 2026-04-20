"""
Payer Behavior Analytics & Contract Leverage
Data flywheel from thousands of portal interactions
"""

import os
import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict, Counter
import asyncio
from decimal import Decimal


@dataclass
class PayerInteraction:
    """Single payer portal interaction"""
    interaction_id: str
    payer_id: str
    payer_name: str
    interaction_type: str  # "auth_request", "denial", "appeal", "payment"
    claim_id: str
    procedure_code: str
    outcome: str  # "approved", "denied", "pending", "partial"
    denial_reason: Optional[str]
    denial_code: Optional[str]
    processing_time_days: float
    downcoded: bool
    underpaid: bool
    timestamp: datetime
    agent_confidence: float


@dataclass
class PayerBehaviorProfile:
    """Aggregated behavior profile for a payer"""
    payer_id: str
    payer_name: str
    total_interactions: int
    approval_rate: float
    avg_processing_days: float
    denial_rate: float
    downcode_rate: float
    underpayment_rate: float
    top_denial_reasons: List[Tuple[str, int]]
    most_denied_procedures: List[Tuple[str, int]]
    denial_trends: Dict[str, float]  # month -> rate
    aggressive_score: float  # 0-1, higher = more aggressive
    contract_leverage_score: float  # 0-1, higher = more leverage for clinic
    last_updated: datetime


class PayerBehaviorAnalyticsEngine:
    """
    Analytics engine that turns portal interactions into actionable intelligence
    """
    
    def __init__(self, db=None):
        self.db = db
        self.interactions: List[PayerInteraction] = []
        self.payer_profiles: Dict[str, PayerBehaviorProfile] = {}
        self.flywheel_data: Dict[str, Any] = {}
    
    async def ingest_interaction(self, interaction: PayerInteraction):
        """Ingest a new payer interaction into the flywheel"""
        self.interactions.append(interaction)
        
        # Store in database
        if self.db:
            await self._store_interaction(interaction)
        
        # Update payer profile
        await self._update_payer_profile(interaction.payer_id)
        
        # Update flywheel metrics
        await self._update_flywheel_metrics()
    
    async def _store_interaction(self, interaction: PayerInteraction):
        """Store interaction to database"""
        if not self.db:
            return
        
        doc = {
            "_id": interaction.interaction_id,
            "payer_id": interaction.payer_id,
            "payer_name": interaction.payer_name,
            "interaction_type": interaction.interaction_type,
            "claim_id": interaction.claim_id,
            "procedure_code": interaction.procedure_code,
            "outcome": interaction.outcome,
            "denial_reason": interaction.denial_reason,
            "denial_code": interaction.denial_code,
            "processing_time_days": interaction.processing_time_days,
            "downcoded": interaction.downcoded,
            "underpaid": interaction.underpaid,
            "timestamp": interaction.timestamp,
            "agent_confidence": interaction.agent_confidence,
            "created_at": datetime.utcnow()
        }
        
        await self.db.payer_interactions.insert_one(doc)
    
    async def _update_payer_profile(self, payer_id: str):
        """Update behavior profile for a payer"""
        # Get all interactions for this payer
        payer_interactions = [i for i in self.interactions if i.payer_id == payer_id]
        
        if not payer_interactions:
            return
        
        # Calculate metrics
        total = len(payer_interactions)
        approved = sum(1 for i in payer_interactions if i.outcome == "approved")
        denied = sum(1 for i in payer_interactions if i.outcome == "denied")
        downcoded = sum(1 for i in payer_interactions if i.downcoded)
        underpaid = sum(1 for i in payer_interactions if i.underpaid)
        
        avg_processing = sum(i.processing_time_days for i in payer_interactions) / total if total > 0 else 0
        
        # Top denial reasons
        denial_reasons = Counter([i.denial_reason for i in payer_interactions if i.denial_reason])
        top_denial_reasons = denial_reasons.most_common(5)
        
        # Most denied procedures
        denied_procedures = Counter([i.procedure_code for i in payer_interactions if i.outcome == "denied"])
        most_denied = denied_procedures.most_common(5)
        
        # Denial trends by month
        denial_trends = {}
        for i in payer_interactions:
            month_key = i.timestamp.strftime("%Y-%m")
            if month_key not in denial_trends:
                denial_trends[month_key] = {"total": 0, "denied": 0}
            denial_trends[month_key]["total"] += 1
            if i.outcome == "denied":
                denial_trends[month_key]["denied"] += 1
        
        denial_rates_by_month = {
            month: data["denied"] / data["total"] if data["total"] > 0 else 0
            for month, data in denial_trends.items()
        }
        
        # Calculate aggressive score (0-1)
        # Based on: denial rate, downcode rate, underpayment rate, processing time
        aggressive_score = (
            (denied / total if total > 0 else 0) * 0.4 +
            (downcoded / total if total > 0 else 0) * 0.3 +
            (underpaid / total if total > 0 else 0) * 0.2 +
            min(avg_processing / 30, 1.0) * 0.1  # Normalize to 30 days
        )
        
        # Calculate contract leverage score (0-1)
        # Higher when payer has worse behavior (more leverage for clinic)
        contract_leverage = min(aggressive_score * 1.5, 1.0)
        
        # Get payer name
        payer_name = payer_interactions[0].payer_name if payer_interactions else payer_id
        
        profile = PayerBehaviorProfile(
            payer_id=payer_id,
            payer_name=payer_name,
            total_interactions=total,
            approval_rate=approved / total if total > 0 else 0,
            avg_processing_days=avg_processing,
            denial_rate=denied / total if total > 0 else 0,
            downcode_rate=downcoded / total if total > 0 else 0,
            underpayment_rate=underpaid / total if total > 0 else 0,
            top_denial_reasons=top_denial_reasons,
            most_denied_procedures=most_denied,
            denial_trends=denial_rates_by_month,
            aggressive_score=aggressive_score,
            contract_leverage_score=contract_leverage,
            last_updated=datetime.utcnow()
        )
        
        self.payer_profiles[payer_id] = profile
        
        # Store to database
        if self.db:
            await self._store_profile(profile)
    
    async def _store_profile(self, profile: PayerBehaviorProfile):
        """Store payer profile to database"""
        if not self.db:
            return
        
        doc = {
            "_id": profile.payer_id,
            "payer_name": profile.payer_name,
            "total_interactions": profile.total_interactions,
            "approval_rate": profile.approval_rate,
            "avg_processing_days": profile.avg_processing_days,
            "denial_rate": profile.denial_rate,
            "downcode_rate": profile.downcode_rate,
            "underpayment_rate": profile.underpayment_rate,
            "top_denial_reasons": profile.top_denial_reasons,
            "most_denied_procedures": profile.most_denied_procedures,
            "denial_trends": profile.denial_trends,
            "aggressive_score": profile.aggressive_score,
            "contract_leverage_score": profile.contract_leverage_score,
            "last_updated": profile.last_updated
        }
        
        await self.db.payer_profiles.replace_one(
            {"_id": profile.payer_id},
            doc,
            upsert=True
        )
    
    async def _update_flywheel_metrics(self):
        """Update aggregate flywheel metrics"""
        if not self.interactions:
            return
        
        # Calculate aggregate metrics
        total_interactions = len(self.interactions)
        total_approved = sum(1 for i in self.interactions if i.outcome == "approved")
        total_denied = sum(1 for i in self.interactions if i.outcome == "denied")
        total_downcoded = sum(1 for i in self.interactions if i.downcoded)
        total_underpaid = sum(1 for i in self.interactions if i.underpaid)
        
        # Payer rankings by aggressiveness
        payer_aggressiveness = {
            payer_id: profile.aggressive_score
            for payer_id, profile in self.payer_profiles.items()
        }
        
        most_aggressive_payers = sorted(
            payer_aggressiveness.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]
        
        self.flywheel_data = {
            "total_interactions": total_interactions,
            "overall_approval_rate": total_approved / total_interactions if total_interactions > 0 else 0,
            "overall_denial_rate": total_denied / total_interactions if total_interactions > 0 else 0,
            "overall_downcode_rate": total_downcoded / total_interactions if total_interactions > 0 else 0,
            "overall_underpayment_rate": total_underpaid / total_interactions if total_interactions > 0 else 0,
            "most_aggressive_payers": most_aggressive_payers,
            "payer_count": len(self.payer_profiles),
            "last_updated": datetime.utcnow().isoformat()
        }
    
    def get_payer_profile(self, payer_id: str) -> Optional[PayerBehaviorProfile]:
        """Get behavior profile for a specific payer"""
        return self.payer_profiles.get(payer_id)
    
    def get_contract_leverage_report(self, payer_id: str) -> Dict[str, Any]:
        """
        Generate contract leverage report for negotiations
        """
        profile = self.payer_profiles.get(payer_id)
        if not profile:
            return {"error": "Payer profile not found"}
        
        # Generate negotiation talking points
        talking_points = []
        
        if profile.denial_rate > 0.3:
            talking_points.append(
                f"Your denial rate of {profile.denial_rate*100:.1f}% is significantly above industry average of 15%"
            )
        
        if profile.downcode_rate > 0.2:
            talking_points.append(
                f"Downcoding rate of {profile.downcode_rate*100:.1f}% suggests potential inappropriate payment practices"
            )
        
        if profile.avg_processing_days > 20:
            talking_points.append(
                f"Average processing time of {profile.avg_processing_days:.1f} days exceeds timely filing requirements"
            )
        
        if profile.underpayment_rate > 0.15:
            talking_points.append(
                f"Underpayment rate of {profile.underpayment_rate*100:.1f}% indicates contract rate compliance issues"
            )
        
        # Identify problematic procedures for this payer
        problematic_procedures = [
            proc for proc, count in profile.most_denied_procedures[:3]
        ]
        
        return {
            "payer_id": payer_id,
            "payer_name": profile.payer_name,
            "contract_leverage_score": profile.contract_leverage_score,
            "aggressive_score": profile.aggressive_score,
            "negotiation_talking_points": talking_points,
            "problematic_procedures": problematic_procedures,
            "recommended_rate_increase": self._calculate_rate_increase_recommendation(profile),
            "data_driven_arguments": {
                "denial_rate": f"{profile.denial_rate*100:.1f}%",
                "downcode_rate": f"{profile.downcode_rate*100:.1f}%",
                "underpayment_rate": f"{profile.underpayment_rate*100:.1f}%",
                "avg_processing_days": f"{profile.avg_processing_days:.1f}"
            },
            "trend_analysis": self._analyze_trends(profile.denial_trends),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    def _calculate_rate_increase_recommendation(
        self,
        profile: PayerBehaviorProfile
    ) -> Dict[str, Any]:
        """Calculate recommended rate increase based on behavior"""
        base_rate_increase = 0.0
        
        # Increase for high denial rate
        if profile.denial_rate > 0.25:
            base_rate_increase += 3.0
        
        # Increase for downcoding
        if profile.downcode_rate > 0.15:
            base_rate_increase += 2.5
        
        # Increase for underpayments
        if profile.underpayment_rate > 0.10:
            base_rate_increase += 2.0
        
        # Increase for slow processing
        if profile.avg_processing_days > 25:
            base_rate_increase += 1.5
        
        # Cap at reasonable maximum
        recommended_increase = min(base_rate_increase, 10.0)
        
        return {
            "recommended_increase_percentage": recommended_increase,
            "minimum_acceptable": recommended_increase * 0.7,
            "justification": f"Based on {profile.total_interactions} interactions showing "
                           f"{profile.denial_rate*100:.1f}% denial rate, "
                           f"{profile.downcode_rate*100:.1f}% downcode rate",
            "negotiation_priority": "high" if recommended_increase > 5 else "medium"
        }
    
    def _analyze_trends(self, trends: Dict[str, float]) -> Dict[str, Any]:
        """Analyze denial rate trends"""
        if not trends:
            return {"trend": "insufficient_data"}
        
        sorted_months = sorted(trends.keys())
        if len(sorted_months) < 2:
            return {"trend": "insufficient_data"}
        
        # Calculate trend
        first_rate = trends[sorted_months[0]]
        last_rate = trends[sorted_months[-1]]
        
        if last_rate > first_rate * 1.2:
            trend_direction = "worsening"
        elif last_rate < first_rate * 0.8:
            trend_direction = "improving"
        else:
            trend_direction = "stable"
        
        return {
            "trend_direction": trend_direction,
            "first_month_rate": f"{first_rate*100:.1f}%",
            "last_month_rate": f"{last_rate*100:.1f}%",
            "change_percentage": f"{((last_rate - first_rate) / first_rate * 100) if first_rate > 0 else 0:.1f}%"
        }
    
    def get_predictive_insights(self) -> Dict[str, Any]:
        """
        Generate predictive insights from flywheel data
        """
        if not self.flywheel_data:
            return {"error": "No data available"}
        
        # Identify patterns
        insights = []
        
        # Find payers with worsening trends
        worsening_payers = []
        for payer_id, profile in self.payer_profiles.items():
            if len(profile.denial_trends) >= 2:
                months = sorted(profile.denial_trends.keys())
                first = profile.denial_trends[months[0]]
                last = profile.denial_trends[months[-1]]
                if last > first * 1.3:  # 30% increase
                    worsening_payers.append({
                        "payer_id": payer_id,
                        "payer_name": profile.payer_name,
                        "denial_increase": f"{((last - first) / first * 100):.1f}%"
                    })
        
        if worsening_payers:
            insights.append({
                "type": "warning",
                "message": f"{len(worsening_payers)} payers showing worsening denial trends",
                "affected_payers": worsening_payers
            })
        
        # Find best performing payers (for comparison)
        best_payers = sorted(
            self.payer_profiles.values(),
            key=lambda p: p.approval_rate,
            reverse=True
        )[:3]
        
        # Predict future claim success rates
        recent_interactions = [
            i for i in self.interactions
            if i.timestamp > datetime.utcnow() - timedelta(days=30)
        ]
        
        if recent_interactions:
            recent_approval_rate = sum(
                1 for i in recent_interactions if i.outcome == "approved"
            ) / len(recent_interactions)
            
            insights.append({
                "type": "prediction",
                "message": f"Current 30-day approval rate: {recent_approval_rate*100:.1f}%",
                "prediction": "Stable" if recent_approval_rate > 0.7 else "Action needed"
            })
        
        return {
            "flywheel_metrics": self.flywheel_data,
            "insights": insights,
            "best_performing_payers": [
                {"payer_id": p.payer_id, "payer_name": p.payer_name, "approval_rate": f"{p.approval_rate*100:.1f}%"}
                for p in best_payers
            ],
            "recommended_actions": self._generate_recommended_actions(),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    def _generate_recommended_actions(self) -> List[Dict[str, Any]]:
        """Generate recommended actions based on analytics"""
        actions = []
        
        # Identify payers needing contract renegotiation
        for payer_id, profile in self.payer_profiles.items():
            if profile.contract_leverage_score > 0.7:
                actions.append({
                    "priority": "high",
                    "action": "initiate_contract_renegotiation",
                    "payer_id": payer_id,
                    "payer_name": profile.payer_name,
                    "reason": f"High aggressive score ({profile.aggressive_score:.2f}) indicates significant revenue loss",
                    "expected_impact": f"${profile.total_interactions * profile.denial_rate * 100:.0f} monthly recovery potential"
                })
        
        # Identify procedures needing documentation improvement
        all_denied_procedures = Counter()
        for profile in self.payer_profiles.values():
            for proc, count in profile.most_denied_procedures:
                all_denied_procedures[proc] += count
        
        top_denied = all_denied_procedures.most_common(3)
        for proc, count in top_denied:
            actions.append({
                "priority": "medium",
                "action": "improve_documentation_templates",
                "procedure_code": proc,
                "reason": f"Frequently denied across {count} cases",
                "recommendation": "Create procedure-specific documentation templates with required elements"
            })
        
        return actions
    
    async def generate_contract_renewal_briefing(
        self,
        payer_id: str
    ) -> Dict[str, Any]:
        """
        Generate comprehensive briefing for contract renewal negotiations
        """
        profile = self.payer_profiles.get(payer_id)
        if not profile:
            return {"error": "Payer not found"}
        
        leverage_report = self.get_contract_leverage_report(payer_id)
        
        # Calculate financial impact
        total_billed = sum(
            i for i in self.interactions
            if i.payer_id == payer_id
        )
        
        # Estimated annual loss
        estimated_annual_loss = (
            profile.denial_rate * 0.3 +  # Denied claims
            profile.downcode_rate * 0.2 +  # Downcoding
            profile.underpayment_rate * 0.25  # Underpayments
        ) * 1000000  # Assume $1M annual billing
        
        return {
            "briefing_title": f"Contract Renewal Briefing: {profile.payer_name}",
            "executive_summary": {
                "total_interactions_analyzed": profile.total_interactions,
                "contract_leverage_score": f"{profile.contract_leverage_score:.2f}/1.0",
                "negotiation_strength": "Strong" if profile.contract_leverage_score > 0.6 else "Moderate",
                "estimated_annual_revenue_at_risk": f"${estimated_annual_loss:,.0f}"
            },
            "payer_behavior_analysis": {
                "approval_rate": f"{profile.approval_rate*100:.1f}%",
                "denial_rate": f"{profile.denial_rate*100:.1f}%",
                "downcode_rate": f"{profile.downcode_rate*100:.1f}%",
                "underpayment_rate": f"{profile.underpayment_rate*100:.1f}%",
                "avg_processing_time": f"{profile.avg_processing_days:.1f} days"
            },
            "negotiation_strategy": leverage_report,
            "supporting_data": {
                "top_denial_reasons": profile.top_denial_reasons,
                "most_problematic_procedures": profile.most_denied_procedures,
                "trend_analysis": self._analyze_trends(profile.denial_trends)
            },
            "recommended_terms": {
                "rate_increase": leverage_report.get("recommended_rate_increase", {}),
                "timely_filing": "Require 30-day processing commitment",
                "downcode_protection": "Implement automatic re-review for downcoded claims",
                "underpayment_interest": "Require interest on underpayments >30 days"
            },
            "generated_at": datetime.utcnow().isoformat()
        }


# Global instance
payer_behavior_analytics = PayerBehaviorAnalyticsEngine()
