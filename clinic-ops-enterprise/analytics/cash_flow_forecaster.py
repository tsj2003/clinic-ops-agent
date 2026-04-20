"""
Predictive Cash Flow Forecasting Engine
Predicts future revenue, identifies collection risks, optimizes cash flow
"""

import asyncio
import numpy as np
import pandas as pd
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
from collections import defaultdict
import statistics


class ForecastPeriod(str, Enum):
    """Forecast time periods"""
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"


class CashFlowCategory(str, Enum):
    """Categories of cash flow"""
    INSURANCE_PAYMENTS = "insurance_payments"
    PATIENT_PAYMENTS = "patient_payments"
    ADJUSTMENTS = "adjustments"
    REFUNDS = "refunds"


@dataclass
class CashFlowForecast:
    """Cash flow forecast result"""
    forecast_date: date
    period: ForecastPeriod
    predicted_revenue: float
    confidence_interval_lower: float
    confidence_interval_upper: float
    breakdown: Dict[str, float]
    assumptions: Dict[str, Any]
    risk_factors: List[str]
    collection_probability: float


@dataclass
class CollectionRisk:
    """Collection risk assessment"""
    claim_id: str
    payer_id: str
    amount: float
    age_days: int
    risk_score: float  # 0-1
    risk_factors: List[str]
    predicted_payment_date: Optional[date]
    predicted_payment_probability: float
    recommended_action: str


class CashFlowConfig(BaseModel):
    """Configuration for cash flow forecasting"""
    # Forecast settings
    default_forecast_days: int = Field(default=90, ge=30, le=365)
    confidence_level: float = Field(default=0.95, ge=0.8, le=0.99)
    
    # Historical data
    min_history_days: int = Field(default=90, ge=30, le=365)
    max_history_days: int = Field(default=365, ge=180, le=730)
    
    # Risk thresholds
    high_risk_age_days: int = Field(default=60, ge=30, le=120)
    critical_risk_age_days: int = Field(default=90, ge=60, le=180)
    
    # Payer-specific settings
    use_payer_historical_patterns: bool = True
    payer_adjustment_factors: Dict[str, float] = Field(default_factory=dict)
    
    # Model settings
    seasonality_enabled: bool = True
    trend_adjustment: bool = True
    
    class Config:
        json_schema_extra = {
            "example": {
                "default_forecast_days": 90,
                "confidence_level": 0.95,
                "high_risk_age_days": 60
            }
        }


class HistoricalDataCollector:
    """Collects and processes historical payment data"""
    
    def __init__(self, db_connection=None):
        self.db = db_connection
    
    async def collect_payment_history(
        self,
        start_date: datetime,
        end_date: datetime,
        payer_id: Optional[str] = None
    ) -> pd.DataFrame:
        """Collect historical payment data"""
        # In production: query from MongoDB
        # Return DataFrame with columns:
        # - date, amount, payer_id, claim_id, payment_type, age_at_payment
        
        data = {
            'date': [],
            'amount': [],
            'payer_id': [],
            'claim_id': [],
            'payment_type': [],
            'age_at_payment_days': []
        }
        
        return pd.DataFrame(data)
    
    async def collect_claims_outstanding(
        self,
        as_of_date: datetime
    ) -> pd.DataFrame:
        """Collect all outstanding claims as of a date"""
        # Columns: claim_id, payer_id, amount, submitted_date, age_days, status
        
        data = {
            'claim_id': [],
            'payer_id': [],
            'amount': [],
            'submitted_date': [],
            'age_days': [],
            'status': [],
            'denial_count': []
        }
        
        return pd.DataFrame(data)
    
    def calculate_payer_patterns(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Calculate payment patterns by payer"""
        patterns = {}
        
        for payer_id in df['payer_id'].unique():
            payer_data = df[df['payer_id'] == payer_id]
            
            patterns[payer_id] = {
                'avg_payment_days': payer_data['age_at_payment_days'].mean(),
                'std_payment_days': payer_data['age_at_payment_days'].std(),
                'median_payment_days': payer_data['age_at_payment_days'].median(),
                'payment_volume_30d': len(payer_data[payer_data['date'] >= datetime.utcnow() - timedelta(days=30)]),
                'total_collected': payer_data['amount'].sum(),
                'avg_claim_amount': payer_data['amount'].mean(),
                'payment_reliability': 1.0 - (payer_data['age_at_payment_days'] > 60).mean()
            }
        
        return patterns


class SeasonalityAnalyzer:
    """Analyzes seasonal patterns in cash flow"""
    
    def __init__(self):
        self.seasonal_patterns: Dict[str, Dict[int, float]] = {}
    
    def analyze(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Analyze seasonality in payment data"""
        df = df.copy()
        df['month'] = pd.to_datetime(df['date']).dt.month
        df['day_of_week'] = pd.to_datetime(df['date']).dt.dayofweek
        df['week_of_year'] = pd.to_datetime(df['date']).dt.isocalendar().week
        
        # Monthly patterns
        monthly_avg = df.groupby('month')['amount'].mean()
        overall_avg = df['amount'].mean()
        
        monthly_factors = {}
        for month in range(1, 13):
            if month in monthly_avg:
                monthly_factors[month] = monthly_avg[month] / overall_avg
            else:
                monthly_factors[month] = 1.0
        
        # Day of week patterns
        daily_avg = df.groupby('day_of_week')['amount'].mean()
        daily_factors = {}
        for day in range(7):
            if day in daily_avg:
                daily_factors[day] = daily_avg[day] / overall_avg
            else:
                daily_factors[day] = 1.0
        
        return {
            'monthly_factors': monthly_factors,
            'daily_factors': daily_factors,
            'peak_months': monthly_avg.nlargest(3).index.tolist(),
            'slow_months': monthly_avg.nsmallest(3).index.tolist(),
            'best_days': daily_avg.nlargest(3).index.tolist()
        }
    
    def apply_seasonality(
        self,
        base_amount: float,
        forecast_date: date,
        patterns: Dict[str, Any]
    ) -> float:
        """Apply seasonal adjustment to base amount"""
        adjusted = base_amount
        
        # Monthly adjustment
        month_factor = patterns['monthly_factors'].get(forecast_date.month, 1.0)
        adjusted *= month_factor
        
        # Day of week adjustment
        day_factor = patterns['daily_factors'].get(forecast_date.weekday(), 1.0)
        adjusted *= day_factor
        
        return adjusted


class CashFlowForecaster:
    """
    Main cash flow forecasting engine
    
    Uses multiple methods:
    1. Historical average with seasonality
    2. Outstanding claims probability-weighted
    3. Payer-specific patterns
    4. Trend analysis
    """
    
    def __init__(self, config: Optional[CashFlowConfig] = None):
        self.config = config or CashFlowConfig()
        self.collector = HistoricalDataCollector()
        self.seasonality = SeasonalityAnalyzer()
    
    async def generate_forecast(
        self,
        forecast_days: Optional[int] = None,
        period: ForecastPeriod = ForecastPeriod.DAILY
    ) -> List[CashFlowForecast]:
        """
        Generate cash flow forecast
        
        Returns list of daily/weekly/monthly forecasts
        """
        days = forecast_days or self.config.default_forecast_days
        
        # Collect historical data
        end_history = datetime.utcnow()
        start_history = end_history - timedelta(days=self.config.max_history_days)
        
        historical_payments = await self.collector.collect_payment_history(
            start_history, end_history
        )
        
        if len(historical_payments) < 100:
            return self._generate_simple_forecast(days, period)
        
        # Calculate patterns
        payer_patterns = self.collector.calculate_payer_patterns(historical_payments)
        
        # Analyze seasonality
        seasonal_patterns = self.seasonality.analyze(historical_payments)
        
        # Get outstanding claims
        outstanding = await self.collector.collectlect_claims_outstanding(end_history)
        
        # Calculate base metrics
        avg_daily_revenue = historical_payments['amount'].sum() / len(historical_payments)
        revenue_std = historical_payments.groupby(
            pd.to_datetime(historical_payments['date']).dt.date
        )['amount'].sum().std()
        
        # Generate forecasts
        forecasts = []
        start_date = date.today()
        
        for day_offset in range(days):
            forecast_date = start_date + timedelta(days=day_offset)
            
            # Method 1: Historical average with seasonality
            base_amount = avg_daily_revenue
            seasonal_amount = self.seasonality.apply_seasonality(
                base_amount, forecast_date, seasonal_patterns
            )
            
            # Method 2: Outstanding claims collection prediction
            collection_amount = self._predict_collections(
                outstanding, forecast_date, payer_patterns
            )
            
            # Method 3: Payer-specific trend
            trend_amount = self._calculate_trend_adjustment(
                historical_payments, forecast_date
            )
            
            # Combine methods (weighted average)
            predicted_revenue = (
                seasonal_amount * 0.4 +
                collection_amount * 0.4 +
                trend_amount * 0.2
            )
            
            # Calculate confidence interval
            z_score = 1.96 if self.config.confidence_level == 0.95 else 2.576
            margin = z_score * (revenue_std / np.sqrt(len(historical_payments) / days))
            
            # Identify risk factors
            risk_factors = self._identify_risk_factors(
                forecast_date, outstanding, payer_patterns
            )
            
            # Collection probability
            collection_prob = self._calculate_collection_probability(
                outstanding, forecast_date, payer_patterns
            )
            
            forecasts.append(CashFlowForecast(
                forecast_date=forecast_date,
                period=period,
                predicted_revenue=predicted_revenue,
                confidence_interval_lower=max(0, predicted_revenue - margin),
                confidence_interval_upper=predicted_revenue + margin,
                breakdown={
                    "seasonal_component": seasonal_amount,
                    "collection_component": collection_amount,
                    "trend_component": trend_amount
                },
                assumptions={
                    "payer_patterns_used": len(payer_patterns),
                    "seasonality_adjusted": self.config.seasonality_enabled,
                    "historical_data_points": len(historical_payments)
                },
                risk_factors=risk_factors,
                collection_probability=collection_prob
            ))
        
        return forecasts
    
    def _generate_simple_forecast(
        self,
        days: int,
        period: ForecastPeriod
    ) -> List[CashFlowForecast]:
        """Generate simple forecast when insufficient historical data"""
        forecasts = []
        start_date = date.today()
        
        # Use default assumptions
        default_daily = 10000.0  # Placeholder
        
        for day_offset in range(days):
            forecast_date = start_date + timedelta(days=day_offset)
            
            forecasts.append(CashFlowForecast(
                forecast_date=forecast_date,
                period=period,
                predicted_revenue=default_daily,
                confidence_interval_lower=default_daily * 0.7,
                confidence_interval_upper=default_daily * 1.3,
                breakdown={"estimated": default_daily},
                assumptions={"method": "default_estimate", "insufficient_data": True},
                risk_factors=["insufficient_historical_data"],
                collection_probability=0.8
            ))
        
        return forecasts
    
    def _predict_collections(
        self,
        outstanding: pd.DataFrame,
        forecast_date: date,
        payer_patterns: Dict[str, Any]
    ) -> float:
        """Predict collections from outstanding claims"""
        if outstanding.empty:
            return 0.0
        
        predicted_collections = 0.0
        
        for _, claim in outstanding.iterrows():
            payer_id = claim['payer_id']
            age_days = claim['age_days']
            amount = claim['amount']
            
            # Get payer pattern
            pattern = payer_patterns.get(payer_id, {
                'avg_payment_days': 30,
                'payment_reliability': 0.9
            })
            
            # Calculate probability of payment by forecast date
            avg_payment_days = pattern.get('avg_payment_days', 30)
            days_until_payment = max(0, avg_payment_days - age_days)
            
            # If forecast date is around expected payment date
            forecast_days_from_now = (forecast_date - date.today()).days
            
            if abs(days_until_payment - forecast_days_from_now) <= 7:
                # High probability of collection around this time
                prob = pattern.get('payment_reliability', 0.9)
                predicted_collections += amount * prob
        
        return predicted_collections
    
    def _calculate_trend_adjustment(
        self,
        historical: pd.DataFrame,
        forecast_date: date
    ) -> float:
        """Calculate trend-based adjustment"""
        if len(historical) < 60:
            return historical['amount'].mean()
        
        # Simple linear trend
        daily_totals = historical.groupby(
            pd.to_datetime(historical['date']).dt.date
        )['amount'].sum().reset_index()
        
        daily_totals['day_number'] = range(len(daily_totals))
        
        # Linear regression
        x = daily_totals['day_number'].values
        y = daily_totals['amount'].values
        
        n = len(x)
        slope = (n * np.sum(x * y) - np.sum(x) * np.sum(y)) / (n * np.sum(x**2) - np.sum(x)**2)
        intercept = (np.sum(y) - slope * np.sum(x)) / n
        
        # Predict for forecast date
        days_from_end = (forecast_date - date.today()).days
        trend_prediction = intercept + slope * (n + days_from_end)
        
        return max(0, trend_prediction)
    
    def _identify_risk_factors(
        self,
        forecast_date: date,
        outstanding: pd.DataFrame,
        payer_patterns: Dict[str, Any]
    ) -> List[str]:
        """Identify risk factors for forecast"""
        risks = []
        
        # Check for old claims
        old_claims = outstanding[outstanding['age_days'] > self.config.high_risk_age_days]
        if len(old_claims) > 0:
            risks.append(f"{len(old_claims)} claims over {self.config.high_risk_age_days} days old")
        
        # Check for unreliable payers
        unreliable_payers = [
            payer for payer, pattern in payer_patterns.items()
            if pattern.get('payment_reliability', 1.0) < 0.8
        ]
        if unreliable_payers:
            risks.append(f"Unreliable payers: {', '.join(unreliable_payers[:3])}")
        
        # Check for seasonal slow period
        if forecast_date.month in [12, 1]:  # Holiday season
            risks.append("Holiday season - typically slower collections")
        
        return risks
    
    def _calculate_collection_probability(
        self,
        outstanding: pd.DataFrame,
        forecast_date: date,
        payer_patterns: Dict[str, Any]
    ) -> float:
        """Calculate overall collection probability"""
        if outstanding.empty:
            return 1.0
        
        total_amount = outstanding['amount'].sum()
        weighted_prob = 0.0
        
        for _, claim in outstanding.iterrows():
            payer_id = claim['payer_id']
            amount = claim['amount']
            
            pattern = payer_patterns.get(payer_id, {'payment_reliability': 0.9})
            prob = pattern.get('payment_reliability', 0.9)
            
            weighted_prob += amount * prob
        
        return weighted_prob / total_amount if total_amount > 0 else 0.0
    
    async def assess_collection_risks(
        self,
        min_risk_score: float = 0.5
    ) -> List[CollectionRisk]:
        """Assess collection risks for outstanding claims"""
        # Get outstanding claims
        as_of = datetime.utcnow()
        outstanding = await self.collector.collect_claims_outstanding(as_of)
        
        # Get payer patterns
        start_history = as_of - timedelta(days=self.config.max_history_days)
        historical = await self.collector.collect_payment_history(start_history, as_of)
        payer_patterns = self.collector.calculate_payer_patterns(historical)
        
        risks = []
        
        for _, claim in outstanding.iterrows():
            risk_score = 0.0
            risk_factors = []
            
            # Age-based risk
            age_days = claim['age_days']
            if age_days > self.config.critical_risk_age_days:
                risk_score += 0.4
                risk_factors.append(f"Critical age: {age_days} days")
            elif age_days > self.config.high_risk_age_days:
                risk_score += 0.25
                risk_factors.append(f"High age: {age_days} days")
            
            # Payer reliability risk
            payer_id = claim['payer_id']
            pattern = payer_patterns.get(payer_id, {})
            reliability = pattern.get('payment_reliability', 0.9)
            
            if reliability < 0.7:
                risk_score += 0.3
                risk_factors.append("Unreliable payer history")
            elif reliability < 0.85:
                risk_score += 0.15
                risk_factors.append("Below average payer reliability")
            
            # Multiple denials risk
            if claim.get('denial_count', 0) > 1:
                risk_score += 0.2
                risk_factors.append(f"Multiple denials ({claim['denial_count']})")
            
            # Predict payment
            predicted_payment = None
            payment_prob = reliability
            
            if risk_score < 0.3:
                avg_payment_days = pattern.get('avg_payment_days', 30)
                predicted_payment = date.today() + timedelta(
                    days=max(0, avg_payment_days - age_days)
                )
            
            if risk_score >= min_risk_score:
                risks.append(CollectionRisk(
                    claim_id=claim['claim_id'],
                    payer_id=payer_id,
                    amount=claim['amount'],
                    age_days=age_days,
                    risk_score=min(risk_score, 1.0),
                    risk_factors=risk_factors,
                    predicted_payment_date=predicted_payment,
                    predicted_payment_probability=payment_prob,
                    recommended_action=self._get_collection_action(risk_score)
                ))
        
        return sorted(risks, key=lambda x: x.risk_score, reverse=True)
    
    def _get_collection_action(self, risk_score: float) -> str:
        """Get recommended collection action based on risk"""
        if risk_score >= 0.8:
            return "Immediate escalation to collections team"
        elif risk_score >= 0.6:
            return "Aggressive follow-up and appeal preparation"
        elif risk_score >= 0.4:
            return "Standard follow-up with documentation review"
        else:
            return "Monitor and routine follow-up"
    
    def generate_summary_report(
        self,
        forecasts: List[CashFlowForecast],
        risks: List[CollectionRisk]
    ) -> Dict[str, Any]:
        """Generate executive summary of forecast"""
        total_predicted = sum(f.predicted_revenue for f in forecasts)
        avg_daily = total_predicted / len(forecasts) if forecasts else 0
        
        # Risk summary
        high_risk_amount = sum(r.amount for r in risks if r.risk_score >= 0.7)
        total_outstanding = sum(r.amount for r in risks)
        
        return {
            "forecast_period": {
                "start": forecasts[0].forecast_date.isoformat() if forecasts else None,
                "end": forecasts[-1].forecast_date.isoformat() if forecasts else None,
                "days": len(forecasts)
            },
            "predicted_revenue": {
                "total": total_predicted,
                "average_daily": avg_daily,
                "confidence_range": {
                    "low": sum(f.confidence_interval_lower for f in forecasts),
                    "high": sum(f.confidence_interval_upper for f in forecasts)
                }
            },
            "collection_risk": {
                "high_risk_claims": len([r for r in risks if r.risk_score >= 0.7]),
                "high_risk_amount": high_risk_amount,
                "total_at_risk": total_outstanding,
                "risk_percentage": (high_risk_amount / total_outstanding * 100) if total_outstanding > 0 else 0
            },
            "key_insights": self._generate_insights(forecasts, risks),
            "recommendations": self._generate_recommendations(forecasts, risks)
        }
    
    def _generate_insights(
        self,
        forecasts: List[CashFlowForecast],
        risks: List[CollectionRisk]
    ) -> List[str]:
        """Generate key insights from forecast"""
        insights = []
        
        # Revenue trend
        first_week = sum(f.predicted_revenue for f in forecasts[:7])
        last_week = sum(f.predicted_revenue for f in forecasts[-7:])
        
        if last_week > first_week * 1.1:
            insights.append("Revenue trending upward (+10% forecasted)")
        elif last_week < first_week * 0.9:
            insights.append("Revenue trending downward (-10% forecasted)")
        
        # Collection risks
        if risks:
            avg_risk = sum(r.risk_score for r in risks) / len(risks)
            if avg_risk > 0.5:
                insights.append(f"High average collection risk ({avg_risk:.1%})")
        
        return insights
    
    def _generate_recommendations(
        self,
        forecasts: List[CashFlowForecast],
        risks: List[CollectionRisk]
    ) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        # Focus on high-risk collections
        high_risk = [r for r in risks if r.risk_score >= 0.7]
        if high_risk:
            recommendations.append(
                f"Prioritize {len(high_risk)} high-risk claims worth ${sum(r.amount for r in high_risk):,.2f}"
            )
        
        # Payer-specific recommendations
        payer_risks = defaultdict(list)
        for r in risks:
            payer_risks[r.payer_id].append(r)
        
        for payer_id, payer_risks_list in payer_risks.items():
            if len(payer_risks_list) > 5:
                recommendations.append(
                    f"Review payer {payer_id} relationship - {len(payer_risks_list)} claims at risk"
                )
        
        return recommendations


# ==================== API ENDPOINTS ====================

async def get_cash_flow_forecast(
    days: int = 90,
    period: str = "daily"
) -> Dict[str, Any]:
    """API endpoint to get cash flow forecast"""
    forecaster = CashFlowForecaster()
    
    forecasts = await forecaster.generate_forecast(
        forecast_days=days,
        period=ForecastPeriod(period)
    )
    
    return {
        "forecasts": [
            {
                "date": f.forecast_date.isoformat(),
                "predicted_revenue": f.predicted_revenue,
                "confidence_low": f.confidence_interval_lower,
                "confidence_high": f.confidence_interval_upper,
                "collection_probability": f.collection_probability,
                "risk_factors": f.risk_factors
            }
            for f in forecasts
        ],
        "summary": {
            "total_predicted": sum(f.predicted_revenue for f in forecasts),
            "average_daily": sum(f.predicted_revenue for f in forecasts) / len(forecasts)
        }
    }


async def get_collection_risks(min_risk_score: float = 0.5) -> Dict[str, Any]:
    """API endpoint to get collection risk assessment"""
    forecaster = CashFlowForecaster()
    
    risks = await forecaster.assess_collection_risks(min_risk_score)
    
    return {
        "risks": [
            {
                "claim_id": r.claim_id,
                "payer_id": r.payer_id,
                "amount": r.amount,
                "age_days": r.age_days,
                "risk_score": r.risk_score,
                "risk_factors": r.risk_factors,
                "predicted_payment_date": r.predicted_payment_date.isoformat() if r.predicted_payment_date else None,
                "predicted_payment_probability": r.predicted_payment_probability,
                "recommended_action": r.recommended_action
            }
            for r in risks
        ],
        "summary": {
            "total_at_risk": sum(r.amount for r in risks),
            "high_risk_count": len([r for r in risks if r.risk_score >= 0.7])
        }
    }
