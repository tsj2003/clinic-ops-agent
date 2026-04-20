"""
ML Model Retraining Pipeline
Automated continuous learning for denial prediction, risk scoring, and payer behavior
"""

import asyncio
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
import json
import pickle
import hashlib
from pathlib import Path
import logging

# ML libraries
from sklearn.model_selection import train_test_split, cross_val_score, GridSearchCV
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report
)
from sklearn.preprocessing import StandardScaler, LabelEncoder
import joblib

# For deep learning (optional)
try:
    import tensorflow as tf
    from tensorflow import keras
    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False


class ModelType(str, Enum):
    """Types of ML models in the system"""
    DENIAL_PREDICTION = "denial_prediction"
    RISK_SCORING = "risk_scoring"
    PAYER_BEHAVIOR = "payer_behavior"
    APPEAL_SUCCESS = "appeal_success"
    CLAIM_COMPLEXITY = "claim_complexity"
    FRAUD_DETECTION = "fraud_detection"


class ModelStatus(str, Enum):
    """Model lifecycle status"""
    TRAINING = "training"
    VALIDATING = "validating"
    DEPLOYED = "deployed"
    FAILED = "failed"
    DEPRECATED = "deprecated"


@dataclass
class ModelPerformance:
    """Model performance metrics"""
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    roc_auc: float
    training_samples: int
    validation_samples: int
    training_duration_seconds: float
    feature_importance: Dict[str, float]
    confusion_matrix: List[List[int]]


@dataclass
class ModelVersion:
    """Model version metadata"""
    model_id: str
    version: str
    model_type: ModelType
    created_at: datetime
    status: ModelStatus
    performance: ModelPerformance
    features_used: List[str]
    hyperparameters: Dict[str, Any]
    model_hash: str
    training_data_range: Tuple[datetime, datetime]
    deployed_at: Optional[datetime] = None


class TrainingConfig(BaseModel):
    """Configuration for model training"""
    model_type: ModelType
    training_window_days: int = Field(default=90, ge=30, le=365)
    min_training_samples: int = Field(default=1000, ge=100)
    test_size: float = Field(default=0.2, ge=0.1, le=0.4)
    cross_validation_folds: int = Field(default=5, ge=3, le=10)
    
    # Hyperparameter search
    enable_hyperparameter_tuning: bool = True
    param_grid: Optional[Dict[str, List[Any]]] = None
    
    # Performance thresholds
    min_accuracy: float = Field(default=0.85, ge=0.5, le=0.99)
    min_f1_score: float = Field(default=0.80, ge=0.5, le=0.99)
    
    # Feature engineering
    feature_selection_method: str = Field(default="importance", 
                                          pattern="^(importance|correlation|all)$")
    max_features: int = Field(default=50, ge=10, le=200)
    
    # Deployment
    auto_deploy: bool = False
    require_manual_approval: bool = True
    
    class Config:
        json_schema_extra = {
            "example": {
                "model_type": "denial_prediction",
                "training_window_days": 90,
                "min_training_samples": 1000,
                "min_accuracy": 0.85,
                "auto_deploy": False
            }
        }


class ModelRegistry:
    """
    Model registry for versioning and management
    Stores model artifacts, metadata, and performance history
    """
    
    def __init__(self, storage_path: str = "models/"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.storage_path / "registry.json"
        self._load_registry()
    
    def _load_registry(self):
        """Load model registry from disk"""
        if self.metadata_file.exists():
            with open(self.metadata_file, 'r') as f:
                self.registry = json.load(f)
        else:
            self.registry = {"models": [], "active_models": {}}
    
    def _save_registry(self):
        """Save registry to disk"""
        with open(self.metadata_file, 'w') as f:
            json.dump(self.registry, f, indent=2, default=str)
    
    def register_model(self, model_version: ModelVersion) -> str:
        """Register a new model version"""
        model_entry = {
            "model_id": model_version.model_id,
            "version": model_version.version,
            "model_type": model_version.model_type.value,
            "created_at": model_version.created_at.isoformat(),
            "status": model_version.status.value,
            "performance": {
                "accuracy": model_version.performance.accuracy,
                "precision": model_version.performance.precision,
                "recall": model_version.performance.recall,
                "f1_score": model_version.performance.f1_score,
                "roc_auc": model_version.performance.roc_auc,
                "training_samples": model_version.performance.training_samples,
                "validation_samples": model_version.performance.validation_samples
            },
            "features_used": model_version.features_used,
            "hyperparameters": model_version.hyperparameters,
            "model_hash": model_version.model_hash,
            "training_data_range": [
                model_version.training_data_range[0].isoformat(),
                model_version.training_data_range[1].isoformat()
            ]
        }
        
        self.registry["models"].append(model_entry)
        self._save_registry()
        
        return model_version.model_id
    
    def get_active_model(self, model_type: ModelType) -> Optional[Dict]:
        """Get currently deployed model for a type"""
        model_type_str = model_type.value
        if model_type_str in self.registry["active_models"]:
            model_id = self.registry["active_models"][model_type_str]
            return self.get_model_by_id(model_id)
        return None
    
    def get_model_by_id(self, model_id: str) -> Optional[Dict]:
        """Get model by ID"""
        for model in self.registry["models"]:
            if model["model_id"] == model_id:
                return model
        return None
    
    def deploy_model(self, model_id: str) -> bool:
        """Deploy model to production"""
        model = self.get_model_by_id(model_id)
        if not model:
            return False
        
        model_type = model["model_type"]
        
        # Update previous active model to deprecated
        if model_type in self.registry["active_models"]:
            old_model_id = self.registry["active_models"][model_type]
            for m in self.registry["models"]:
                if m["model_id"] == old_model_id:
                    m["status"] = "deprecated"
        
        # Set new active model
        self.registry["active_models"][model_type] = model_id
        
        # Update model status
        for m in self.registry["models"]:
            if m["model_id"] == model_id:
                m["status"] = "deployed"
                m["deployed_at"] = datetime.utcnow().isoformat()
        
        self._save_registry()
        return True
    
    def list_models(
        self,
        model_type: Optional[ModelType] = None,
        status: Optional[ModelStatus] = None
    ) -> List[Dict]:
        """List models with optional filtering"""
        results = self.registry["models"]
        
        if model_type:
            results = [m for m in results if m["model_type"] == model_type.value]
        
        if status:
            results = [m for m in results if m["status"] == status.value]
        
        return results
    
    def save_model_artifact(
        self,
        model_id: str,
        model: Any,
        scaler: Optional[Any] = None,
        encoders: Optional[Dict] = None
    ):
        """Save model artifact to disk"""
        model_dir = self.storage_path / model_id
        model_dir.mkdir(parents=True, exist_ok=True)
        
        # Save model
        joblib.dump(model, model_dir / "model.pkl")
        
        # Save scaler if provided
        if scaler:
            joblib.dump(scaler, model_dir / "scaler.pkl")
        
        # Save encoders if provided
        if encoders:
            joblib.dump(encoders, model_dir / "encoders.pkl")
        
        # Calculate hash
        model_bytes = joblib.dumps(model)
        model_hash = hashlib.sha256(model_bytes).hexdigest()[:16]
        
        return model_hash
    
    def load_model_artifact(self, model_id: str) -> Dict[str, Any]:
        """Load model artifact from disk"""
        model_dir = self.storage_path / model_id
        
        artifacts = {}
        
        if (model_dir / "model.pkl").exists():
            artifacts["model"] = joblib.load(model_dir / "model.pkl")
        
        if (model_dir / "scaler.pkl").exists():
            artifacts["scaler"] = joblib.load(model_dir / "scaler.pkl")
        
        if (model_dir / "encoders.pkl").exists():
            artifacts["encoders"] = joblib.load(model_dir / "encoders.pkl")
        
        return artifacts


class DataCollector:
    """
    Data collection and feature engineering
    Gathers training data from MongoDB and prepares features
    """
    
    def __init__(self, db_connection=None):
        self.db = db_connection
        self.logger = logging.getLogger(__name__)
    
    async def collect_claim_data(
        self,
        start_date: datetime,
        end_date: datetime,
        include_outcomes: bool = True
    ) -> pd.DataFrame:
        """
        Collect claim data for training
        
        Returns DataFrame with features and outcomes
        """
        # In production, query MongoDB
        # For now, generate synthetic data structure
        
        # Features to collect:
        # - Patient demographics
        # - Procedure codes
        # - Diagnosis codes
        # - Provider NPI
        # - Payer ID
        # - Place of service
        # - Claim amount
        # - Modifier codes
        # - Service dates
        # - Prior auth status
        # - Historical denial patterns
        
        data = {
            'claim_id': [],
            'patient_age': [],
            'patient_gender': [],
            'procedure_code': [],
            'diagnosis_primary': [],
            'diagnosis_count': [],
            'provider_npi': [],
            'payer_id': [],
            'place_of_service': [],
            'claim_amount': [],
            'modifier_count': [],
            'has_prior_auth': [],
            'days_since_service': [],
            'provider_denial_rate': [],
            'payer_denial_rate': [],
            'procedure_denial_rate': [],
        }
        
        if include_outcomes:
            data['denied'] = []
            data['denial_reason'] = []
            data['appeal_success'] = []
        
        return pd.DataFrame(data)
    
    async def collect_payer_behavior_data(
        self,
        payer_id: str,
        lookback_days: int = 180
    ) -> pd.DataFrame:
        """Collect payer behavior patterns"""
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=lookback_days)
        
        # Collect:
        # - Approval rates by procedure
        # - Average processing time
        # - Denial patterns
        # - Downcoding frequency
        # - Bundling behavior
        
        return pd.DataFrame()
    
    def engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Feature engineering pipeline
        
        Creates derived features from raw data
        """
        df = df.copy()
        
        # Numeric features
        df['claim_amount_log'] = np.log1p(df['claim_amount'])
        df['diagnosis_code_complexity'] = df['diagnosis_count'] * df['modifier_count']
        
        # Categorical encoding
        categorical_cols = ['procedure_code', 'payer_id', 'place_of_service']
        for col in categorical_cols:
            if col in df.columns:
                df[f'{col}_encoded'] = pd.Categorical(df[col]).codes
        
        # Time-based features
        df['day_of_week'] = pd.to_datetime(df['service_date']).dt.dayofweek
        df['month'] = pd.to_datetime(df['service_date']).dt.month
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
        
        # Interaction features
        df['amount_per_diagnosis'] = df['claim_amount'] / (df['diagnosis_count'] + 1)
        
        return df
    
    def prepare_training_data(
        self,
        df: pd.DataFrame,
        target_column: str,
        test_size: float = 0.2
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, List[str]]:
        """
        Prepare data for training
        
        Returns: X_train, X_test, y_train, y_test, feature_names
        """
        # Select features (exclude ID columns and target)
        exclude_cols = ['claim_id', 'patient_id', target_column, 'denial_reason']
        feature_cols = [c for c in df.columns if c not in exclude_cols]
        
        X = df[feature_cols].values
        y = df[target_column].values
        
        # Handle missing values
        X = np.nan_to_num(X, nan=0.0)
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42, stratify=y
        )
        
        return X_train, X_test, y_train, y_test, feature_cols


class ModelTrainer:
    """
    ML model training pipeline
    Handles training, validation, and hyperparameter optimization
    """
    
    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self.logger = logging.getLogger(__name__)
    
    async def train_denial_prediction_model(
        self,
        config: TrainingConfig,
        training_data: pd.DataFrame
    ) -> ModelVersion:
        """
        Train denial prediction model
        
        Binary classification: claim will be denied (yes/no)
        """
        start_time = datetime.utcnow()
        
        # Prepare data
        collector = DataCollector()
        df = collector.engineer_features(training_data)
        
        X_train, X_test, y_train, y_test, features = collector.prepare_training_data(
            df, 'denied', config.test_size
        )
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Model selection
        if config.enable_hyperparameter_tuning and config.param_grid:
            model = self._hyperparameter_search(
                GradientBoostingClassifier(random_state=42),
                config.param_grid,
                X_train_scaled, y_train
            )
        else:
            model = GradientBoostingClassifier(
                n_estimators=200,
                max_depth=6,
                learning_rate=0.1,
                random_state=42
            )
        
        # Train model
        model.fit(X_train_scaled, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test_scaled)
        y_pred_proba = model.predict_proba(X_test_scaled)[:, 1]
        
        performance = ModelPerformance(
            accuracy=accuracy_score(y_test, y_pred),
            precision=precision_score(y_test, y_pred, zero_division=0),
            recall=recall_score(y_test, y_pred, zero_division=0),
            f1_score=f1_score(y_test, y_pred, zero_division=0),
            roc_auc=roc_auc_score(y_test, y_pred_proba),
            training_samples=len(X_train),
            validation_samples=len(X_test),
            training_duration_seconds=(datetime.utcnow() - start_time).total_seconds(),
            feature_importance=dict(zip(features, model.feature_importances_)),
            confusion_matrix=confusion_matrix(y_test, y_pred).tolist()
        )
        
        # Save model
        model_id = f"denial_pred_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        model_hash = self.registry.save_model_artifact(
            model_id, model, scaler
        )
        
        # Create version
        model_version = ModelVersion(
            model_id=model_id,
            version="1.0.0",
            model_type=ModelType.DENIAL_PREDICTION,
            created_at=datetime.utcnow(),
            status=ModelStatus.VALIDATING if self._meets_thresholds(performance, config) else ModelStatus.FAILED,
            performance=performance,
            features_used=features,
            hyperparameters=model.get_params(),
            model_hash=model_hash,
            training_data_range=(
                training_data['service_date'].min(),
                training_data['service_date'].max()
            ) if 'service_date' in training_data.columns else (datetime.utcnow(), datetime.utcnow())
        )
        
        # Register
        self.registry.register_model(model_version)
        
        # Auto-deploy if enabled and thresholds met
        if config.auto_deploy and model_version.status == ModelStatus.VALIDATING:
            self.registry.deploy_model(model_id)
            model_version.status = ModelStatus.DEPLOYED
            model_version.deployed_at = datetime.utcnow()
        
        return model_version
    
    async def train_risk_scoring_model(
        self,
        config: TrainingConfig,
        training_data: pd.DataFrame
    ) -> ModelVersion:
        """Train claim risk scoring model (0-1 continuous)"""
        # Similar structure to denial prediction
        # But for regression instead of classification
        pass
    
    def _hyperparameter_search(
        self,
        model: Any,
        param_grid: Dict[str, List[Any]],
        X: np.ndarray,
        y: np.ndarray
    ) -> Any:
        """Perform grid search for hyperparameter optimization"""
        grid_search = GridSearchCV(
            model,
            param_grid,
            cv=5,
            scoring='f1_weighted',
            n_jobs=-1
        )
        grid_search.fit(X, y)
        return grid_search.best_estimator_
    
    def _meets_thresholds(
        self,
        performance: ModelPerformance,
        config: TrainingConfig
    ) -> bool:
        """Check if model meets performance thresholds"""
        return (
            performance.accuracy >= config.min_accuracy and
            performance.f1_score >= config.min_f1_score
        )


class RetrainingScheduler:
    """
    Automated model retraining scheduler
    Monitors model performance and triggers retraining when needed
    """
    
    def __init__(
        self,
        registry: ModelRegistry,
        trainer: ModelTrainer,
        data_collector: DataCollector
    ):
        self.registry = registry
        self.trainer = trainer
        self.data_collector = data_collector
        self.logger = logging.getLogger(__name__)
        
        # Retraining triggers
        self.performance_decay_threshold = 0.05  # 5% accuracy drop
        self.min_days_between_retraining = 7
        self.max_model_age_days = 30
    
    async def check_model_health(self, model_type: ModelType) -> Dict[str, Any]:
        """Check if active model needs retraining"""
        active_model = self.registry.get_active_model(model_type)
        
        if not active_model:
            return {"needs_retraining": True, "reason": "No active model"}
        
        checks = {
            "model_id": active_model["model_id"],
            "created_at": active_model["created_at"],
            "current_accuracy": active_model["performance"]["accuracy"],
            "needs_retraining": False,
            "reasons": []
        }
        
        # Check model age
        created = datetime.fromisoformat(active_model["created_at"])
        age_days = (datetime.utcnow() - created).days
        
        if age_days > self.max_model_age_days:
            checks["needs_retraining"] = True
            checks["reasons"].append(f"Model is {age_days} days old (max: {self.max_model_age_days})")
        
        # Check for performance decay (would need production monitoring data)
        # This is a placeholder for actual drift detection
        
        return checks
    
    async def schedule_retraining(
        self,
        model_type: ModelType,
        config: TrainingConfig
    ) -> Optional[ModelVersion]:
        """
        Schedule and execute model retraining
        
        Returns new model version if successful
        """
        self.logger.info(f"Starting retraining for {model_type.value}")
        
        try:
            # Collect training data
            end_date = datetime.utcnow()
            start_date = end_date - timedelta(days=config.training_window_days)
            
            training_data = await self.data_collector.collect_claim_data(
                start_date, end_date
            )
            
            # Check minimum samples
            if len(training_data) < config.min_training_samples:
                self.logger.warning(
                    f"Insufficient training data: {len(training_data)} < {config.min_training_samples}"
                )
                return None
            
            # Train model
            if model_type == ModelType.DENIAL_PREDICTION:
                new_model = await self.trainer.train_denial_prediction_model(
                    config, training_data
                )
            elif model_type == ModelType.RISK_SCORING:
                new_model = await self.trainer.train_risk_scoring_model(
                    config, training_data
                )
            else:
                self.logger.error(f"Unsupported model type: {model_type}")
                return None
            
            self.logger.info(
                f"Retraining complete. Model {new_model.model_id} "
                f"accuracy: {new_model.performance.accuracy:.3f}"
            )
            
            return new_model
            
        except Exception as e:
            self.logger.error(f"Retraining failed: {e}")
            return None
    
    async def run_scheduled_checks(self):
        """Run all scheduled health checks and retraining"""
        model_types = [
            ModelType.DENIAL_PREDICTION,
            ModelType.RISK_SCORING,
            ModelType.PAYER_BEHAVIOR
        ]
        
        results = []
        for model_type in model_types:
            health = await self.check_model_health(model_type)
            
            if health["needs_retraining"]:
                config = TrainingConfig(
                    model_type=model_type,
                    training_window_days=90,
                    auto_deploy=False  # Require manual approval
                )
                
                new_model = await self.schedule_retraining(model_type, config)
                results.append({
                    "model_type": model_type.value,
                    "retrained": new_model is not None,
                    "model_id": new_model.model_id if new_model else None
                })
            else:
                results.append({
                    "model_type": model_type.value,
                    "retrained": False,
                    "reason": "Model healthy"
                })
        
        return results


class PredictionService:
    """
    Real-time prediction service using deployed models
    """
    
    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self.models_cache: Dict[str, Any] = {}
    
    def _load_model(self, model_type: ModelType) -> Optional[Dict]:
        """Load model from cache or disk"""
        model_type_str = model_type.value
        
        if model_type_str in self.models_cache:
            return self.models_cache[model_type_str]
        
        active_model = self.registry.get_active_model(model_type)
        if not active_model:
            return None
        
        artifacts = self.registry.load_model_artifact(active_model["model_id"])
        self.models_cache[model_type_str] = artifacts
        
        return artifacts
    
    def predict_denial(
        self,
        claim_features: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Predict if claim will be denied
        
        Returns probability and risk factors
        """
        artifacts = self._load_model(ModelType.DENIAL_PREDICTION)
        if not artifacts:
            return {"error": "No active denial prediction model"}
        
        model = artifacts["model"]
        scaler = artifacts.get("scaler")
        
        # Convert features to array
        feature_vector = self._features_to_vector(claim_features)
        
        if scaler:
            feature_vector = scaler.transform([feature_vector])[0]
        
        # Predict
        probability = model.predict_proba([feature_vector])[0][1]
        prediction = probability > 0.5
        
        # Get top risk factors
        feature_importance = dict(zip(
            claim_features.keys(),
            model.feature_importances_
        ))
        top_risks = sorted(
            feature_importance.items(),
            key=lambda x: x[1],
            reverse=True
        )[:5]
        
        return {
            "will_be_denied": bool(prediction),
            "denial_probability": float(probability),
            "confidence": abs(probability - 0.5) * 2,  # 0-1 scale
            "risk_factors": [
                {"feature": f, "importance": imp}
                for f, imp in top_risks
            ],
            "model_id": self.registry.get_active_model(ModelType.DENIAL_PREDICTION)["model_id"]
        }
    
    def _features_to_vector(self, features: Dict[str, Any]) -> np.ndarray:
        """Convert feature dict to numpy array"""
        # Simplified - in production, use same feature order as training
        return np.array(list(features.values()))


# ==================== API ENDPOINTS ====================

async def trigger_retraining(
    model_type: ModelType,
    config: TrainingConfig
) -> Dict[str, Any]:
    """API endpoint to trigger manual retraining"""
    registry = ModelRegistry()
    trainer = ModelTrainer(registry)
    collector = DataCollector()
    
    scheduler = RetrainingScheduler(registry, trainer, collector)
    
    new_model = await scheduler.schedule_retraining(model_type, config)
    
    if new_model:
        return {
            "success": True,
            "model_id": new_model.model_id,
            "performance": {
                "accuracy": new_model.performance.accuracy,
                "f1_score": new_model.performance.f1_score
            },
            "status": new_model.status.value
        }
    else:
        return {"success": False, "error": "Retraining failed"}


async def get_model_performance(model_type: ModelType) -> Dict[str, Any]:
    """Get performance metrics for active model"""
    registry = ModelRegistry()
    model = registry.get_active_model(model_type)
    
    if not model:
        return {"error": "No active model"}
    
    return {
        "model_id": model["model_id"],
        "created_at": model["created_at"],
        "performance": model["performance"],
        "features_used": len(model["features_used"]),
        "hyperparameters": model["hyperparameters"]
    }
