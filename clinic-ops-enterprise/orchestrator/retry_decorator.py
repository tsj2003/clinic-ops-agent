"""
Retry Decorator for Agent Resilience
Implements exponential backoff for Fireworks AI and TinyFish calls
"""

import functools
import asyncio
import logging
from typing import Callable, Any, TypeVar, Optional
from dataclasses import dataclass

# Configure logging
logger = logging.getLogger(__name__)

T = TypeVar('T')


@dataclass
class RetryConfig:
    """Configuration for retry behavior"""
    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 30.0
    exponential_base: float = 2.0
    retryable_exceptions: tuple = (Exception,)


def exponential_backoff_retry(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable_exceptions: Optional[tuple] = None
):
    """
    Decorator that implements exponential backoff retry logic
    
    Args:
        max_attempts: Maximum number of retry attempts (default: 3)
        base_delay: Initial delay between retries in seconds (default: 1.0)
        max_delay: Maximum delay between retries in seconds (default: 30.0)
        retryable_exceptions: Tuple of exceptions to retry on (default: all Exceptions)
    """
    if retryable_exceptions is None:
        retryable_exceptions = (Exception,)
    
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs) -> T:
            last_exception = None
            
            for attempt in range(1, max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if attempt == max_attempts:
                        logger.error(
                            f"{func.__name__} failed after {max_attempts} attempts. "
                            f"Last error: {str(e)}"
                        )
                        raise
                    
                    # Calculate exponential backoff delay
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    
                    logger.warning(
                        f"{func.__name__} attempt {attempt}/{max_attempts} failed: {str(e)}. "
                        f"Retrying in {delay:.1f}s..."
                    )
                    
                    await asyncio.sleep(delay)
            
            # Should never reach here, but just in case
            raise last_exception if last_exception else RuntimeError("Unexpected retry loop exit")
        
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs) -> T:
            raise RuntimeError("Retry decorator only supports async functions")
        
        return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
    
    return decorator


class PartialSuccessResult:
    """Structured result for partial success scenarios"""
    
    def __init__(
        self,
        success: bool,
        completed_steps: list,
        failed_step: Optional[str],
        failed_reason: Optional[str],
        partial_data: Optional[Any] = None
    ):
        self.success = success
        self.completed_steps = completed_steps
        self.failed_step = failed_step
        self.failed_reason = failed_reason
        self.partial_data = partial_data
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization"""
        return {
            "success": self.success,
            "completed_steps": self.completed_steps,
            "failed_step": self.failed_step,
            "failed_reason": self.failed_reason,
            "partial_data": self.partial_data,
            "status": "partial_success" if self.partial_data else "failed"
        }
    
    @classmethod
    def from_exception(
        cls,
        exception: Exception,
        completed_steps: list,
        failed_step: str,
        partial_data: Optional[Any] = None
    ) -> "PartialSuccessResult":
        """Create partial success result from exception"""
        return cls(
            success=False,
            completed_steps=completed_steps,
            failed_step=failed_step,
            failed_reason=str(exception),
            partial_data=partial_data
        )


def with_partial_success_handling(step_name: str):
    """
    Decorator that catches exceptions and returns PartialSuccessResult
    instead of raising 500 errors
    """
    def decorator(func: Callable[..., T]) -> Callable[..., Any]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            try:
                result = await func(*args, **kwargs)
                return result
            except Exception as e:
                logger.error(
                    f"Step '{step_name}' failed in {func.__name__}: {str(e)}",
                    exc_info=True
                )
                
                # Return structured partial success instead of raising
                return PartialSuccessResult.from_exception(
                    exception=e,
                    completed_steps=[],  # Will be populated by caller
                    failed_step=step_name,
                    partial_data=None
                )
        
        return wrapper
    
    return decorator


# Pre-configured decorators for specific services
fireworks_retry = exponential_backoff_retry(
    max_attempts=3,
    base_delay=1.0,
    max_delay=10.0,
    retryable_exceptions=(ConnectionError, TimeoutError, Exception)
)

tinyfish_retry = exponential_backoff_retry(
    max_attempts=3,
    base_delay=2.0,
    max_delay=15.0,
    retryable_exceptions=(ConnectionError, TimeoutError, Exception)
)

clearinghouse_retry = exponential_backoff_retry(
    max_attempts=3,
    base_delay=1.5,
    max_delay=20.0,
    retryable_exceptions=(ConnectionError, TimeoutError)
)
