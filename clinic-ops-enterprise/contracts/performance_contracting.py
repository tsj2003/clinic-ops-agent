"""
Performance-Based Contracting
Outcome-driven contracts with guaranteed results
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
from decimal import Decimal, ROUND_HALF_UP
import asyncio


class ContractType(str, Enum):
    """Performance contract types"""
    GUARANTEED_DENIAL_REDUCTION = "guaranteed_denial_reduction"
    RECOVERY_BASED = "recovery_based"
    NET_COLLECTION_RATE = "net_collection_rate"
    CASH_FLOW_ACCELERATION = "cash_flow_acceleration"
    HYBRID = "hybrid"


class PerformanceMetric(str, Enum):
    """Performance metrics for contracts"""
    DENIAL_RATE_REDUCTION = "denial_rate_reduction"
    FIRST_PASS_RESOLUTION_RATE = "first_pass_resolution_rate"
    DAYS_IN_AR = "days_in_ar"
    NET_COLLECTION_RATE = "net_collection_rate"
    COST_TO_COLLECT = "cost_to_collect"
    APPEAL_SUCCESS_RATE = "appeal_success_rate"
    TIME_TO_PAYMENT = "time_to_payment"


@dataclass
class PerformanceGuarantee:
    """Performance guarantee specification"""
    metric: PerformanceMetric
    baseline_value: float
    target_value: float
    minimum_improvement: float
    measurement_period_months: int
    penalty_if_missed: Decimal
    bonus_if_exceeded: Decimal


@dataclass
class PerformanceContract:
    """Performance-based contract"""
    contract_id: str
    organization_id: str
    contract_type: ContractType
    start_date: datetime
    end_date: datetime
    annual_contract_value: Decimal
    base_fee: Decimal
    performance_fees: Decimal
    guarantees: List[PerformanceGuarantee]
    measurement_schedule: List[str]  # Monthly, quarterly
    reporting_requirements: List[str]
    penalty_structure: Dict[str, Any]
    bonus_structure: Dict[str, Any]


class PerformanceContractEngine:
    """
    Manages performance-based contracts
    Tracks outcomes and calculates penalties/bonuses
    """
    
    def __init__(self, db=None):
        self.db = db
        self.standard_guarantees = self._load_standard_guarantees()
    
    def _load_standard_guarantees(self) -> Dict[str, PerformanceGuarantee]:
        """Load standard performance guarantees"""
        return {
            "denial_reduction_30": PerformanceGuarantee(
                metric=PerformanceMetric.DENIAL_RATE_REDUCTION,
                baseline_value=0.10,  # 10% denial rate
                target_value=0.07,   # Reduce to 7%
                minimum_improvement=0.20,  # At least 20% relative improvement
                measurement_period_months=6,
                penalty_if_missed=Decimal("5000"),
                bonus_if_exceeded=Decimal("10000")
            ),
            "first_pass_90": PerformanceGuarantee(
                metric=PerformanceMetric.FIRST_PASS_RESOLUTION_RATE,
                baseline_value=0.70,  # 70% first pass
                target_value=0.90,   # Achieve 90%
                minimum_improvement=0.15,
                measurement_period_months=3,
                penalty_if_missed=Decimal("3000"),
                bonus_if_exceeded=Decimal("5000")
            ),
            "days_in_ar_30": PerformanceGuarantee(
                metric=PerformanceMetric.DAYS_IN_AR,
                baseline_value=45,   # 45 days
                target_value=30,     # Reduce to 30 days
                minimum_improvement=0.25,
                measurement_period_months=6,
                penalty_if_missed=Decimal("4000"),
                bonus_if_exceeded=Decimal("8000")
            ),
            "net_collection_95": PerformanceGuarantee(
                metric=PerformanceMetric.NET_COLLECTION_RATE,
                baseline_value=0.90,  # 90% collection
                target_value=0.95,   # Achieve 95%
                minimum_improvement=0.05,
                measurement_period_months=12,
                penalty_if_missed=Decimal("10000"),
                bonus_if_exceeded=Decimal("15000")
            ),
        }
    
    def create_performance_contract(
        self,
        organization_id: str,
        contract_type: ContractType,
        baseline_metrics: Dict[str, float],
        annual_value: Decimal,
        guarantees: List[str],  # Keys from standard_guarantees
        contract_duration_months: int = 12
    ) -> PerformanceContract:
        """
        Create new performance-based contract
        """
        contract_id = f"PERF-{datetime.utcnow().strftime('%Y%m%d')}-{organization_id[-4:]}"
        
        # Build guarantee list
        contract_guarantees = []
        for guarantee_key in guarantees:
            if guarantee_key in self.standard_guarantees:
                contract_guarantees.append(self.standard_guarantees[guarantee_key])
        
        # Calculate fee structure
        base_fee = annual_value * Decimal("0.4")  # 40% base, 60% at risk
        performance_fees = annual_value * Decimal("0.6")
        
        return PerformanceContract(
            contract_id=contract_id,
            organization_id=organization_id,
            contract_type=contract_type,
            start_date=datetime.utcnow(),
            end_date=datetime.utcnow() + timedelta(days=30*contract_duration_months),
            annual_contract_value=annual_value,
            base_fee=base_fee,
            performance_fees=performance_fees,
            guarantees=contract_guarantees,
            measurement_schedule=["monthly", "quarterly"],
            reporting_requirements=[
                "denial_rate_report",
                "collection_rate_report",
                "ar_days_report",
                "appeal_success_report"
            ],
            penalty_structure={
                "graduated": True,
                "tiers": [
                    {"threshold": 0.50, "penalty_pct": 0.10},  # 50% of target = 10% penalty
                    {"threshold": 0.75, "penalty_pct": 0.05},  # 75% of target = 5% penalty
                ]
            },
            bonus_structure={
                "exceed_target": 0.20,  # 20% bonus for exceeding target
                "exceed_by_10_pct": 0.30,  # 30% bonus for exceeding by 10%
            }
        )
    
    async def measure_performance(
        self,
        contract: PerformanceContract,
        measurement_date: datetime
    ) -> Dict[str, Any]:
        """
        Measure performance against contract guarantees
        """
        if not self.db:
            return {}
        
        results = []
        
        for guarantee in contract.guarantees:
            # Get current metric value
            current_value = await self._get_current_metric_value(
                contract.organization_id,
                guarantee.metric,
                guarantee.measurement_period_months
            )
            
            # Calculate achievement
            if guarantee.metric in [PerformanceMetric.DENIAL_RATE_REDUCTION, PerformanceMetric.DAYS_IN_AR]:
                # Lower is better
                improvement = (guarantee.baseline_value - current_value) / guarantee.baseline_value
                target_achieved = current_value <= guarantee.target_value
            else:
                # Higher is better
                improvement = (current_value - guarantee.baseline_value) / guarantee.baseline_value
                target_achieved = current_value >= guarantee.target_value
            
            # Determine status
            minimum_met = improvement >= guarantee.minimum_improvement
            
            results.append({
                "metric": guarantee.metric.value,
                "baseline": guarantee.baseline_value,
                "target": guarantee.target_value,
                "current": current_value,
                "improvement_pct": improvement * 100,
                "target_achieved": target_achieved,
                "minimum_met": minimum_met,
                "penalty": guarantee.penalty_if_missed if not minimum_met else Decimal("0"),
                "bonus": guarantee.bonus_if_exceeded if target_achieved else Decimal("0")
            })
        
        # Calculate totals
        total_penalties = sum(r["penalty"] for r in results if r["penalty"])
        total_bonuses = sum(r["bonus"] for r in results if r["bonus"])
        
        # Apply penalty/bonus structure
        final_fee_adjustment = self._calculate_fee_adjustment(
            contract,
            total_penalties,
            total_bonuses,
            results
        )
        
        return {
            "contract_id": contract.contract_id,
            "measurement_date": measurement_date.isoformat(),
            "measurement_period_end": measurement_date.isoformat(),
            "individual_results": results,
            "total_penalties": float(total_penalties),
            "total_bonuses": float(total_bonuses),
            "final_fee_adjustment": float(final_fee_adjustment),
            "contract_status": "compliant" if total_penalties == 0 else "review_required",
            "next_measurement": (measurement_date + timedelta(days=30)).isoformat()
        }
    
    async def _get_current_metric_value(
        self,
        organization_id: str,
        metric: PerformanceMetric,
        period_months: int
    ) -> float:
        """
        Get current value for a performance metric
        """
        start_date = datetime.utcnow() - timedelta(days=30*period_months)
        
        # Query database for metric
        if metric == PerformanceMetric.DENIAL_RATE_REDUCTION:
            # Calculate denial rate
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
                        "total": {"$sum": 1},
                        "denied": {
                            "$sum": {"$cond": [{"$eq": ["$status", "denied"]}, 1, 0]}
                        }
                    }
                }
            ]
            
            result = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
            if result:
                return result[0]["denied"] / max(result[0]["total"], 1)
            return 0.10  # Default baseline
        
        elif metric == PerformanceMetric.FIRST_PASS_RESOLUTION_RATE:
            # Calculate first pass rate
            pipeline = [
                {
                    "$match": {
                        "organization_id": organization_id,
                        "created_at": {"$gte": start_date},
                        "status": {"$in": ["paid", "denied"]}
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "total": {"$sum": 1},
                        "paid_first_pass": {
                            "$sum": {"$cond": [{"$eq": ["$status", "paid"]}, 1, 0]}
                        }
                    }
                }
            ]
            
            result = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
            if result:
                return result[0]["paid_first_pass"] / max(result[0]["total"], 1)
            return 0.70
        
        elif metric == PerformanceMetric.DAYS_IN_AR:
            # Calculate average days in AR
            pipeline = [
                {
                    "$match": {
                        "organization_id": organization_id,
                        "created_at": {"$gte": start_date},
                        "status": {"$ne": "paid"}
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "avg_days": {
                            "$avg": {
                                "$divide": [
                                    {"$subtract": [datetime.utcnow(), "$created_at"]},
                                    1000 * 60 * 60 * 24
                                ]
                            }
                        }
                    }
                }
            ]
            
            result = await self.db.denial_claims.aggregate(pipeline).to_list(length=1)
            if result:
                return result[0]["avg_days"]
            return 45.0
        
        elif metric == PerformanceMetric.NET_COLLECTION_RATE:
            # Calculate collection rate
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
                        "total_billed": {"$sum": "$procedure.billed_amount"},
                        "total_collected": {
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
            if result and result[0]["total_billed"] > 0:
                return result[0]["total_collected"] / result[0]["total_billed"]
            return 0.90
        
        return 0.0
    
    def _calculate_fee_adjustment(
        self,
        contract: PerformanceContract,
        penalties: Decimal,
        bonuses: Decimal,
        results: List[Dict]
    ) -> Decimal:
        """
        Calculate final fee adjustment based on penalties and bonuses
        """
        # Base adjustment
        adjustment = bonuses - penalties
        
        # Apply graduated penalty structure
        penalties_applied = sum(1 for r in results if r["penalty"] > 0)
        total_metrics = len(results)
        
        if total_metrics > 0:
            penalty_ratio = penalties_applied / total_metrics
            
            if penalty_ratio > 0.5:
                # More than 50% of metrics missed - additional penalty
                adjustment -= contract.performance_fees * Decimal("0.10")
        
        # Cap adjustments
        max_penalty = contract.performance_fees * Decimal("0.50")  # Max 50% penalty
        max_bonus = contract.performance_fees * Decimal("0.30")  # Max 30% bonus
        
        adjustment = max(-max_penalty, min(max_bonus, adjustment))
        
        return adjustment
    
    async def generate_performance_report(
        self,
        contract_id: str,
        report_period: str  # "monthly", "quarterly", "annual"
    ) -> Dict[str, Any]:
        """
        Generate performance report for client
        """
        if not self.db:
            return {}
        
        contract = await self.db.performance_contracts.find_one({"contract_id": contract_id})
        if not contract:
            return {"error": "Contract not found"}
        
        # Get all measurements
        measurements = await self.db.performance_measurements.find({
            "contract_id": contract_id
        }).sort("measurement_date", -1).to_list(length=12)
        
        # Calculate trends
        trends = self._calculate_trends(measurements)
        
        return {
            "contract_id": contract_id,
            "report_type": report_period,
            "generated_at": datetime.utcnow().isoformat(),
            "contract_terms": {
                "start_date": contract["start_date"].isoformat() if isinstance(contract["start_date"], datetime) else contract["start_date"],
                "end_date": contract["end_date"].isoformat() if isinstance(contract["end_date"], datetime) else contract["end_date"],
                "annual_value": float(contract["annual_contract_value"]),
                "guarantees": [g["metric"] for g in contract["guarantees"]]
            },
            "performance_summary": {
                "measurements_count": len(measurements),
                "compliance_rate": trends.get("compliance_rate", 0),
                "avg_improvement": trends.get("avg_improvement", 0),
            },
            "financial_impact": {
                "total_bonuses_earned": sum(float(m.get("total_bonuses", 0)) for m in measurements),
                "total_penalties_incurred": sum(float(m.get("total_penalties", 0)) for m in measurements),
                "net_adjustment": sum(float(m.get("final_fee_adjustment", 0)) for m in measurements),
            },
            "trends": trends,
            "recommendations": self._generate_recommendations(measurements, contract)
        }
    
    def _calculate_trends(self, measurements: List[Dict]) -> Dict[str, Any]:
        """Calculate performance trends"""
        if not measurements:
            return {}
        
        # Calculate compliance rate (measurements with no penalties)
        compliant = sum(1 for m in measurements if m.get("total_penalties", 0) == 0)
        compliance_rate = compliant / len(measurements) * 100
        
        # Calculate average improvement
        improvements = []
        for m in measurements:
            for result in m.get("individual_results", []):
                improvements.append(result.get("improvement_pct", 0))
        
        avg_improvement = sum(improvements) / len(improvements) if improvements else 0
        
        return {
            "compliance_rate": compliance_rate,
            "avg_improvement": avg_improvement,
            "trend_direction": "improving" if avg_improvement > 0 else "declining"
        }
    
    def _generate_recommendations(
        self,
        measurements: List[Dict],
        contract: Dict
    ) -> List[str]:
        """Generate recommendations based on performance"""
        recommendations = []
        
        # Identify underperforming metrics
        underperforming = []
        if measurements:
            latest = measurements[0]
            for result in latest.get("individual_results", []):
                if not result.get("target_achieved", False):
                    underperforming.append(result["metric"])
        
        if underperforming:
            recommendations.append(
                f"Focus improvement efforts on: {', '.join(underperforming)}"
            )
        
        # Check if contract should be renewed with different terms
        if measurements and len(measurements) >= 6:
            compliant_rate = sum(1 for m in measurements if m.get("total_penalties", 0) == 0) / len(measurements)
            if compliant_rate > 0.8:
                recommendations.append("Consider increasing performance guarantees for next contract term")
        
        recommendations.extend([
            "Schedule quarterly business reviews to track progress",
            "Implement proactive denial prevention for high-risk claim categories",
            "Consider expanding automation to additional RCM processes"
        ])
        
        return recommendations


# Global instance
performance_contract_engine = PerformanceContractEngine()
