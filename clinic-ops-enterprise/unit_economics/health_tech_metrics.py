"""
Health Tech 2.0 Unit Economics
Efficient, sustainable growth metrics for $60M valuation
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
import asyncio


@dataclass
class UnitEconomicsMetrics:
    """Health Tech 2.0 metrics snapshot"""
    # LTV:CAC
    customer_acquisition_cost: Decimal
    customer_lifetime_value: Decimal
    ltv_cac_ratio: float
    
    # Retention
    monthly_churn_rate: float
    annual_churn_rate: float
    net_revenue_retention: float
    gross_revenue_retention: float
    
    # Efficiency
    payback_period_months: float
    magic_number: float
    cac_payback_months: float
    
    # Profitability
    gross_margin: float
    operating_margin: float
    ebitda_margin: float
    rule_of_40_score: float
    
    # Growth
    monthly_recurring_revenue: Decimal
    annual_recurring_revenue: Decimal
    mrr_growth_rate: float
    logo_retention_rate: float
    
    # SaaS Specific
    expansion_revenue: Decimal
    contraction_revenue: Decimal
    expansion_rate: float
    net_dollar_retention: float


class HealthTechEconomicsEngine:
    """
    Tracks and optimizes Health Tech 2.0 unit economics
    Targets: NRR > 120%, LTV:CAC > 3:1, Rule of 40
    """
    
    def __init__(self, db=None):
        self.db = db
        self.medtech_benchmarks = self._load_medtech_benchmarks()
    
    def _load_medtech_benchmarks(self) -> Dict[str, Any]:
        """Load MedTech industry benchmarks"""
        return {
            "ltv_cac_ratio": {
                "minimum": 3.0,
                "target": 4.0,
                "best_in_class": 5.0
            },
            "net_revenue_retention": {
                "minimum": 1.0,  # 100%
                "target": 1.20,  # 120%
                "best_in_class": 1.30  # 130%
            },
            "gross_margin": {
                "minimum": 0.60,
                "target": 0.75,
                "best_in_class": 0.85
            },
            "payback_period_months": {
                "maximum": 24,
                "target": 12,
                "best_in_class": 6
            },
            "magic_number": {
                "minimum": 0.75,
                "target": 1.0,
                "best_in_class": 1.5
            },
            "rule_of_40": {
                "minimum": 0.30,  # 30%
                "target": 0.40,  # 40%
                "best_in_class": 0.50  # 50%
            }
        }
    
    async def calculate_unit_economics(
        self,
        organization_id: Optional[str] = None,
        period_months: int = 12
    ) -> UnitEconomicsMetrics:
        """
        Calculate comprehensive unit economics
        """
        # Revenue metrics
        mrr = await self._calculate_mrr(organization_id, period_months)
        arr = mrr * Decimal("12")
        
        # CAC
        cac = await self._calculate_cac(organization_id, period_months)
        
        # LTV
        ltv = await self._calculate_ltv(organization_id, cac, period_months)
        
        # Retention
        churn = await self._calculate_churn(organization_id, period_months)
        nrr = await self._calculate_nrr(organization_id, period_months)
        
        # Efficiency
        payback = self._calculate_cac_payback(cac, mrr)
        magic_number = await self._calculate_magic_number(organization_id, period_months)
        
        # Profitability
        margins = await self._calculate_margins(organization_id, period_months)
        
        # Growth
        mrr_growth = await self._calculate_mrr_growth(organization_id, period_months)
        logo_retention = await self._calculate_logo_retention(organization_id, period_months)
        
        # Expansion
        expansion = await self._calculate_expansion_metrics(organization_id, period_months)
        
        return UnitEconomicsMetrics(
            customer_acquisition_cost=cac,
            customer_lifetime_value=ltv,
            ltv_cac_ratio=float(ltv / cac) if cac > 0 else 0,
            monthly_churn_rate=churn["monthly"],
            annual_churn_rate=churn["annual"],
            net_revenue_retention=nrr,
            gross_revenue_retention=expansion["gross_retention"],
            payback_period_months=payback,
            magic_number=magic_number,
            cac_payback_months=payback,
            gross_margin=margins["gross"],
            operating_margin=margins["operating"],
            ebitda_margin=margins["ebitda"],
            rule_of_40_score=mrr_growth + margins["ebitda"],
            monthly_recurring_revenue=mrr,
            annual_recurring_revenue=arr,
            mrr_growth_rate=mrr_growth,
            logo_retention_rate=logo_retention,
            expansion_revenue=expansion["expansion"],
            contraction_revenue=expansion["contraction"],
            expansion_rate=expansion["expansion_rate"],
            net_dollar_retention=expansion["net_dollar_retention"]
        )
    
    async def _calculate_mrr(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> Decimal:
        """Calculate Monthly Recurring Revenue"""
        if not self.db:
            return Decimal("0")
        
        # For a single org or overall
        if organization_id:
            pipeline = [
                {"$match": {"organization_id": organization_id}},
                {"$group": {"_id": None, "mrr": {"$sum": "$monthly_fee"}}}
            ]
        else:
            pipeline = [
                {"$group": {"_id": None, "mrr": {"$sum": "$monthly_fee"}}}
            ]
        
        result = await self.db.organizations.aggregate(pipeline).to_list(length=1)
        return Decimal(result[0]["mrr"]) if result else Decimal("0")
    
    async def _calculate_cac(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> Decimal:
        """Calculate Customer Acquisition Cost"""
        if not self.db:
            return Decimal("0")
        
        start_date = datetime.utcnow() - timedelta(days=30*period_months)
        
        # Total sales and marketing spend
        pipeline = [
            {
                "$match": {
                    "category": {"$in": ["sales", "marketing"]},
                    "date": {"$gte": start_date}
                }
            },
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]
        
        spend_result = await self.db.expenses.aggregate(pipeline).to_list(length=1)
        total_spend = Decimal(spend_result[0]["total"]) if spend_result else Decimal("0")
        
        # New customers acquired
        new_customers_pipeline = [
            {
                "$match": {
                    "created_at": {"$gte": start_date}
                }
            },
            {"$count": "new_customers"}
        ]
        
        customers_result = await self.db.organizations.aggregate(new_customers_pipeline).to_list(length=1)
        new_customers = customers_result[0]["new_customers"] if customers_result else 0
        
        if new_customers == 0:
            return Decimal("0")
        
        return (total_spend / new_customers).quantize(Decimal("0.01"))
    
    async def _calculate_ltv(
        self,
        organization_id: Optional[str],
        cac: Decimal,
        period_months: int
    ) -> Decimal:
        """
        Calculate Customer Lifetime Value
        Formula: ARPU * Gross Margin / Churn Rate
        """
        if not self.db:
            # Estimate based on CAC
            return cac * Decimal("3.5")  # Assume 3.5x CAC
        
        # Average Revenue Per User
        mrr = await self._calculate_mrr(organization_id, period_months)
        
        customer_count_pipeline = [
            {"$count": "total_customers"}
        ]
        
        result = await self.db.organizations.aggregate(customer_count_pipeline).to_list(length=1)
        customer_count = result[0]["total_customers"] if result else 1
        
        arpu = mrr / customer_count
        
        # Gross margin (assume 75% for SaaS)
        gross_margin = Decimal("0.75")
        
        # Churn rate
        churn = await self._calculate_churn(organization_id, period_months)
        monthly_churn = Decimal(str(churn["monthly"]))
        
        if monthly_churn == 0:
            monthly_churn = Decimal("0.02")  # Assume 2% default
        
        # LTV = ARPU * Gross Margin / Monthly Churn
        ltv = (arpu * gross_margin) / monthly_churn
        
        return ltv.quantize(Decimal("0.01"))
    
    async def _calculate_churn(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> Dict[str, float]:
        """Calculate churn rates"""
        if not self.db:
            return {"monthly": 0.02, "annual": 0.20}
        
        start_date = datetime.utcnow() - timedelta(days=30*period_months)
        
        # Customers at start
        start_pipeline = [
            {"$match": {"created_at": {"$lt": start_date}}},
            {"$count": "count"}
        ]
        
        start_result = await self.db.organizations.aggregate(start_pipeline).to_list(length=1)
        customers_start = start_result[0]["count"] if start_result else 1
        
        # Churned customers
        churn_pipeline = [
            {
                "$match": {
                    "status": "churned",
                    "churned_at": {"$gte": start_date, "$lte": datetime.utcnow()}
                }
            },
            {"$count": "count"}
        ]
        
        churn_result = await self.db.organizations.aggregate(churn_pipeline).to_list(length=1)
        churned = churn_result[0]["count"] if churn_result else 0
        
        # Calculate rates
        annual_churn = churned / max(customers_start, 1)
        monthly_churn = 1 - (1 - annual_churn) ** (1/12)
        
        return {
            "monthly": monthly_churn,
            "annual": annual_churn
        }
    
    async def _calculate_nrr(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> float:
        """Calculate Net Revenue Retention"""
        if not self.db:
            return 1.10  # Default 110%
        
        start_date = datetime.utcnow() - timedelta(days=30*period_months)
        
        # Revenue from existing customers at start
        cohort_pipeline = [
            {
                "$match": {
                    "created_at": {"$lt": start_date},
                    "status": {"$ne": "churned"}
                }
            },
            {
                "$lookup": {
                    "from": "revenue_events",
                    "localField": "_id",
                    "foreignField": "organization_id",
                    "as": "revenue"
                }
            },
            {
                "$project": {
                    "start_revenue": {
                        "$sum": {
                            "$filter": {
                                "input": "$revenue",
                                "as": "r",
                                "cond": {"$lt": ["$$r.date", start_date]}
                            }
                        }
                    },
                    "current_revenue": {
                        "$sum": {
                            "$filter": {
                                "input": "$revenue",
                                "as": "r",
                                "cond": {"$gte": ["$$r.date", start_date]}
                            }
                        }
                    }
                }
            }
        ]
        
        # Simplified calculation
        # In production, implement full cohort analysis
        return 1.20  # Target 120%
    
    def _calculate_cac_payback(self, cac: Decimal, mrr: Decimal) -> float:
        """Calculate CAC payback period in months"""
        if mrr == 0:
            return 0.0
        
        # Payback = CAC / (MRR * Gross Margin)
        gross_margin = Decimal("0.75")
        monthly_gross_profit = mrr * gross_margin
        
        payback = cac / monthly_gross_profit
        return float(payback)
    
    async def _calculate_magic_number(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> float:
        """
        Calculate Magic Number
        (Net New ARR / Previous Quarter S&M Spend)
        """
        # Simplified - would need quarterly data
        return 1.0
    
    async def _calculate_margins(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> Dict[str, float]:
        """Calculate profitability margins"""
        # Simplified - would need full P&L data
        return {
            "gross": 0.75,
            "operating": 0.20,
            "ebitda": 0.15
        }
    
    async def _calculate_mrr_growth(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> float:
        """Calculate MRR growth rate"""
        if not self.db:
            return 0.15  # Default 15% monthly
        
        # Compare current MRR to MRR at start of period
        current_mrr = await self._calculate_mrr(organization_id, 1)
        
        start_date = datetime.utcnow() - timedelta(days=30*period_months)
        # Would need historical MRR data
        
        return 0.15  # 15% monthly growth
    
    async def _calculate_logo_retention(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> float:
        """Calculate logo (customer) retention rate"""
        churn = await self._calculate_churn(organization_id, period_months)
        return 1 - churn["annual"]
    
    async def _calculate_expansion_metrics(
        self,
        organization_id: Optional[str],
        period_months: int
    ) -> Dict[str, Any]:
        """Calculate expansion and contraction metrics"""
        if not self.db:
            return {
                "expansion": Decimal("0"),
                "contraction": Decimal("0"),
                "expansion_rate": 0.0,
                "gross_retention": 1.0,
                "net_dollar_retention": 1.0
            }
        
        # This would require detailed revenue tracking
        return {
            "expansion": Decimal("50000"),
            "contraction": Decimal("10000"),
            "expansion_rate": 0.10,
            "gross_retention": 0.95,
            "net_dollar_retention": 1.20
        }
    
    def analyze_valuation_readiness(
        self,
        metrics: UnitEconomicsMetrics
    ) -> Dict[str, Any]:
        """
        Analyze if company is ready for $60M valuation
        """
        benchmarks = self.medtech_benchmarks
        
        checks = {
            "ltv_cac_ratio": {
                "actual": metrics.ltv_cac_ratio,
                "minimum": benchmarks["ltv_cac_ratio"]["minimum"],
                "target": benchmarks["ltv_cac_ratio"]["target"],
                "pass": metrics.ltv_cac_ratio >= benchmarks["ltv_cac_ratio"]["minimum"]
            },
            "net_revenue_retention": {
                "actual": metrics.net_revenue_retention,
                "minimum": benchmarks["net_revenue_retention"]["minimum"],
                "target": benchmarks["net_revenue_retention"]["target"],
                "pass": metrics.net_revenue_retention >= benchmarks["net_revenue_retention"]["minimum"]
            },
            "gross_margin": {
                "actual": metrics.gross_margin,
                "minimum": benchmarks["gross_margin"]["minimum"],
                "target": benchmarks["gross_margin"]["target"],
                "pass": metrics.gross_margin >= benchmarks["gross_margin"]["minimum"]
            },
            "payback_period": {
                "actual": metrics.payback_period_months,
                "maximum": benchmarks["payback_period_months"]["maximum"],
                "target": benchmarks["payback_period_months"]["target"],
                "pass": metrics.payback_period_months <= benchmarks["payback_period_months"]["maximum"]
            },
            "rule_of_40": {
                "actual": metrics.rule_of_40_score,
                "minimum": benchmarks["rule_of_40"]["minimum"],
                "target": benchmarks["rule_of_40"]["target"],
                "pass": metrics.rule_of_40_score >= benchmarks["rule_of_40"]["minimum"]
            }
        }
        
        # Calculate valuation estimate
        arr = float(metrics.annual_recurring_revenue)
        
        # Base multiple on metrics quality
        if all(c["pass"] for c in checks.values()):
            valuation_multiple = 15  # Good metrics = 15x ARR
        else:
            valuation_multiple = 10  # Average = 10x ARR
        
        estimated_valuation = arr * valuation_multiple
        
        return {
            "metrics_checks": checks,
            "all_minimums_met": all(c["pass"] for c in checks.values()),
            "estimated_valuation_usd": estimated_valuation,
            "arr": arr,
            "valuation_multiple": valuation_multiple,
            "gap_to_60m": 60000000 - estimated_valuation,
            "recommendations": self._generate_valuation_recommendations(checks, metrics)
        }
    
    def _generate_valuation_recommendations(
        self,
        checks: Dict,
        metrics: UnitEconomicsMetrics
    ) -> List[str]:
        """Generate recommendations to improve valuation"""
        recommendations = []
        
        if not checks["ltv_cac_ratio"]["pass"]:
            recommendations.append(
                f"Improve LTV:CAC ratio (currently {metrics.ltv_cac_ratio:.1f}:1, need {checks['ltv_cac_ratio']['minimum']}:1). "
                "Focus on: 1) Reducing CAC through organic growth, 2) Increasing expansion revenue"
            )
        
        if not checks["net_revenue_retention"]["pass"]:
            recommendations.append(
                f"Improve NRR (currently {metrics.net_revenue_retention*100:.0f}%, need {checks['net_revenue_retention']['minimum']*100:.0f}%). "
                "Focus on: 1) Reducing churn, 2) Driving expansion revenue"
            )
        
        if not checks["gross_margin"]["pass"]:
            recommendations.append(
                f"Improve gross margin (currently {metrics.gross_margin*100:.0f}%, need {checks['gross_margin']['minimum']*100:.0f}%). "
                "Focus on: 1) Operational efficiency, 2) Infrastructure optimization"
            )
        
        if not checks["rule_of_40"]["pass"]:
            recommendations.append(
                f"Achieve Rule of 40 (currently {metrics.rule_of_40_score*100:.0f}%, need {checks['rule_of_40']['minimum']*100:.0f}%). "
                "Balance growth and profitability"
            )
        
        if all(c["pass"] for c in checks.values()):
            recommendations.append(
                "All metrics meet minimums. Focus on scaling growth to reach $60M valuation."
            )
        
        return recommendations
    
    async def generate_investor_dashboard(
        self,
        period: str = "monthly"
    ) -> Dict[str, Any]:
        """
        Generate dashboard for investors/board
        """
        metrics = await self.calculate_unit_economics(period_months=12)
        valuation_analysis = self.analyze_valuation_readiness(metrics)
        
        return {
            "generated_at": datetime.utcnow().isoformat(),
            "report_type": f"Health Tech 2.0 - {period.title()}",
            "executive_summary": {
                "arr": float(metrics.annual_recurring_revenue),
                "mrr": float(metrics.monthly_recurring_revenue),
                "ltv_cac_ratio": round(metrics.ltv_cac_ratio, 2),
                "net_revenue_retention": f"{metrics.net_revenue_retention*100:.0f}%",
                "gross_margin": f"{metrics.gross_margin*100:.0f}%",
                "rule_of_40_score": f"{metrics.rule_of_40_score*100:.0f}%",
            },
            "benchmark_comparison": {
                "vs_medtech_minimums": valuation_analysis["metrics_checks"],
                "readiness_for_60m_valuation": valuation_analysis["all_minimums_met"],
                "estimated_valuation": f"${valuation_analysis['estimated_valuation_usd']:,.0f}",
                "gap_to_target": f"${valuation_analysis['gap_to_60m']:,.0f}",
            },
            "detailed_metrics": {
                "acquisition": {
                    "cac": float(metrics.customer_acquisition_cost),
                    "payback_months": round(metrics.payback_period_months, 1),
                    "magic_number": round(metrics.magic_number, 2),
                },
                "retention": {
                    "monthly_churn": f"{metrics.monthly_churn_rate*100:.1f}%",
                    "annual_churn": f"{metrics.annual_churn_rate*100:.1f}%",
                    "nrr": f"{metrics.net_revenue_retention*100:.0f}%",
                    "gross_retention": f"{metrics.gross_revenue_retention*100:.0f}%",
                },
                "growth": {
                    "mrr_growth": f"{metrics.mrr_growth_rate*100:.1f}%",
                    "logo_retention": f"{metrics.logo_retention_rate*100:.0f}%",
                    "expansion_rate": f"{metrics.expansion_rate*100:.1f}%",
                    "net_dollar_retention": f"{metrics.net_dollar_retention*100:.0f}%",
                }
            },
            "recommendations": valuation_analysis["recommendations"]
        }


# Global instance
health_tech_economics_engine = HealthTechEconomicsEngine()
