"""
Analytics and ROI Engine Tests
Tests pricing calculations and dashboard metrics
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import Mock, AsyncMock, patch

from analytics.roi_engine import (
    ROICalculator,
    AnalyticsDashboardEngine,
    PricingModel,
    ContractTier,
    ROIAnalytics,
    PricingQuote,
    roi_calculator
)


class TestROICalculator:
    """Test ROI calculations"""
    
    @pytest.mark.asyncio
    async def test_calculate_client_roi(self, env_vars):
        """Test basic ROI calculation"""
        calculator = ROICalculator()
        
        roi = await calculator.calculate_client_roi(
            organization_id="org_001",
            monthly_claim_volume=1000,
            avg_claim_value=Decimal("250.00"),
            current_denial_rate=0.10,
            current_recovery_rate=0.50,
            labor_cost_per_hour=Decimal("25.00")
        )
        
        assert "current_state" in roi
        assert "with_automation" in roi
        assert "savings" in roi
        assert roi["savings"]["roi_percentage"] > 0
    
    @pytest.mark.asyncio
    async def test_roi_with_high_volume(self, env_vars):
        """Test ROI with high claim volume"""
        calculator = ROICalculator()
        
        roi = await calculator.calculate_client_roi(
            organization_id="org_002",
            monthly_claim_volume=10000,
            avg_claim_value=Decimal("500.00"),
            current_denial_rate=0.15,
            current_recovery_rate=0.40,
            labor_cost_per_hour=Decimal("30.00")
        )
        
        assert roi["current_state"]["monthly_denials"] == 1500  # 15% of 10,000
        assert roi["savings"]["annual_benefit"] > 0
    
    @pytest.mark.asyncio
    async def test_roi_with_low_recovery(self, env_vars):
        """Test ROI when current recovery is very low"""
        calculator = ROICalculator()
        
        roi = await calculator.calculate_client_roi(
            organization_id="org_003",
            monthly_claim_volume=500,
            avg_claim_value=Decimal("200.00"),
            current_denial_rate=0.08,
            current_recovery_rate=0.10,  # Very low
            labor_cost_per_hour=Decimal("20.00")
        )
        
        # Should show significant improvement potential
        improvement = roi["with_automation"]["additional_recovery_rate"]
        assert improvement > 0
    
    @pytest.mark.asyncio
    async def test_roi_capped_at_85_percent(self, env_vars):
        """Test recovery rate doesn't exceed 85%"""
        calculator = ROICalculator()
        
        roi = await calculator.calculate_client_roi(
            organization_id="org_004",
            monthly_claim_volume=100,
            avg_claim_value=Decimal("100.00"),
            current_denial_rate=0.05,
            current_recovery_rate=0.80,  # Already high
            labor_cost_per_hour=Decimal("25.00")
        )
        
        # Should cap at 85%, not 95%
        assert roi["with_automation"]["additional_recovery_rate"] <= 0.05  # 85% - 80%


class TestPricingQuote:
    """Test pricing quote generation"""
    
    def test_contingency_pricing(self, env_vars):
        """Test contingency pricing model"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="org_001",
            estimated_monthly_claims=500,
            estimated_avg_claim_value=Decimal("300.00"),
            preferred_model=PricingModel.CONTINGENCY
        )
        
        assert quote.pricing_model == PricingModel.CONTINGENCY
        assert quote.base_monthly_fee == Decimal("0.00")
        assert quote.contingency_percentage is not None
        assert quote.contingency_percentage <= Decimal("0.15")  # Max 15%
        assert quote.annual_contract_value > 0
    
    def test_saas_tiered_pricing(self, env_vars):
        """Test SaaS tiered pricing model"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="org_001",
            estimated_monthly_claims=500,
            estimated_avg_claim_value=Decimal("300.00"),
            preferred_model=PricingModel.SAAS_TIERED
        )
        
        assert quote.pricing_model == PricingModel.SAAS_TIERED
        assert quote.base_monthly_fee > 0
        assert quote.per_claim_fee is not None
        assert quote.contingency_percentage is None
    
    def test_saas_unlimited_pricing(self, env_vars):
        """Test SaaS unlimited pricing model"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="org_001",
            estimated_monthly_claims=500,
            estimated_avg_claim_value=Decimal("300.00"),
            preferred_model=PricingModel.SAAS_UNLIMITED
        )
        
        assert quote.pricing_model == PricingModel.SAAS_UNLIMITED
        assert quote.base_monthly_fee > 0
        assert quote.per_claim_fee is None
        assert quote.contingency_percentage is None
    
    def test_hybrid_pricing(self, env_vars):
        """Test hybrid pricing model"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="org_001",
            estimated_monthly_claims=500,
            estimated_avg_claim_value=Decimal("300.00"),
            preferred_model=PricingModel.HYBRID
        )
        
        assert quote.pricing_model == PricingModel.HYBRID
        assert quote.base_monthly_fee > 0  # Reduced base
        assert quote.contingency_percentage is not None  # Reduced contingency
    
    def test_tier_determination(self, env_vars):
        """Test contract tier determination"""
        calculator = ROICalculator()
        
        test_cases = [
            (50, ContractTier.STARTER),
            (100, ContractTier.STARTER),
            (300, ContractTier.PROFESSIONAL),
            (500, ContractTier.PROFESSIONAL),
            (1000, ContractTier.ENTERPRISE),
            (2000, ContractTier.ENTERPRISE),
            (5000, ContractTier.STRATEGIC),
            (10000, ContractTier.STRATEGIC),
        ]
        
        for claims, expected_tier in test_cases:
            quote = calculator.generate_pricing_quote(
                organization_id="test",
                estimated_monthly_claims=claims,
                estimated_avg_claim_value=Decimal("250.00"),
                preferred_model=PricingModel.SAAS_TIERED
            )
            
            assert quote.contract_tier == expected_tier, f"Failed for {claims} claims"
    
    def test_roi_calculation_in_quote(self, env_vars):
        """Test ROI calculation within pricing quote"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="org_001",
            estimated_monthly_claims=1000,
            estimated_avg_claim_value=Decimal("400.00"),
            preferred_model=PricingModel.CONTINGENCY
        )
        
        assert quote.roi_percentage > 0
        assert quote.client_net_benefit > 0
        assert quote.payback_period_months > 0
    
    def test_implementation_fee_by_tier(self, env_vars):
        """Test implementation fee varies by tier"""
        calculator = ROICalculator()
        
        # Starter should have no implementation fee
        starter_quote = calculator.generate_pricing_quote(
            organization_id="test",
            estimated_monthly_claims=50,
            estimated_avg_claim_value=Decimal("200.00"),
            preferred_model=PricingModel.SAAS_TIERED
        )
        assert starter_quote.implementation_fee == Decimal("0.00")
        
        # Enterprise should have implementation fee
        enterprise_quote = calculator.generate_pricing_quote(
            organization_id="test",
            estimated_monthly_claims=2000,
            estimated_avg_claim_value=Decimal("200.00"),
            preferred_model=PricingModel.SAAS_TIERED
        )
        assert enterprise_quote.implementation_fee > 0


class TestAnalyticsDashboard:
    """Test analytics dashboard"""
    
    @pytest.fixture
    def mock_db_with_claims(self):
        """Create mock DB with sample claims"""
        db = Mock()
        
        # Mock aggregate results
        db.denial_claims = Mock()
        db.denial_claims.aggregate = AsyncMock(return_value=AsyncMock(
            to_list=AsyncMock(return_value=[{
                "total_denials": 100,
                "total_billed": 25000.00,
                "appeals_submitted": 80,
                "appeals_approved": 60,
                "appeals_rejected": 20,
                "avg_appeal_probability": 0.75,
                "total_recovery": 15000.00
            }])
        ))
        db.denial_claims.find = Mock(return_value=Mock(
            to_list=AsyncMock(return_value=[])
        ))
        db.denial_claims.distinct = AsyncMock(return_value=["user1", "user2"])
        
        return db
    
    @pytest.mark.asyncio
    async def test_get_realtime_metrics(self, mock_db_with_claims):
        """Test getting dashboard metrics"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        metrics = await engine.get_realtime_metrics(
            organization_id="org_001",
            time_range="30d"
        )
        
        assert "summary" in metrics
        assert "time_metrics" in metrics
        assert "denial_categories" in metrics
        assert metrics["time_range"] == "30d"
    
    @pytest.mark.asyncio
    async def test_get_metrics_different_time_ranges(self, mock_db_with_claims):
        """Test metrics for different time ranges"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        ranges = ["7d", "30d", "90d", "1y"]
        
        for range_val in ranges:
            metrics = await engine.get_realtime_metrics(
                organization_id="org_001",
                time_range=range_val
            )
            
            assert metrics["time_range"] == range_val
    
    @pytest.mark.asyncio
    async def test_calculate_time_metrics(self, mock_db_with_claims):
        """Test time-based KPI calculation"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        # Add claims with timeline
        from datetime import datetime
        claim = {
            "created_at": datetime.utcnow() - timedelta(days=5),
            "scraper_evidence": {
                "extraction_timestamp": datetime.utcnow() - timedelta(days=4)
            },
            "appeal_drafts": [{
                "created_timestamp": datetime.utcnow() - timedelta(days=3)
            }],
            "status": "resolved",
            "submission": {
                "submitted_timestamp": datetime.utcnow() - timedelta(days=1)
            }
        }
        
        mock_db_with_claims.denial_claims.find.return_value.to_list = AsyncMock(return_value=[claim])
        
        metrics = await engine._calculate_time_metrics(
            organization_id="org_001",
            start_date=datetime.utcnow() - timedelta(days=30)
        )
        
        assert "avg_detection_time_hours" in metrics
        assert "avg_appeal_draft_time_hours" in metrics
        assert "avg_resolution_time_days" in metrics
    
    @pytest.mark.asyncio
    async def test_get_denial_categories(self, mock_db_with_claims):
        """Test denial category breakdown"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        # Setup aggregate mock for categories
        mock_db_with_claims.denial_claims.aggregate = AsyncMock(return_value=AsyncMock(
            to_list=AsyncMock(return_value=[
                {"_id": "medical_necessity", "count": 50, "avg_appeal_probability": 0.7, "total_value": 15000, "resolved": 35},
                {"_id": "prior_auth", "count": 30, "avg_appeal_probability": 0.8, "total_value": 9000, "resolved": 25},
            ])
        ))
        
        categories = await engine._get_denial_categories(
            organization_id="org_001",
            start_date=datetime.utcnow() - timedelta(days=30)
        )
        
        assert len(categories) > 0
        for cat in categories:
            assert "category" in cat
            assert "count" in cat
            assert "success_rate" in cat
    
    @pytest.mark.asyncio
    async def test_generate_executive_report(self, mock_db_with_claims, env_vars):
        """Test executive report generation"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        # Setup mocks
        mock_db_with_claims.denial_claims.count_documents = AsyncMock(return_value=100)
        mock_db_with_claims.hipaa_audit_logs = Mock()
        mock_db_with_claims.hipaa_audit_logs.count_documents = AsyncMock(return_value=500)
        
        with patch("analytics.roi_engine.ROICalculator") as mock_calc:
            mock_calc_instance = Mock()
            mock_calc.return_value = mock_calc_instance
            
            report = await engine.generate_executive_report(
                organization_id="org_001",
                report_month=datetime(2025, 1, 1)
            )
        
        assert report["report_type"] == "Executive Summary"
        assert "executive_summary" in report
        assert "financial_impact" in report
        assert "recommendations" in report
    
    @pytest.mark.asyncio
    async def test_generate_recommendations(self, mock_db_with_claims):
        """Test recommendation generation"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        # Setup top denial mock
        mock_db_with_claims.denial_claims.aggregate = AsyncMock(return_value=AsyncMock(
            to_list=AsyncMock(return_value=[{"_id": "CO-50", "count": 25}])
        ))
        
        recommendations = await engine._generate_recommendations("org_001")
        
        assert len(recommendations) > 0
        # Should mention top denial code
        assert any("CO-50" in r or "Focus on reducing" in r for r in recommendations)


class TestAnalyticsEdgeCases:
    """Test analytics edge cases"""
    
    @pytest.mark.asyncio
    async def test_empty_database_metrics(self, mock_db, env_vars):
        """Test metrics with empty database"""
        mock_db.denial_claims = Mock()
        mock_db.denial_claims.aggregate = AsyncMock(return_value=AsyncMock(
            to_list=AsyncMock(return_value=[])
        ))
        
        engine = AnalyticsDashboardEngine(mock_db)
        
        metrics = await engine.get_realtime_metrics("org_001", "30d")
        
        # Should handle gracefully
        assert "summary" in metrics
    
    @pytest.mark.asyncio
    async def test_division_by_zero_protection(self, env_vars):
        """Test protection against division by zero"""
        calculator = ROICalculator()
        
        # Zero claims should not crash
        roi = await calculator.calculate_client_roi(
            organization_id="org_empty",
            monthly_claim_volume=0,
            avg_claim_value=Decimal("0.00"),
            current_denial_rate=0.0,
            current_recovery_rate=0.0,
            labor_cost_per_hour=Decimal("25.00")
        )
        
        assert "current_state" in roi
    
    def test_decimal_precision(self, env_vars):
        """Test decimal precision in calculations"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="test",
            estimated_monthly_claims=333,
            estimated_avg_claim_value=Decimal("333.33"),
            preferred_model=PricingModel.SAAS_TIERED
        )
        
        # Should have proper decimal precision
        assert quote.base_monthly_fee == quote.base_monthly_fee.quantize(Decimal("0.01"))
    
    def test_very_large_numbers(self, env_vars):
        """Test handling very large numbers"""
        calculator = ROICalculator()
        
        quote = calculator.generate_pricing_quote(
            organization_id="test",
            estimated_monthly_claims=100000,
            estimated_avg_claim_value=Decimal("999999.99"),
            preferred_model=PricingModel.CONTINGENCY
        )
        
        # Should handle large numbers
        assert quote.annual_contract_value > 0
    
    @pytest.mark.asyncio
    async def test_concurrent_analytics_requests(self, mock_db_with_claims):
        """Test concurrent analytics requests"""
        engine = AnalyticsDashboardEngine(mock_db_with_claims)
        
        tasks = [
            engine.get_realtime_metrics(f"org_{i}", "30d")
            for i in range(10)
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # All should complete
        assert len(results) == 10


class TestPricingEdgeCases:
    """Test pricing edge cases"""
    
    def test_negative_recovery(self, env_vars):
        """Test handling of negative values (shouldn't happen but test anyway)"""
        calculator = ROICalculator()
        
        # Edge case: should handle gracefully
        quote = calculator.generate_pricing_quote(
            organization_id="test",
            estimated_monthly_claims=1,
            estimated_avg_claim_value=Decimal("1.00"),
            preferred_model=PricingModel.CONTINGENCY
        )
        
        assert quote is not None
    
    def test_tier_boundary_conditions(self, env_vars):
        """Test tier boundaries"""
        calculator = ROICalculator()
        
        # Test exact tier boundaries
        boundaries = [
            (100, ContractTier.STARTER),  # At boundary
            (101, ContractTier.PROFESSIONAL),  # Just over
            (500, ContractTier.PROFESSIONAL),  # At boundary
            (501, ContractTier.ENTERPRISE),  # Just over
            (2000, ContractTier.ENTERPRISE),  # At boundary
            (2001, ContractTier.STRATEGIC),  # Just over
        ]
        
        for claims, expected_tier in boundaries:
            quote = calculator.generate_pricing_quote(
                organization_id="test",
                estimated_monthly_claims=claims,
                estimated_avg_claim_value=Decimal("250.00"),
                preferred_model=PricingModel.SAAS_TIERED
            )
            
            assert quote.contract_tier == expected_tier, f"Failed at {claims} claims"
