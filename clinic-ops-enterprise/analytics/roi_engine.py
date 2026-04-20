"""
ROI-Driven Pricing and Analytics Engine
Real-time metrics tracking for $100K+ ACV sales
Supports contingency pricing and SaaS subscription models
"""

import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
from decimal import Decimal, ROUND_HALF_UP
import asyncio


class PricingModel(str, Enum):
    """Pricing model types"""
    CONTINGENCY = "contingency"  # % of recovered revenue
    SAAS_TIERED = "saas_tiered"  # Per-claim tiered pricing
    SAAS_UNLIMITED = "saas_unlimited"  # Flat monthly fee
    HYBRID = "hybrid"  # Base + contingency


class ContractTier(str, Enum):
    """ACV contract tiers"""
    STARTER = "starter"  # <$10k
    PROFESSIONAL = "professional"  # $10k-$50k
    ENTERPRISE = "enterprise"  # $50k-$100k
    STRATEGIC = "strategic"  # >$100k


@dataclass
class ROIAnalytics:
    """Real-time ROI analytics snapshot"""
    organization_id: str
    period_start: datetime
    period_end: datetime
    
    # Time metrics
    avg_time_to_detection_hours: float
    avg_time_to_appeal_hours: float
    avg_time_to_resolution_days: float
    
    # Success metrics
    total_denials_detected: int
    total_appeals_drafted: int
    total_appeals_submitted: int
    total_appeals_approved: int
    total_appeals_rejected: int
    success_rate: float
    first_attempt_approval_rate: float
    
    # Financial metrics
    total_denied_amount: Decimal
    total_recovered_amount: Decimal
    total_recovery_rate: float
    avg_recovery_per_appeal: Decimal
    contingency_fees_earned: Decimal
    
    # Efficiency metrics
    labor_hours_saved: float
    cost_per_claim_before: Decimal
    cost_per_claim_after: Decimal
    efficiency_improvement: float
    
    # Quality metrics
    appeals_by_category: Dict[str, int]
    success_by_category: Dict[str, float]
    top_denial_reasons: List[Dict[str, Any]]
    
    # Automation metrics
    fully_automated_approvals: int
    human_approval_rate: float
    avg_human_review_time_minutes: float


@dataclass
class PricingQuote:
    """Pricing quote for prospective client"""
    organization_id: str
    pricing_model: PricingModel
    contract_tier: ContractTier
    estimated_monthly_claims: int
    estimated_recovery_rate: float
    
    # Pricing breakdown
    base_monthly_fee: Decimal
    contingency_percentage: Optional[Decimal]
    per_claim_fee: Optional[Decimal]
    annual_contract_value: Decimal
    
    # ROI projection
    projected_annual_recovery: Decimal
    projected_annual_fees: Decimal
    client_net_benefit: Decimal
    roi_percentage: float
    payback_period_months: float
    
    # Terms
    contract_duration_months: int
    implementation_fee: Decimal
    training_included: bool
    support_level: str


class ROICalculator:
    """
    Calculates ROI metrics for clients
    """
    
    # Industry benchmarks
    AVG_DENIAL_RATE = 0.10  # 10% of claims denied
    AVG_RECOVERY_RATE = 0.65  # 65% appeals successful
    AVG_MANUAL_COST_PER_APPEAL = Decimal("150.00")  # $150 manual labor
    AVG_AUTOMATED_COST_PER_APPEAL = Decimal("15.00")  # $15 automated
    AVG_TIME_MANUAL_HOURS = 4.0  # 4 hours manual
    AVG_TIME_AUTOMATED_HOURS = 0.5  # 30 min automated
    
    def __init__(self):
        self.pricing_tiers = {
            ContractTier.STARTER: {
                "max_monthly_claims": 100,
                "base_fee": Decimal("500"),
                "contingency_rate": Decimal("0.15"),  # 15%
                "per_claim_rate": Decimal("25"),
            },
            ContractTier.PROFESSIONAL: {
                "max_monthly_claims": 500,
                "base_fee": Decimal("2000"),
                "contingency_rate": Decimal("0.12"),  # 12%
                "per_claim_rate": Decimal("20"),
            },
            ContractTier.ENTERPRISE: {
                "max_monthly_claims": 2000,
                "base_fee": Decimal("7500"),
                "contingency_rate": Decimal("0.10"),  # 10%
                "per_claim_rate": Decimal("15"),
            },
            ContractTier.STRATEGIC: {
                "max_monthly_claims": 10000,
                "base_fee": Decimal("25000"),
                "contingency_rate": Decimal("0.08"),  # 8%
                "per_claim_rate": Decimal("10"),
            }
        }
    
    async def calculate_client_roi(
        self,
        organization_id: str,
        monthly_claim_volume: int,
        avg_claim_value: Decimal,
        current_denial_rate: float,
        current_recovery_rate: float,
        labor_cost_per_hour: Decimal,
        period_months: int = 12
    ) -> Dict[str, Any]:
        """
        Calculate ROI projection for a prospective client
        """
        # Calculate denial volume
        monthly_denials = int(monthly_claim_volume * current_denial_rate)
        
        # Current state (manual process)
        current_monthly_labor_hours = monthly_denials * self.AVG_TIME_MANUAL_HOURS
        current_monthly_labor_cost = Decimal(current_monthly_labor_hours) * labor_cost_per_hour
        current_recovery_amount = Decimal(monthly_denials) * avg_claim_value * Decimal(current_recovery_rate)
        
        # With Clinic Ops Agent
        improved_recovery_rate = min(current_recovery_rate + 0.15, 0.85)  # +15% improvement
        automated_monthly_cost = Decimal(monthly_denials) * self.AVG_AUTOMATED_COST_PER_APPEAL
        improved_recovery = Decimal(monthly_denials) * avg_claim_value * Decimal(improved_recovery_rate)
        
        # Monthly savings
        labor_savings = current_monthly_labor_cost - automated_monthly_cost
        additional_recovery = improved_recovery - current_recovery_amount
        total_monthly_benefit = labor_savings + additional_recovery
        
        # Annual projection
        annual_benefit = total_monthly_benefit * period_months
        
        return {
            "current_state": {
                "monthly_denials": monthly_denials,
                "monthly_labor_hours": current_monthly_labor_hours,
                "monthly_labor_cost": float(current_monthly_labor_cost),
                "monthly_recovery": float(current_recovery_amount),
                "annual_recovery": float(current_recovery_amount * period_months),
            },
            "with_automation": {
                "monthly_automation_cost": float(automated_monthly_cost),
                "monthly_recovery": float(improved_recovery),
                "annual_recovery": float(improved_recovery * period_months),
                "additional_recovery_rate": improved_recovery_rate - current_recovery_rate,
            },
            "savings": {
                "monthly_labor_savings": float(labor_savings),
                "monthly_additional_recovery": float(additional_recovery),
                "total_monthly_benefit": float(total_monthly_benefit),
                "annual_benefit": float(annual_benefit),
                "roi_percentage": float((annual_benefit / float(current_monthly_labor_cost * period_months)) * 100),
            },
            "efficiency_gains": {
                "time_reduction_percentage": 87.5,  # (4-0.5)/4
                "faster_reimbursement_days": 45,  # Typical 60 days -> 15 days
            }
        }
    
    def generate_pricing_quote(
        self,
        organization_id: str,
        estimated_monthly_claims: int,
        estimated_avg_claim_value: Decimal,
        preferred_model: PricingModel,
        sales_channel: str = "direct"
    ) -> PricingQuote:
        """
        Generate pricing quote based on volume and model
        """
        # Determine tier
        tier = self._determine_tier(estimated_monthly_claims)
        tier_config = self.pricing_tiers[tier]
        
        # Calculate projections
        estimated_denials = int(estimated_monthly_claims * self.AVG_DENIAL_RATE)
        estimated_recovery = int(estimated_denials * self.AVG_RECOVERY_RATE)
        projected_monthly_recovery = Decimal(estimated_recovery) * estimated_avg_claim_value
        
        # Calculate pricing
        if preferred_model == PricingModel.CONTINGENCY:
            base_monthly = Decimal("0")
            contingency_pct = tier_config["contingency_rate"]
            per_claim = None
            projected_monthly_fees = projected_monthly_recovery * contingency_pct
            
        elif preferred_model == PricingModel.SAAS_TIERED:
            base_monthly = tier_config["base_fee"]
            contingency_pct = None
            per_claim = tier_config["per_claim_rate"]
            projected_monthly_fees = base_monthly + (Decimal(estimated_denials) * per_claim)
            
        elif preferred_model == PricingModel.SAAS_UNLIMITED:
            base_monthly = tier_config["base_fee"] * Decimal("2")
            contingency_pct = None
            per_claim = None
            projected_monthly_fees = base_monthly
            
        else:  # HYBRID
            base_monthly = tier_config["base_fee"] / Decimal("2")
            contingency_pct = tier_config["contingency_rate"] / Decimal("2")
            per_claim = None
            projected_monthly_fees = base_monthly + (projected_monthly_recovery * contingency_pct)
        
        # Annual contract value
        acv = projected_monthly_fees * Decimal("12")
        
        # Client net benefit
        manual_annual_cost = Decimal(estimated_denials * 12) * Decimal("150")  # $150 per manual appeal
        automation_savings = manual_annual_cost - (projected_monthly_fees * Decimal("12"))
        additional_recovery = projected_monthly_recovery * Decimal("12") * Decimal("0.15")  # 15% improvement
        client_net_benefit = automation_savings + additional_recovery
        
        # ROI
        roi_pct = float((client_net_benefit / float(projected_monthly_fees * Decimal("12"))) * 100)
        payback_months = float((tier_config["base_fee"] * Decimal("3")) / projected_monthly_fees) if projected_monthly_fees > 0 else 0
        
        return PricingQuote(
            organization_id=organization_id,
            pricing_model=preferred_model,
            contract_tier=tier,
            estimated_monthly_claims=estimated_monthly_claims,
            estimated_recovery_rate=self.AVG_RECOVERY_RATE,
            base_monthly_fee=base_monthly.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            contingency_percentage=contingency_pct,
            per_claim_fee=per_claim.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if per_claim else None,
            annual_contract_value=acv.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            projected_annual_recovery=(projected_monthly_recovery * Decimal("12")).quantize(Decimal("0.01")),
            projected_annual_fees=(projected_monthly_fees * Decimal("12")).quantize(Decimal("0.01")),
            client_net_benefit=client_net_benefit.quantize(Decimal("0.01")),
            roi_percentage=roi_pct,
            payback_period_months=payback_months,
            contract_duration_months=12,
            implementation_fee=tier_config["base_fee"] if tier != ContractTier.STARTER else Decimal("0"),
            training_included=tier in [ContractTier.ENTERPRISE, ContractTier.STRATEGIC],
            support_level="24/7" if tier == ContractTier.STRATEGIC else "Business Hours"
        )
    
    def _determine_tier(self, monthly_claims: int) -> ContractTier:
        """Determine contract tier based on volume"""
        if monthly_claims <= 100:
            return ContractTier.STARTER
        elif monthly_claims <= 500:
            return ContractTier.PROFESSIONAL
        elif monthly_claims <= 2000:
            return ContractTier.ENTERPRISE
        else:
            return ContractTier.STRATEGIC


class AnalyticsDashboardEngine:
    """
    Real-time analytics for dashboard
    """
    
    def __init__(self, db):
        self.db = db
        self.roi_calculator = ROICalculator()
    
    async def get_realtime_metrics(
        self,
        organization_id: str,
        time_range: str = "30d"
    ) -> Dict[str, Any]:
        """
        Get real-time dashboard metrics
        """
        # Parse time range
        days_map = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
        days = days_map.get(time_range, 30)
        start_date = datetime.utcnow() - timedelta(days=days)
        
        # Aggregate pipeline
        pipeline = [
            {
                "$match": {
                    "organization_id": organization_id,
                    "created_at": {"$gte": start_date}
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_denials": {"$sum": 1},
                    "total_billed": {"$sum": "$procedure.billed_amount"},
                    "appeals_submitted": {
                        "$sum": {
                            "$cond": [{"$in": ["$status", ["submitted", "resolved"]]}, 1, 0]
                        }
                    },
                    "appeals_approved": {
                        "$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}
                    },
                    "appeals_rejected": {
                        "$sum": {"$cond": [{"$eq": ["$status", "rejected"]}, 1, 0]}
                    },
                    "avg_appeal_probability": {"$avg": "$analysis.appeal_probability"},
                    "total_recovery": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$status", "resolved"]},
                                "$procedure.billed_amount",
                                0
                            ]
                        }
                    }
                }
            }
        ]
        
        result = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
        stats = result[0] if result else {}
        
        # Calculate time metrics
        time_metrics = await self._calculate_time_metrics(organization_id, start_date)
        
        # Denial categories breakdown
        categories = await self._get_denial_categories(organization_id, start_date)
        
        # Build metrics response
        submitted = stats.get("appeals_submitted", 0)
        approved = stats.get("appeals_approved", 0)
        
        return {
            "time_range": time_range,
            "generated_at": datetime.utcnow().isoformat(),
            "summary": {
                "total_denials": stats.get("total_denials", 0),
                "total_billed_amount": stats.get("total_billed", 0),
                "appeals_submitted": submitted,
                "appeals_approved": approved,
                "appeals_rejected": stats.get("appeals_rejected", 0),
                "success_rate": round((approved / submitted * 100), 2) if submitted > 0 else 0,
                "total_recovery": stats.get("total_recovery", 0),
                "recovery_rate": round((stats.get("total_recovery", 0) / max(stats.get("total_billed", 1), 1) * 100), 2),
            },
            "time_metrics": time_metrics,
            "denial_categories": categories,
            "performance_trends": await self._get_trends(organization_id, days),
        }
    
    async def _calculate_time_metrics(
        self,
        organization_id: str,
        start_date: datetime
    ) -> Dict[str, float]:
        """Calculate time-based KPIs"""
        # Get claims with complete timeline
        cursor = self.db.denial_claims.find({
            "organization_id": organization_id,
            "created_at": {"$gte": start_date},
            "status": {"$in": ["resolved", "submitted"]}
        })
        
        claims = await cursor.to_list(length=1000)
        
        detection_times = []
        appeal_times = []
        resolution_times = []
        
        for claim in claims:
            created = claim.get("created_at")
            
            # Detection time (scraped -> detected)
            if claim.get("scraper_evidence"):
                scraped = claim["scraper_evidence"].get("extraction_timestamp")
                if scraped and created:
                    detection_times.append((scraped - created).total_seconds() / 3600)
            
            # Appeal drafting time
            if claim.get("appeal_drafts"):
                drafted = claim["appeal_drafts"][0].get("created_timestamp")
                if drafted and created:
                    appeal_times.append((drafted - created).total_seconds() / 3600)
            
            # Resolution time
            if claim.get("status") == "resolved" and claim.get("submission"):
                submitted = claim["submission"].get("submitted_timestamp")
                if submitted and created:
                    resolution_times.append((submitted - created).total_seconds() / (3600 * 24))
        
        return {
            "avg_detection_time_hours": round(sum(detection_times) / len(detection_times), 2) if detection_times else 0,
            "avg_appeal_draft_time_hours": round(sum(appeal_times) / len(appeal_times), 2) if appeal_times else 0,
            "avg_resolution_time_days": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0,
            "first_attempt_approval_rate": 0.0,  # Would need tracking
        }
    
    async def _get_denial_categories(
        self,
        organization_id: str,
        start_date: datetime
    ) -> List[Dict]:
        """Get breakdown by denial category"""
        pipeline = [
            {
                "$match": {
                    "organization_id": organization_id,
                    "created_at": {"$gte": start_date}
                }
            },
            {
                "$group": {
                    "_id": "$analysis.denial_type",
                    "count": {"$sum": 1},
                    "avg_appeal_probability": {"$avg": "$analysis.appeal_probability"},
                    "total_value": {"$sum": "$procedure.billed_amount"},
                    "resolved": {
                        "$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}
                    }
                }
            },
            {"$sort": {"count": -1}}
        ]
        
        results = await self.db.denial_claims.aggregate(pipeline).to_list(length=20)
        
        return [
            {
                "category": r["_id"] or "unknown",
                "count": r["count"],
                "percentage": 0,  # Calculate client-side
                "avg_appeal_probability": round(r.get("avg_appeal_probability", 0), 2),
                "total_value": r["total_value"],
                "success_rate": round((r["resolved"] / r["count"] * 100), 2) if r["count"] > 0 else 0,
            }
            for r in results
        ]
    
    async def _get_trends(
        self,
        organization_id: str,
        days: int
    ) -> List[Dict]:
        """Get trend data over time"""
        # Group by week
        pipeline = [
            {
                "$match": {
                    "organization_id": organization_id,
                    "created_at": {"$gte": datetime.utcnow() - timedelta(days=days)}
                }
            },
            {
                "$group": {
                    "_id": {
                        "year": {"$year": "$created_at"},
                        "week": {"$week": "$created_at"}
                    },
                    "denials": {"$sum": 1},
                    "recovery": {
                        "$sum": {
                            "$cond": [{"$eq": ["$status", "resolved"]}, "$procedure.billed_amount", 0]
                        }
                    }
                }
            },
            {"$sort": {"_id.year": 1, "_id.week": 1}}
        ]
        
        results = await self.db.denial_claims.aggregate(pipeline).to_list(length=52)
        
        return [
            {
                "period": f"{r['_id']['year']}-W{r['_id']['week']}",
                "denials": r["denials"],
                "recovery": r["recovery"]
            }
            for r in results
        ]
    
    async def generate_executive_report(
        self,
        organization_id: str,
        report_month: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Generate executive summary report
        """
        if not report_month:
            report_month = datetime.utcnow().replace(day=1)
        
        next_month = (report_month.replace(day=28) + timedelta(days=4)).replace(day=1)
        
        # Get month metrics
        metrics = await self.get_realtime_metrics(
            organization_id,
            "30d" if report_month.month == datetime.utcnow().month else "1y"
        )
        
        # Calculate contingency fees if applicable
        recovery = metrics["summary"]["total_recovery"]
        contingency_rate = Decimal("0.10")  # Assume 10% for calculation
        fees = Decimal(recovery) * contingency_rate
        
        return {
            "report_type": "Executive Summary",
            "period": report_month.strftime("%B %Y"),
            "generated_at": datetime.utcnow().isoformat(),
            "executive_summary": {
                "total_denials_processed": metrics["summary"]["total_denials"],
                "total_recovery": recovery,
                "success_rate": metrics["summary"]["success_rate"],
                "automation_rate": 85.0,  # Placeholder
                "avg_time_saved_hours": 3.5,
            },
            "financial_impact": {
                "additional_recovery_vs_manual": metrics["summary"]["total_recovery"] * 0.15,
                "labor_cost_savings": metrics["summary"]["total_denials"] * 150 * 0.8,
                "contingency_fees_if_applicable": float(fees),
                "client_net_benefit": metrics["summary"]["total_recovery"] - float(fees),
            },
            "operational_metrics": metrics["time_metrics"],
            "recommendations": await self._generate_recommendations(organization_id),
        }
    
    async def _generate_recommendations(self, organization_id: str) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        # Get top denial reason
        pipeline = [
            {"$match": {"organization_id": organization_id}},
            {"$group": {"_id": "$denial.denial_code", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 1}
        ]
        
        top_denial = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
        
        if top_denial:
            recommendations.append(
                f"Focus on reducing {top_denial[0]['_id']} denials - "
                f"accounts for {top_denial[0]['count']} cases"
            )
        
        recommendations.extend([
            "Implement pre-authorization workflow for high-denial procedures",
            "Review coding accuracy for top 5 denial reasons",
            "Consider contract renegotiation with high-denial payers",
        ])
        
        return recommendations


# Global instances
roi_calculator = ROICalculator()
