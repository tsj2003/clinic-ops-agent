"""EHR Integration Module"""

from .epic_integration import epic_manager, EpicIntegrationManager, EpicFHIRClient
from .cerner_integration import cerner_manager, CernerIntegrationManager
from .athena_integration import athena_manager, AthenaIntegrationManager

__all__ = [
    "epic_manager",
    "cerner_manager", 
    "athena_manager",
    "EpicIntegrationManager",
    "CernerIntegrationManager",
    "AthenaIntegrationManager",
    "EpicFHIRClient",
]
