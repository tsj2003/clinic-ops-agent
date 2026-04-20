"""
Vertical AI Moat - Domain-Specific Clinical Safeguards
Prevents hallucinations in high-stakes healthcare environments
"""

import os
import json
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
from datetime import datetime
import aiohttp


class ValidationSeverity(str, Enum):
    """Validation severity levels"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


@dataclass
class ValidationResult:
    """Clinical validation result"""
    is_valid: bool
    severity: ValidationSeverity
    field: str
    message: str
    suggested_correction: Optional[str]
    confidence: float
    regulation_reference: Optional[str]


class MedicalCodingValidator:
    """
    Validates medical codes against official code sets
    Prevents hallucinated or invalid codes
    """
    
    # Official code patterns
    CPT_PATTERN = re.compile(r'^\d{5}$')
    ICD10_PATTERN = re.compile(r'^[A-Z]\d{2}(\.\d{1,2})?$')
    HCPCS_PATTERN = re.compile(r'^[A-Z]\d{4}$')
    MODIFIER_PATTERN = re.compile(r'^[A-Z0-9]{2}$')
    
    # Common invalid/hallucinated codes to block
    INVALID_CPT_CODES = {
        '99999', '00000', '12345', '11111', '00001'
    }
    
    def __init__(self):
        self.cpt_database: Dict[str, Dict] = {}
        self.icd10_database: Dict[str, Dict] = {}
        self._load_official_codes()
    
    def _load_official_codes(self):
        """Load official medical code databases"""
        # In production, load from official CMS/AMA files
        # For now, use common valid codes
        self.cpt_database = {
            "99213": {"description": "Office visit, established patient", "category": "E/M"},
            "99214": {"description": "Office visit, established patient", "category": "E/M"},
            "99285": {"description": "Emergency dept visit", "category": "E/M"},
            "36415": {"description": "Venipuncture", "category": "Procedure"},
            "80053": {"description": "Comprehensive metabolic panel", "category": "Lab"},
            "71020": {"description": "Chest X-ray", "category": "Radiology"},
        }
        
        self.icd10_database = {
            "J44.1": {"description": "COPD with acute exacerbation", "category": "Respiratory"},
            "E11.9": {"description": "Type 2 diabetes without complications", "category": "Endocrine"},
            "I10": {"description": "Essential hypertension", "category": "Circulatory"},
            "M79.1": {"description": "Myalgia", "category": "Musculoskeletal"},
            "K21.9": {"description": "GERD without esophagitis", "category": "Digestive"},
        }
    
    def validate_cpt_code(self, code: str) -> ValidationResult:
        """Validate CPT procedure code"""
        # Check format
        if not self.CPT_PATTERN.match(code):
            return ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.ERROR,
                field="cpt_code",
                message=f"Invalid CPT format: {code}",
                suggested_correction=None,
                confidence=1.0,
                regulation_reference="AMA CPT Guidelines"
            )
        
        # Check against known invalid codes
        if code in self.INVALID_CPT_CODES:
            return ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.CRITICAL,
                field="cpt_code",
                message=f"Known invalid/hallucinated CPT code: {code}",
                suggested_correction="Review official AMA CPT manual",
                confidence=1.0,
                regulation_reference="AMA CPT Manual"
            )
        
        # Check if in database (for production, use full AMA database)
        if code not in self.cpt_database:
            return ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.WARNING,
                field="cpt_code",
                message=f"CPT code not found in database: {code}",
                suggested_correction="Verify code or check for typos",
                confidence=0.7,
                regulation_reference="AMA CPT Database"
            )
        
        return ValidationResult(
            is_valid=True,
            severity=ValidationSeverity.INFO,
            field="cpt_code",
            message=f"Valid CPT: {self.cpt_database[code]['description']}",
            suggested_correction=None,
            confidence=0.95,
            regulation_reference=None
        )
    
    def validate_icd10_code(self, code: str) -> ValidationResult:
        """Validate ICD-10 diagnosis code"""
        if not self.ICD10_PATTERN.match(code):
            return ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.ERROR,
                field="icd10_code",
                message=f"Invalid ICD-10 format: {code}",
                suggested_correction=None,
                confidence=1.0,
                regulation_reference="ICD-10-CM Official Guidelines"
            )
        
        if code not in self.icd10_database:
            return ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.WARNING,
                field="icd10_code",
                message=f"ICD-10 code not found: {code}",
                suggested_correction="Verify against ICD-10-CM manual",
                confidence=0.7,
                regulation_reference="CMS ICD-10-CM"
            )
        
        return ValidationResult(
            is_valid=True,
            severity=ValidationSeverity.INFO,
            field="icd10_code",
            message=f"Valid ICD-10: {self.icd10_database[code]['description']}",
            suggested_correction=None,
            confidence=0.95,
            regulation_reference=None
        )
    
    def validate_code_combination(
        self,
        cpt_code: str,
        icd10_codes: List[str]
    ) -> List[ValidationResult]:
        """Validate if CPT and ICD-10 codes are medically compatible"""
        results = []
        
        # Validate individual codes
        results.append(self.validate_cpt_code(cpt_code))
        for icd10 in icd10_codes:
            results.append(self.validate_icd10_code(icd10))
        
        # Check for obvious mismatches
        if cpt_code in self.cpt_database:
            cpt_category = self.cpt_database[cpt_code].get("category")
            
            for icd10 in icd10_codes:
                if icd10 in self.icd10_database:
                    icd_category = self.icd10_database[icd10].get("category")
                    
                    # Flag potential mismatches (simplified rules)
                    mismatches = [
                        ("Radiology", "Mental", "Radiology codes with psychiatric diagnoses"),
                        ("Lab", "Injury", "Lab codes with injury diagnoses - verify medical necessity"),
                    ]
                    
                    for cpt_cat, icd_cat, msg in mismatches:
                        if cpt_category == cpt_cat and icd_category == icd_cat:
                            results.append(ValidationResult(
                                is_valid=False,
                                severity=ValidationSeverity.WARNING,
                                field="code_combination",
                                message=msg,
                                suggested_correction="Verify clinical documentation supports this combination",
                                confidence=0.6,
                                regulation_reference="Medical Necessity Guidelines"
                            ))
        
        return results


class ClinicalContextValidator:
    """
    Validates clinical context against established medical knowledge
    Prevents medically implausible combinations
    """
    
    def __init__(self):
        self.clinical_rules = self._load_clinical_rules()
    
    def _load_clinical_rules(self) -> List[Dict]:
        """Load clinical validation rules"""
        return [
            {
                "name": "Age-Procedure Compatibility",
                "check": lambda patient_age, procedure: self._check_age_procedure(patient_age, procedure),
                "severity": ValidationSeverity.ERROR
            },
            {
                "name": "Gender-Procedure Compatibility",
                "check": lambda patient_gender, procedure: self._check_gender_procedure(patient_gender, procedure),
                "severity": ValidationSeverity.ERROR
            },
            {
                "name": "Medication-Diagnosis Match",
                "check": lambda medications, diagnosis: self._check_medication_diagnosis(medications, diagnosis),
                "severity": ValidationSeverity.WARNING
            },
            {
                "name": "Duplicate Procedure Check",
                "check": lambda procedures, timeframe: self._check_duplicate_procedures(procedures, timeframe),
                "severity": ValidationSeverity.WARNING
            }
        ]
    
    def _check_age_procedure(self, age: int, procedure: str) -> Tuple[bool, str]:
        """Check if procedure is appropriate for patient age"""
        # Example rules
        if "neonatal" in procedure.lower() and age > 1:
            return False, "Neonatal procedures not appropriate for patients > 1 year"
        
        if "prostate" in procedure.lower() and age < 40:
            return False, "Prostate procedures uncommon in patients < 40 years"
        
        return True, ""
    
    def _check_gender_procedure(self, gender: str, procedure: str) -> Tuple[bool, str]:
        """Check if procedure matches patient gender"""
        gender_specific = {
            "hysterectomy": ["female"],
            "prostatectomy": ["male"],
            "mammography": ["female"],  # Though males can have mammograms too
            "vasectomy": ["male"],
        }
        
        proc_lower = procedure.lower()
        for proc_key, allowed_genders in gender_specific.items():
            if proc_key in proc_lower:
                if gender.lower() not in allowed_genders:
                    return False, f"{procedure} typically for {allowed_genders} patients only"
        
        return True, ""
    
    def _check_medication_diagnosis(
        self,
        medications: List[str],
        diagnosis: str
    ) -> Tuple[bool, str]:
        """Check if medications are appropriate for diagnosis"""
        # Simplified example
        inappropriate = [
            ("insulin", "hypertension", "Insulin is for diabetes, not hypertension"),
            ("antibiotics", "viral infection", "Antibiotics don't treat viral infections"),
        ]
        
        for med, diag, reason in inappropriate:
            if med.lower() in [m.lower() for m in medications]:
                if diag.lower() in diagnosis.lower():
                    return False, reason
        
        return True, ""
    
    def _check_duplicate_procedures(
        self,
        procedures: List[str],
        timeframe_days: int
    ) -> Tuple[bool, str]:
        """Check for duplicate procedures in timeframe"""
        if len(procedures) != len(set(procedures)):
            return False, "Duplicate procedures detected - verify medical necessity"
        
        return True, ""
    
    def validate_clinical_context(
        self,
        patient_data: Dict[str, Any],
        procedures: List[str],
        diagnosis: str,
        medications: Optional[List[str]] = None
    ) -> List[ValidationResult]:
        """Validate full clinical context"""
        results = []
        
        age = patient_data.get("age", 0)
        gender = patient_data.get("gender", "")
        
        # Check each procedure
        for procedure in procedures:
            # Age check
            valid, msg = self._check_age_procedure(age, procedure)
            if not valid:
                results.append(ValidationResult(
                    is_valid=False,
                    severity=ValidationSeverity.ERROR,
                    field="procedure_age",
                    message=msg,
                    suggested_correction="Verify procedure code or patient demographics",
                    confidence=0.9,
                    regulation_reference="Clinical Practice Guidelines"
                ))
            
            # Gender check
            valid, msg = self._check_gender_procedure(gender, procedure)
            if not valid:
                results.append(ValidationResult(
                    is_valid=False,
                    severity=ValidationSeverity.ERROR,
                    field="procedure_gender",
                    message=msg,
                    suggested_correction="Verify patient gender or procedure code",
                    confidence=0.95,
                    regulation_reference="Clinical Guidelines"
                ))
        
        # Medication check
        if medications:
            valid, msg = self._check_medication_diagnosis(medications, diagnosis)
            if not valid:
                results.append(ValidationResult(
                    is_valid=False,
                    severity=ValidationSeverity.WARNING,
                    field="medication_diagnosis",
                    message=msg,
                    suggested_correction="Review medication appropriateness",
                    confidence=0.8,
                    regulation_reference="Pharmaceutical Guidelines"
                ))
        
        return results


class PayerRulesValidator:
    """
    Validates against specific payer rules and policies
    Domain-specific knowledge for each major payer
    """
    
    def __init__(self):
        self.payer_rules = self._load_payer_rules()
    
    def _load_payer_rules(self) -> Dict[str, Dict]:
        """Load payer-specific rules"""
        return {
            "aetna": {
                "name": "Aetna Better Health",
                "pre_auth_required": [
                    "99285",  # ED visits may need auth in some plans
                    "71020",  # X-rays usually don't but some managed plans require
                ],
                "age_restrictions": {
                    "G0101": {"min_age": 40, "gender": "female"},  # Cervical cancer screen
                },
                "frequency_limits": {
                    "80053": {"days": 365, "description": "CMP once per year"},
                    "84443": {"days": 90, "description": "TSH every 90 days max"},
                }
            },
            "uhc": {
                "name": "UnitedHealthcare",
                "pre_auth_required": [
                    "99285",
                    "71020",
                ],
                "modifiers_required": [
                    "25",  # Significant separately identifiable E/M
                ]
            },
            "cigna": {
                "name": "Cigna",
                "pre_auth_required": [
                    "99285",
                ],
            }
        }
    
    def validate_against_payer_rules(
        self,
        payer_id: str,
        cpt_code: str,
        patient_data: Dict,
        last_service_date: Optional[datetime] = None
    ) -> List[ValidationResult]:
        """Validate claim against specific payer rules"""
        results = []
        
        if payer_id not in self.payer_rules:
            return results
        
        rules = self.payer_rules[payer_id]
        
        # Check prior auth requirements
        if cpt_code in rules.get("pre_auth_required", []):
            results.append(ValidationResult(
                is_valid=False,
                severity=ValidationSeverity.WARNING,
                field="prior_authorization",
                message=f"{cpt_code} may require prior authorization for {rules['name']}",
                suggested_correction="Verify prior authorization on file or obtain retroactive auth",
                confidence=0.85,
                regulation_reference=f"{rules['name']} Medical Policy"
            ))
        
        # Check age restrictions
        age_restrictions = rules.get("age_restrictions", {})
        if cpt_code in age_restrictions:
            restriction = age_restrictions[cpt_code]
            patient_age = patient_data.get("age", 0)
            patient_gender = patient_data.get("gender", "")
            
            if "min_age" in restriction and patient_age < restriction["min_age"]:
                results.append(ValidationResult(
                    is_valid=False,
                    severity=ValidationSeverity.ERROR,
                    field="age_restriction",
                    message=f"{cpt_code} restricted to patients {restriction['min_age']}+ for {rules['name']}",
                    suggested_correction="Verify patient age or procedure code",
                    confidence=0.95,
                    regulation_reference=f"{rules['name']} Age Guidelines"
                ))
        
        # Check frequency limits
        frequency_limits = rules.get("frequency_limits", {})
        if cpt_code in frequency_limits and last_service_date:
            limit = frequency_limits[cpt_code]
            days_since = (datetime.utcnow() - last_service_date).days
            
            if days_since < limit["days"]:
                results.append(ValidationResult(
                    is_valid=False,
                    severity=ValidationSeverity.WARNING,
                    field="frequency_limit",
                    message=f"{cpt_code} exceeds frequency limit ({limit['description']})",
                    suggested_correction=f"Wait {limit['days'] - days_since} days or document medical necessity",
                    confidence=0.9,
                    regulation_reference=f"{rules['name']} Frequency Policy"
                ))
        
        return results


class VerticalAIValidator:
    """
    Main validation orchestrator
    Combines all domain-specific validators
    """
    
    def __init__(self):
        self.coding_validator = MedicalCodingValidator()
        self.clinical_validator = ClinicalContextValidator()
        self.payer_validator = PayerRulesValidator()
    
    async def validate_claim_comprehensive(
        self,
        claim_data: Dict[str, Any],
        payer_id: str,
        historical_claims: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        Perform comprehensive domain-specific validation
        Prevents hallucinations and ensures clinical accuracy
        """
        all_results = []
        
        # 1. Validate medical codes
        cpt_code = claim_data.get("procedure_code", "")
        icd10_codes = claim_data.get("diagnosis_codes", [])
        
        code_results = self.coding_validator.validate_code_combination(cpt_code, icd10_codes)
        all_results.extend(code_results)
        
        # 2. Validate clinical context
        patient_data = claim_data.get("patient", {})
        procedures = [cpt_code] if cpt_code else []
        diagnosis = claim_data.get("diagnosis_description", "")
        
        clinical_results = self.clinical_validator.validate_clinical_context(
            patient_data=patient_data,
            procedures=procedures,
            diagnosis=diagnosis
        )
        all_results.extend(clinical_results)
        
        # 3. Validate against payer rules
        last_service = None
        if historical_claims:
            # Find last service of same type
            same_procedures = [c for c in historical_claims if c.get("procedure_code") == cpt_code]
            if same_procedures:
                last_service = max(same_procedures, key=lambda x: x.get("service_date", datetime.min))
                if isinstance(last_service, dict):
                    last_service = last_service.get("service_date")
        
        payer_results = self.payer_validator.validate_against_payer_rules(
            payer_id=payer_id,
            cpt_code=cpt_code,
            patient_data=patient_data,
            last_service_date=last_service
        )
        all_results.extend(payer_results)
        
        # 4. Cross-reference with medical literature (RAG)
        literature_results = await self._validate_with_medical_literature(
            cpt_code, icd10_codes, diagnosis
        )
        all_results.extend(literature_results)
        
        # Compile results
        errors = [r for r in all_results if r.severity in (ValidationSeverity.ERROR, ValidationSeverity.CRITICAL)]
        warnings = [r for r in all_results if r.severity == ValidationSeverity.WARNING]
        
        return {
            "is_valid": len(errors) == 0,
            "can_proceed": len([r for r in errors if r.severity == ValidationSeverity.CRITICAL]) == 0,
            "errors": errors,
            "warnings": warnings,
            "all_validations": all_results,
            "validation_timestamp": datetime.utcnow().isoformat(),
            "vertical_ai_score": self._calculate_trust_score(all_results)
        }
    
    async def _validate_with_medical_literature(
        self,
        cpt_code: str,
        icd10_codes: List[str],
        diagnosis: str
    ) -> List[ValidationResult]:
        """
        Query medical literature/RAG for evidence
        Ensures claim is grounded in validated medical knowledge
        """
        results = []
        
        # Query Mixedbread RAG
        mixedbread_key = os.getenv("MIXEDBREAD_API_KEY")
        if mixedbread_key:
            try:
                query = f"Medical necessity {cpt_code} for {diagnosis}"
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        "https://api.mixedbread.ai/v1/rag",
                        headers={"Authorization": f"Bearer {mixedbread_key}"},
                        json={
                            "query": query,
                            "filters": {"document_type": "clinical_guideline"},
                            "top_k": 3
                        }
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            docs = data.get("documents", [])
                            
                            if not docs or all(d.get("score", 0) < 0.5 for d in docs):
                                results.append(ValidationResult(
                                    is_valid=False,
                                    severity=ValidationSeverity.WARNING,
                                    field="medical_literature",
                                    message="Limited evidence found in medical literature for this combination",
                                    suggested_correction="Verify with clinical documentation or consider alternative coding",
                                    confidence=0.6,
                                    regulation_reference="Evidence-Based Medicine"
                                ))
            except Exception:
                pass  # Don't fail validation if RAG is unavailable
        
        return results
    
    def _calculate_trust_score(self, results: List[ValidationResult]) -> float:
        """Calculate overall trust score based on validations"""
        if not results:
            return 1.0
        
        # Weight by severity
        weights = {
            ValidationSeverity.CRITICAL: -1.0,
            ValidationSeverity.ERROR: -0.5,
            ValidationSeverity.WARNING: -0.2,
            ValidationSeverity.INFO: 0.0
        }
        
        score = 1.0
        for result in results:
            if not result.is_valid:
                score += weights.get(result.severity, -0.1)
        
        return max(0.0, min(1.0, score))


# Global instance
vertical_ai_validator = VerticalAIValidator()
