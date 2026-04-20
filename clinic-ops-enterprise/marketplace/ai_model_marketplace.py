"""
Third-Party AI Model Integration Marketplace
Supports multiple AI providers: OpenAI, Anthropic, Google, Cohere, etc.
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Any, AsyncGenerator, Union
from pydantic import BaseModel, Field
from dataclasses import dataclass
from enum import Enum
from abc import ABC, abstractmethod
import json


class AIModelProvider(str, Enum):
    """Supported AI model providers"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    COHERE = "cohere"
    AI21 = "ai21"
    FIREWORKS = "fireworks"
    MISTRAL = "mistral"
    META = "meta"
    STABILITY = "stability"


class ModelCapability(str, Enum):
    """AI model capabilities"""
    TEXT_COMPLETION = "text_completion"
    CHAT = "chat"
    CODE_GENERATION = "code_generation"
    FUNCTION_CALLING = "function_calling"
    EMBEDDINGS = "embeddings"
    IMAGE_GENERATION = "image_generation"
    VISION = "vision"
    AUDIO = "audio"
    FINE_TUNING = "fine_tuning"


class ModelPricing(BaseModel):
    """Model pricing structure"""
    input_price_per_1k: float  # Price per 1000 input tokens
    output_price_per_1k: float  # Price per 1000 output tokens
    context_window: int  # Maximum context window
    training_price_per_1k: Optional[float] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "input_price_per_1k": 0.03,
                "output_price_per_1k": 0.06,
                "context_window": 128000
            }
        }


class AIModelInfo(BaseModel):
    """Information about an AI model"""
    model_id: str
    name: str
    provider: AIModelProvider
    description: str
    capabilities: List[ModelCapability]
    pricing: ModelPricing
    
    # Model characteristics
    supports_streaming: bool = True
    supports_json_mode: bool = False
    supports_tools: bool = False
    supports_vision: bool = False
    
    # Performance metrics
    avg_latency_ms: Optional[int] = None
    rating: float = Field(default=0.0, ge=0.0, le=5.0)
    
    # Status
    is_available: bool = True
    is_deprecated: bool = False
    release_date: Optional[datetime] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "model_id": "gpt-4-turbo",
                "name": "GPT-4 Turbo",
                "provider": "openai",
                "capabilities": ["chat", "function_calling", "vision"],
                "pricing": {
                    "input_price_per_1k": 0.01,
                    "output_price_per_1k": 0.03,
                    "context_window": 128000
                }
            }
        }


# ==================== MODEL INTERFACES ====================

class ChatMessage(BaseModel):
    """Chat message structure"""
    role: str  # system, user, assistant, function
    content: str
    name: Optional[str] = None  # For function messages
    function_call: Optional[Dict] = None


class CompletionRequest(BaseModel):
    """Text completion request"""
    model: str
    prompt: str
    max_tokens: Optional[int] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    n: int = Field(default=1, ge=1, le=10)
    stream: bool = False
    stop: Optional[List[str]] = None
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    

class ChatRequest(BaseModel):
    """Chat completion request"""
    model: str
    messages: List[ChatMessage]
    max_tokens: Optional[int] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    n: int = Field(default=1, ge=1, le=10)
    stream: bool = False
    stop: Optional[List[str]] = None
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    tools: Optional[List[Dict]] = None
    tool_choice: Optional[Union[str, Dict]] = None
    response_format: Optional[Dict] = None  # For JSON mode


class CompletionResponse(BaseModel):
    """Completion response"""
    id: str
    model: str
    choices: List[Dict[str, Any]]
    usage: Dict[str, int]  # prompt_tokens, completion_tokens, total_tokens
    created: datetime
    

class AIProviderInterface(ABC):
    """
    Abstract interface for AI providers
    
    All AI provider adapters must implement this
    """
    
    @abstractmethod
    async def initialize(self, api_key: str, **kwargs) -> bool:
        """Initialize provider with API key"""
        pass
    
    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """Check provider health"""
        pass
    
    @abstractmethod
    async def list_models(self) -> List[AIModelInfo]:
        """List available models"""
        pass
    
    @abstractmethod
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        """Text completion"""
        pass
    
    @abstractmethod
    async def chat(self, request: ChatRequest) -> CompletionResponse:
        """Chat completion"""
        pass
    
    @abstractmethod
    async def stream_chat(
        self,
        request: ChatRequest
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion"""
        pass
    
    @abstractmethod
    async def create_embeddings(
        self,
        texts: List[str],
        model: str
    ) -> List[List[float]]:
        """Create text embeddings"""
        pass
    
    @abstractmethod
    def calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """Calculate API cost in USD"""
        pass


# ==================== PROVIDER ADAPTERS ====================

class OpenAIAdapter(AIProviderInterface):
    """OpenAI API adapter"""
    
    def __init__(self):
        self.client = None
        self.models_info: Dict[str, AIModelInfo] = {}
    
    async def initialize(self, api_key: str, **kwargs) -> bool:
        try:
            import openai
            openai.api_key = api_key
            self.client = openai
            
            # Setup model info
            self.models_info = {
                "gpt-4-turbo": AIModelInfo(
                    model_id="gpt-4-turbo",
                    name="GPT-4 Turbo",
                    provider=AIModelProvider.OPENAI,
                    description="Most capable GPT-4 model",
                    capabilities=[
                        ModelCapability.CHAT,
                        ModelCapability.FUNCTION_CALLING,
                        ModelCapability.VISION
                    ],
                    pricing=ModelPricing(
                        input_price_per_1k=0.01,
                        output_price_per_1k=0.03,
                        context_window=128000
                    ),
                    supports_tools=True,
                    supports_json_mode=True,
                    supports_vision=True
                ),
                "gpt-3.5-turbo": AIModelInfo(
                    model_id="gpt-3.5-turbo",
                    name="GPT-3.5 Turbo",
                    provider=AIModelProvider.OPENAI,
                    description="Fast and efficient",
                    capabilities=[ModelCapability.CHAT, ModelCapability.FUNCTION_CALLING],
                    pricing=ModelPricing(
                        input_price_per_1k=0.0005,
                        output_price_per_1k=0.0015,
                        context_window=16385
                    ),
                    supports_tools=True
                ),
                "text-embedding-3-large": AIModelInfo(
                    model_id="text-embedding-3-large",
                    name="Text Embedding 3 Large",
                    provider=AIModelProvider.OPENAI,
                    description="High performance embeddings",
                    capabilities=[ModelCapability.EMBEDDINGS],
                    pricing=ModelPricing(
                        input_price_per_1k=0.00013,
                        output_price_per_1k=0.0,
                        context_window=8192
                    )
                )
            }
            
            return True
        except Exception as e:
            print(f"Failed to initialize OpenAI: {e}")
            return False
    
    async def health_check(self) -> Dict[str, Any]:
        try:
            # Make a simple API call
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.Model.list()
            )
            return {"status": "healthy", "latency_ms": 100}
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}
    
    async def list_models(self) -> List[AIModelInfo]:
        return list(self.models_info.values())
    
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        # OpenAI has deprecated plain completions, use chat
        chat_request = ChatRequest(
            model=request.model,
            messages=[ChatMessage(role="user", content=request.prompt)],
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            n=request.n,
            stream=False,
            stop=request.stop,
            presence_penalty=request.presence_penalty,
            frequency_penalty=request.frequency_penalty
        )
        return await self.chat(chat_request)
    
    async def chat(self, request: ChatRequest) -> CompletionResponse:
        import openai
        
        messages = [
            {"role": m.role, "content": m.content, **({"name": m.name} if m.name else {})}
            for m in request.messages
        ]
        
        kwargs = {
            "model": request.model,
            "messages": messages,
            "temperature": request.temperature,
            "top_p": request.top_p,
            "n": request.n,
            "stream": False,
            "presence_penalty": request.presence_penalty,
            "frequency_penalty": request.frequency_penalty
        }
        
        if request.max_tokens:
            kwargs["max_tokens"] = request.max_tokens
        if request.stop:
            kwargs["stop"] = request.stop
        if request.tools:
            kwargs["tools"] = request.tools
        if request.tool_choice:
            kwargs["tool_choice"] = request.tool_choice
        if request.response_format:
            kwargs["response_format"] = request.response_format
        
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.client.ChatCompletion.create(**kwargs)
        )
        
        return CompletionResponse(
            id=response["id"],
            model=response["model"],
            choices=[
                {
                    "index": c["index"],
                    "message": {
                        "role": c["message"]["role"],
                        "content": c["message"]["content"]
                    },
                    "finish_reason": c["finish_reason"]
                }
                for c in response["choices"]
            ],
            usage=response["usage"],
            created=datetime.fromtimestamp(response["created"])
        )
    
    async def stream_chat(
        self,
        request: ChatRequest
    ) -> AsyncGenerator[str, None]:
        import openai
        
        messages = [
            {"role": m.role, "content": m.content}
            for m in request.messages
        ]
        
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.client.ChatCompletion.create(
                model=request.model,
                messages=messages,
                temperature=request.temperature,
                stream=True
            )
        )
        
        for chunk in response:
            if chunk.choices[0].delta.get("content"):
                yield chunk.choices[0].delta["content"]
    
    async def create_embeddings(
        self,
        texts: List[str],
        model: str
    ) -> List[List[float]]:
        import openai
        
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.client.Embedding.create(input=texts, model=model)
        )
        
        return [item["embedding"] for item in response["data"]]
    
    def calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        info = self.models_info.get(model)
        if not info:
            return 0.0
        
        input_cost = (input_tokens / 1000) * info.pricing.input_price_per_1k
        output_cost = (output_tokens / 1000) * info.pricing.output_price_per_1k
        
        return input_cost + output_cost


class AnthropicAdapter(AIProviderInterface):
    """Anthropic Claude API adapter"""
    
    def __init__(self):
        self.client = None
        self.models_info: Dict[str, AIModelInfo] = {}
    
    async def initialize(self, api_key: str, **kwargs) -> bool:
        try:
            import anthropic
            self.client = anthropic.AsyncAnthropic(api_key=api_key)
            
            self.models_info = {
                "claude-3-opus-20240229": AIModelInfo(
                    model_id="claude-3-opus-20240229",
                    name="Claude 3 Opus",
                    provider=AIModelProvider.ANTHROPIC,
                    description="Most powerful Claude model",
                    capabilities=[
                        ModelCapability.CHAT,
                        ModelCapability.VISION,
                        ModelCapability.CODE_GENERATION
                    ],
                    pricing=ModelPricing(
                        input_price_per_1k=0.015,
                        output_price_per_1k=0.075,
                        context_window=200000
                    ),
                    supports_vision=True
                ),
                "claude-3-sonnet-20240229": AIModelInfo(
                    model_id="claude-3-sonnet-20240229",
                    name="Claude 3 Sonnet",
                    provider=AIModelProvider.ANTHROPIC,
                    description="Balanced performance",
                    capabilities=[
                        ModelCapability.CHAT,
                        ModelCapability.VISION
                    ],
                    pricing=ModelPricing(
                        input_price_per_1k=0.003,
                        output_price_per_1k=0.015,
                        context_window=200000
                    ),
                    supports_vision=True
                )
            }
            
            return True
        except Exception as e:
            print(f"Failed to initialize Anthropic: {e}")
            return False
    
    async def health_check(self) -> Dict[str, Any]:
        return {"status": "healthy"}  # Placeholder
    
    async def list_models(self) -> List[AIModelInfo]:
        return list(self.models_info.values())
    
    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        # Claude uses chat format
        chat_request = ChatRequest(
            model=request.model,
            messages=[ChatMessage(role="user", content=request.prompt)],
            max_tokens=request.max_tokens,
            temperature=request.temperature
        )
        return await self.chat(chat_request)
    
    async def chat(self, request: ChatRequest) -> CompletionResponse:
        # Convert messages to Claude format
        system_message = None
        claude_messages = []
        
        for msg in request.messages:
            if msg.role == "system":
                system_message = msg.content
            else:
                claude_messages.append({
                    "role": msg.role,
                    "content": msg.content
                })
        
        kwargs = {
            "model": request.model,
            "messages": claude_messages,
            "max_tokens": request.max_tokens or 1024,
            "temperature": request.temperature
        }
        
        if system_message:
            kwargs["system"] = system_message
        
        response = await self.client.messages.create(**kwargs)
        
        return CompletionResponse(
            id=response.id,
            model=request.model,
            choices=[{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response.content[0].text
                },
                "finish_reason": response.stop_reason
            }],
            usage={
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens
            },
            created=datetime.utcnow()
        )
    
    async def stream_chat(
        self,
        request: ChatRequest
    ) -> AsyncGenerator[str, None]:
        # Implementation for streaming
        response = await self.chat(request)
        yield response.choices[0]["message"]["content"]
    
    async def create_embeddings(
        self,
        texts: List[str],
        model: str
    ) -> List[List[float]]:
        # Anthropic doesn't have embeddings yet
        raise NotImplementedError("Embeddings not available for Anthropic")
    
    def calculate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        info = self.models_info.get(model)
        if not info:
            return 0.0
        
        input_cost = (input_tokens / 1000) * info.pricing.input_price_per_1k
        output_cost = (output_tokens / 1000) * info.pricing.output_price_per_1k
        
        return input_cost + output_cost


# ==================== MODEL MANAGER ====================

class AIModelManager:
    """
    Central manager for AI models
    
    Handles multiple providers, routing, and fallback
    """
    
    def __init__(self):
        self.providers: Dict[AIModelProvider, AIProviderInterface] = {}
        self.fallback_order: List[AIModelProvider] = [
            AIModelProvider.FIREWORKS,
            AIModelProvider.OPENAI,
            AIModelProvider.ANTHROPIC
        ]
        self.usage_stats: Dict[str, Dict] = {}
    
    async def register_provider(
        self,
        provider: AIModelProvider,
        adapter: AIProviderInterface,
        api_key: str
    ) -> bool:
        """Register and initialize an AI provider"""
        success = await adapter.initialize(api_key)
        
        if success:
            self.providers[provider] = adapter
            return True
        
        return False
    
    async def chat(
        self,
        request: ChatRequest,
        preferred_provider: Optional[AIModelProvider] = None
    ) -> CompletionResponse:
        """
        Chat with automatic fallback
        
        Tries preferred provider first, then falls back to others
        """
        providers_to_try = []
        
        if preferred_provider and preferred_provider in self.providers:
            providers_to_try.append(preferred_provider)
        
        for provider in self.fallback_order:
            if provider in self.providers and provider not in providers_to_try:
                providers_to_try.append(provider)
        
        last_error = None
        
        for provider in providers_to_try:
            try:
                adapter = self.providers[provider]
                response = await adapter.chat(request)
                
                # Track usage
                self._track_usage(provider, request.model, response.usage)
                
                return response
                
            except Exception as e:
                last_error = e
                continue
        
        raise RuntimeError(f"All providers failed: {last_error}")
    
    async def get_best_model_for_task(
        self,
        task: str,
        budget_constraint: Optional[float] = None
    ) -> AIModelInfo:
        """Get best model for a specific task"""
        all_models = []
        
        for provider in self.providers.values():
            models = await provider.list_models()
            all_models.extend(models)
        
        # Filter by capability
        task_capabilities = {
            "clinical_analysis": [ModelCapability.CHAT, ModelCapability.CODE_GENERATION],
            "document_processing": [ModelCapability.CHAT, ModelCapability.VISION],
            "embeddings": [ModelCapability.EMBEDDINGS],
            "coding": [ModelCapability.CODE_GENERATION]
        }
        
        required_capabilities = task_capabilities.get(task, [ModelCapability.CHAT])
        
        suitable_models = [
            m for m in all_models
            if all(cap in m.capabilities for cap in required_capabilities)
            and m.is_available
        ]
        
        # Sort by rating and price
        if budget_constraint:
            suitable_models = [
                m for m in suitable_models
                if m.pricing.output_price_per_1k <= budget_constraint
            ]
        
        suitable_models.sort(key=lambda m: (m.rating, -m.pricing.output_price_per_1k), reverse=True)
        
        return suitable_models[0] if suitable_models else None
    
    def _track_usage(
        self,
        provider: AIModelProvider,
        model: str,
        usage: Dict[str, int]
    ):
        """Track API usage for analytics"""
        key = f"{provider.value}:{model}"
        
        if key not in self.usage_stats:
            self.usage_stats[key] = {
                "calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "estimated_cost": 0.0
            }
        
        stats = self.usage_stats[key]
        stats["calls"] += 1
        stats["input_tokens"] += usage.get("prompt_tokens", 0)
        stats["output_tokens"] += usage.get("completion_tokens", 0)
    
    async def get_usage_report(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """Get usage and cost report"""
        total_cost = 0.0
        total_calls = 0
        
        for key, stats in self.usage_stats.items():
            provider, model = key.split(":", 1)
            
            # Calculate cost
            if provider in self.providers:
                adapter = self.providers[provider]
                cost = adapter.calculate_cost(
                    model,
                    stats["input_tokens"],
                    stats["output_tokens"]
                )
                total_cost += cost
            
            total_calls += stats["calls"]
        
        return {
            "period": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            },
            "total_calls": total_calls,
            "total_cost_usd": round(total_cost, 4),
            "by_model": self.usage_stats
        }


# ==================== API ENDPOINTS ====================

async def list_available_models(
    capability: Optional[ModelCapability] = None
) -> List[AIModelInfo]:
    """API endpoint to list available AI models"""
    manager = AIModelManager()
    
    all_models = []
    for provider in manager.providers.values():
        models = await provider.list_models()
        all_models.extend(models)
    
    if capability:
        all_models = [
            m for m in all_models
            if capability in m.capabilities
        ]
    
    return all_models


async def chat_completion(
    request: ChatRequest,
    preferred_provider: Optional[AIModelProvider] = None
) -> CompletionResponse:
    """API endpoint for chat completion"""
    manager = AIModelManager()
    return await manager.chat(request, preferred_provider)


async def get_model_recommendation(
    task: str,
    budget: Optional[float] = None
) -> Dict[str, Any]:
    """Get model recommendation for a task"""
    manager = AIModelManager()
    
    best_model = await manager.get_best_model_for_task(task, budget)
    
    if not best_model:
        return {"error": "No suitable model found"}
    
    return {
        "recommended_model": best_model.model_id,
        "provider": best_model.provider.value,
        "estimated_cost_per_1k_tokens": {
            "input": best_model.pricing.input_price_per_1k,
            "output": best_model.pricing.output_price_per_1k
        },
        "capabilities": [c.value for c in best_model.capabilities],
        "reasoning": f"Best rated model for {task} with good price/performance"
    }
