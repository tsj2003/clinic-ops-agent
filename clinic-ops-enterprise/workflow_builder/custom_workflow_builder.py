"""
Custom Workflow Builder
Visual drag-and-drop workflow designer for creating custom claim processing workflows
"""

from datetime import datetime
from typing import Dict, List, Optional, Any, Callable, Set
from pydantic import BaseModel, Field
from dataclasses import dataclass, field
from enum import Enum
import json
import uuid
from collections import defaultdict


class NodeType(str, Enum):
    """Types of workflow nodes"""
    # Input/Output
    TRIGGER = "trigger"  # Workflow start
    INPUT = "input"  # Data input
    OUTPUT = "output"  # Data output
    
    # Processing
    PROCESS = "process"  # Generic processing
    AI_ANALYSIS = "ai_analysis"  # AI-powered analysis
    DECISION = "decision"  # If/else branching
    DELAY = "delay"  # Wait/delay
    
    # Integrations
    EHR_LOOKUP = "ehr_lookup"
    PAYER_PORTAL = "payer_portal"
    CLEARINGHOUSE = "clearinghouse"
    API_CALL = "api_call"
    WEBHOOK = "webhook"
    
    # Actions
    SEND_EMAIL = "send_email"
    SEND_SMS = "send_sms"
    CREATE_TASK = "create_task"
    UPDATE_CLAIM = "update_claim"
    
    # Logic
    LOOP = "loop"
    MERGE = "merge"
    FILTER = "filter"
    TRANSFORM = "transform"
    
    # End
    END = "end"  # Workflow end


class WorkflowStatus(str, Enum):
    """Workflow lifecycle status"""
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class ExecutionStatus(str, Enum):
    """Workflow execution status"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Port(BaseModel):
    """Node input/output port"""
    id: str
    name: str
    type: str  # string, number, boolean, object, any
    required: bool = True
    description: Optional[str] = None
    default_value: Any = None


class WorkflowNode(BaseModel):
    """A node in the workflow"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    type: NodeType
    name: str
    description: Optional[str] = None
    
    # Visual positioning
    position_x: float = 0
    position_y: float = 0
    width: float = 200
    height: float = 100
    
    # Configuration
    config: Dict[str, Any] = Field(default_factory=dict)
    
    # Ports
    inputs: List[Port] = Field(default_factory=list)
    outputs: List[Port] = Field(default_factory=list)
    
    # Execution
    timeout_seconds: int = 60
    retry_count: int = 0
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "node-001",
                "type": "ai_analysis",
                "name": "Denial Risk Analysis",
                "position_x": 300,
                "position_y": 200,
                "config": {"model": "denial-prediction-v2"}
            }
        }


class WorkflowEdge(BaseModel):
    """Connection between nodes"""
    id: str = Field(default_factory=lambda: f"edge-{str(uuid.uuid4())[:8]}")
    source_node_id: str
    source_port_id: str
    target_node_id: str
    target_port_id: str
    
    # Conditional routing
    condition: Optional[str] = None  # JavaScript expression for conditional edges
    label: Optional[str] = None
    
    # Visual
    points: List[Dict[str, float]] = Field(default_factory=list)  # Path points


class WorkflowDefinition(BaseModel):
    """Complete workflow definition"""
    workflow_id: str = Field(default_factory=lambda: f"wf-{str(uuid.uuid4())[:8]}")
    name: str
    description: Optional[str] = None
    version: str = "1.0.0"
    
    # Owner
    tenant_id: str
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Workflow graph
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[WorkflowEdge] = Field(default_factory=list)
    
    # Settings
    status: WorkflowStatus = WorkflowStatus.DRAFT
    auto_start: bool = False
    
    # Trigger configuration
    trigger_type: str = "manual"  # manual, scheduled, webhook, event
    trigger_config: Dict[str, Any] = Field(default_factory=dict)
    
    # Execution settings
    max_execution_time_seconds: int = 3600
    max_retries: int = 3
    concurrent_executions: int = 1
    
    class Config:
        json_schema_extra = {
            "example": {
                "workflow_id": "wf-abc123",
                "name": "Prior Authorization Workflow",
                "tenant_id": "tenant-001",
                "nodes": [],
                "edges": []
            }
        }


@dataclass
class ExecutionContext:
    """Runtime execution context"""
    execution_id: str
    workflow_id: str
    tenant_id: str
    
    # Input data
    input_data: Dict[str, Any] = field(default_factory=dict)
    
    # Runtime state
    variables: Dict[str, Any] = field(default_factory=dict)
    node_outputs: Dict[str, Any] = field(default_factory=dict)
    
    # Execution tracking
    current_node_id: Optional[str] = None
    executed_nodes: Set[str] = field(default_factory=set)
    failed_nodes: Set[str] = field(default_factory=set)
    
    # Metadata
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    status: ExecutionStatus = ExecutionStatus.PENDING
    
    # Logs
    logs: List[Dict] = field(default_factory=list)


# ==================== WORKFLOW BUILDER ====================

class WorkflowBuilder:
    """
    Visual workflow builder
    
    Provides APIs for creating, editing, and validating workflows
    """
    
    def __init__(self, workflow: Optional[WorkflowDefinition] = None):
        self.workflow = workflow or WorkflowDefinition(
            name="New Workflow",
            tenant_id="default",
            created_by="system"
        )
        self._node_registry = self._build_node_registry()
    
    def _build_node_registry(self) -> Dict[NodeType, Dict]:
        """Build registry of available node types"""
        return {
            NodeType.TRIGGER: {
                "name": "Trigger",
                "description": "Workflow starting point",
                "color": "#4CAF50",
                "icon": "play",
                "outputs": [{"name": "start", "type": "trigger"}]
            },
            NodeType.INPUT: {
                "name": "Input",
                "description": "Receive data input",
                "color": "#2196F3",
                "icon": "download",
                "outputs": [{"name": "data", "type": "object"}]
            },
            NodeType.AI_ANALYSIS: {
                "name": "AI Analysis",
                "description": "AI-powered analysis",
                "color": "#9C27B0",
                "icon": "brain",
                "inputs": [{"name": "data", "type": "object", "required": True}],
                "outputs": [
                    {"name": "result", "type": "object"},
                    {"name": "confidence", "type": "number"}
                ],
                "config_schema": {
                    "model": {"type": "string", "required": True},
                    "prompt_template": {"type": "string"}
                }
            },
            NodeType.DECISION: {
                "name": "Decision",
                "description": "Branch based on condition",
                "color": "#FF9800",
                "icon": "source-branch",
                "inputs": [{"name": "input", "type": "any"}],
                "outputs": [
                    {"name": "true", "type": "boolean"},
                    {"name": "false", "type": "boolean"}
                ],
                "config_schema": {
                    "condition": {"type": "string", "required": True}
                }
            },
            NodeType.EHR_LOOKUP: {
                "name": "EHR Lookup",
                "description": "Query EHR system",
                "color": "#00BCD4",
                "icon": "database",
                "inputs": [{"name": "patient_id", "type": "string", "required": True}],
                "outputs": [{"name": "patient_data", "type": "object"}],
                "config_schema": {
                    "ehr_system": {"type": "string", "enum": ["epic", "cerner", "athena"]},
                    "query_type": {"type": "string", "enum": ["patient", "encounter", "documents"]}
                }
            },
            NodeType.PAYER_PORTAL: {
                "name": "Payer Portal",
                "description": "Interact with payer portal",
                "color": "#795548",
                "icon": "web",
                "inputs": [{"name": "claim_data", "type": "object", "required": True}],
                "outputs": [{"name": "result", "type": "object"}],
                "config_schema": {
                    "payer_id": {"type": "string", "required": True},
                    "action": {"type": "string", "enum": ["submit", "check_status", "appeal"]}
                }
            },
            NodeType.SEND_EMAIL: {
                "name": "Send Email",
                "description": "Send email notification",
                "color": "#E91E63",
                "icon": "email",
                "inputs": [
                    {"name": "to", "type": "string", "required": True},
                    {"name": "template_data", "type": "object"}
                ],
                "outputs": [{"name": "sent", "type": "boolean"}],
                "config_schema": {
                    "template": {"type": "string", "required": True}
                }
            },
            NodeType.DELAY: {
                "name": "Delay",
                "description": "Wait for specified time",
                "color": "#607D8B",
                "icon": "clock",
                "inputs": [{"name": "input", "type": "any"}],
                "outputs": [{"name": "output", "type": "any"}],
                "config_schema": {
                    "duration_seconds": {"type": "number", "required": True},
                    "wait_until": {"type": "string"}  # ISO timestamp
                }
            },
            NodeType.END: {
                "name": "End",
                "description": "Workflow completion",
                "color": "#F44336",
                "icon": "stop",
                "inputs": [{"name": "result", "type": "any"}]
            }
        }
    
    def add_node(
        self,
        node_type: NodeType,
        name: str,
        position_x: float = 0,
        position_y: float = 0,
        config: Optional[Dict] = None
    ) -> WorkflowNode:
        """Add a new node to the workflow"""
        registry_info = self._node_registry.get(node_type, {})
        
        # Build ports from registry
        inputs = [
            Port(id=f"{p['name']}-in", **p)
            for p in registry_info.get("inputs", [])
        ]
        outputs = [
            Port(id=f"{p['name']}-out", **p)
            for p in registry_info.get("outputs", [])
        ]
        
        node = WorkflowNode(
            type=node_type,
            name=name,
            description=registry_info.get("description"),
            position_x=position_x,
            position_y=position_y,
            inputs=inputs,
            outputs=outputs,
            config=config or {}
        )
        
        self.workflow.nodes.append(node)
        return node
    
    def remove_node(self, node_id: str) -> bool:
        """Remove a node and its connected edges"""
        # Remove edges connected to this node
        self.workflow.edges = [
            e for e in self.workflow.edges
            if e.source_node_id != node_id and e.target_node_id != node_id
        ]
        
        # Remove node
        original_count = len(self.workflow.nodes)
        self.workflow.nodes = [n for n in self.workflow.nodes if n.id != node_id]
        
        return len(self.workflow.nodes) < original_count
    
    def connect_nodes(
        self,
        source_node_id: str,
        source_port: str,
        target_node_id: str,
        target_port: str,
        condition: Optional[str] = None
    ) -> WorkflowEdge:
        """Connect two nodes with an edge"""
        # Validate nodes exist
        source_exists = any(n.id == source_node_id for n in self.workflow.nodes)
        target_exists = any(n.id == target_node_id for n in self.workflow.nodes)
        
        if not source_exists:
            raise ValueError(f"Source node {source_node_id} not found")
        if not target_exists:
            raise ValueError(f"Target node {target_node_id} not found")
        
        edge = WorkflowEdge(
            source_node_id=source_node_id,
            source_port_id=source_port,
            target_node_id=target_node_id,
            target_port_id=target_port,
            condition=condition
        )
        
        self.workflow.edges.append(edge)
        return edge
    
    def update_node_config(self, node_id: str, config: Dict[str, Any]) -> bool:
        """Update node configuration"""
        for node in self.workflow.nodes:
            if node.id == node_id:
                node.config.update(config)
                return True
        return False
    
    def move_node(self, node_id: str, x: float, y: float) -> bool:
        """Move node to new position"""
        for node in self.workflow.nodes:
            if node.id == node_id:
                node.position_x = x
                node.position_y = y
                return True
        return False
    
    def validate_workflow(self) -> Dict[str, Any]:
        """Validate workflow for errors"""
        errors = []
        warnings = []
        
        # Check for trigger node
        triggers = [n for n in self.workflow.nodes if n.type == NodeType.TRIGGER]
        if len(triggers) == 0:
            errors.append("Workflow must have at least one trigger node")
        elif len(triggers) > 1:
            warnings.append("Multiple trigger nodes found")
        
        # Check for end nodes
        ends = [n for n in self.workflow.nodes if n.type == NodeType.END]
        if len(ends) == 0:
            warnings.append("No end nodes found - workflow may not terminate properly")
        
        # Check for disconnected nodes
        connected_node_ids = set()
        for edge in self.workflow.edges:
            connected_node_ids.add(edge.source_node_id)
            connected_node_ids.add(edge.target_node_id)
        
        for node in self.workflow.nodes:
            if node.id not in connected_node_ids and node.type != NodeType.TRIGGER:
                warnings.append(f"Node '{node.name}' is disconnected")
        
        # Check for cycles
        if self._detect_cycles():
            errors.append("Workflow contains cycles")
        
        # Validate all edges have valid nodes
        for edge in self.workflow.edges:
            source_exists = any(n.id == edge.source_node_id for n in self.workflow.nodes)
            target_exists = any(n.id == edge.target_node_id for n in self.workflow.nodes)
            
            if not source_exists:
                errors.append(f"Edge references missing source node: {edge.source_node_id}")
            if not target_exists:
                errors.append(f"Edge references missing target node: {edge.target_node_id}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "node_count": len(self.workflow.nodes),
            "edge_count": len(self.workflow.edges)
        }
    
    def _detect_cycles(self) -> bool:
        """Detect cycles in workflow graph"""
        # Build adjacency list
        graph = defaultdict(list)
        for edge in self.workflow.edges:
            graph[edge.source_node_id].append(edge.target_node_id)
        
        # DFS with visited tracking
        visited = set()
        rec_stack = set()
        
        def has_cycle(node_id):
            visited.add(node_id)
            rec_stack.add(node_id)
            
            for neighbor in graph[node_id]:
                if neighbor not in visited:
                    if has_cycle(neighbor):
                        return True
                elif neighbor in rec_stack:
                    return True
            
            rec_stack.remove(node_id)
            return False
        
        for node in self.workflow.nodes:
            if node.id not in visited:
                if has_cycle(node.id):
                    return True
        
        return False
    
    def export_to_json(self) -> str:
        """Export workflow to JSON"""
        return json.dumps(self.workflow.dict(), indent=2, default=str)
    
    def get_available_node_types(self) -> List[Dict[str, Any]]:
        """Get list of available node types for UI"""
        return [
            {
                "type": t.value,
                "name": info["name"],
                "description": info["description"],
                "color": info.get("color", "#666"),
                "icon": info.get("icon", "cube"),
                "category": self._get_category(t)
            }
            for t, info in self._node_registry.items()
        ]
    
    def _get_category(self, node_type: NodeType) -> str:
        """Get category for node type"""
        categories = {
            NodeType.TRIGGER: "Flow Control",
            NodeType.INPUT: "Input/Output",
            NodeType.OUTPUT: "Input/Output",
            NodeType.PROCESS: "Processing",
            NodeType.AI_ANALYSIS: "AI/ML",
            NodeType.DECISION: "Logic",
            NodeType.EHR_LOOKUP: "Integrations",
            NodeType.PAYER_PORTAL: "Integrations",
            NodeType.CLEARINGHOUSE: "Integrations",
            NodeType.SEND_EMAIL: "Actions",
            NodeType.SEND_SMS: "Actions",
            NodeType.DELAY: "Flow Control",
            NodeType.END: "Flow Control"
        }
        return categories.get(node_type, "Other")


# ==================== WORKFLOW ENGINE ====================

class WorkflowEngine:
    """
    Workflow execution engine
    
    Executes workflow definitions
    """
    
    def __init__(self):
        self._executions: Dict[str, ExecutionContext] = {}
        self._node_handlers: Dict[NodeType, Callable] = self._register_handlers()
    
    def _register_handlers(self) -> Dict[NodeType, Callable]:
        """Register node type handlers"""
        return {
            NodeType.TRIGGER: self._handle_trigger,
            NodeType.INPUT: self._handle_input,
            NodeType.AI_ANALYSIS: self._handle_ai_analysis,
            NodeType.DECISION: self._handle_decision,
            NodeType.EHR_LOOKUP: self._handle_ehr_lookup,
            NodeType.PAYER_PORTAL: self._handle_payer_portal,
            NodeType.SEND_EMAIL: self._handle_send_email,
            NodeType.DELAY: self._handle_delay,
            NodeType.END: self._handle_end
        }
    
    async def execute_workflow(
        self,
        workflow: WorkflowDefinition,
        input_data: Dict[str, Any],
        tenant_id: str
    ) -> ExecutionContext:
        """Execute a workflow"""
        execution_id = f"exec-{str(uuid.uuid4())[:8]}"
        
        context = ExecutionContext(
            execution_id=execution_id,
            workflow_id=workflow.workflow_id,
            tenant_id=tenant_id,
            input_data=input_data,
            status=ExecutionStatus.RUNNING
        )
        
        self._executions[execution_id] = context
        
        try:
            # Find trigger node
            trigger = next(
                (n for n in workflow.nodes if n.type == NodeType.TRIGGER),
                None
            )
            
            if not trigger:
                raise ValueError("No trigger node found")
            
            # Start execution
            await self._execute_node(workflow, trigger, context)
            
            # Follow execution path
            await self._follow_execution_path(workflow, trigger, context)
            
            context.status = ExecutionStatus.COMPLETED
            context.completed_at = datetime.utcnow()
            
        except Exception as e:
            context.status = ExecutionStatus.FAILED
            context.logs.append({
                "timestamp": datetime.utcnow().isoformat(),
                "level": "error",
                "message": str(e)
            })
        
        return context
    
    async def _execute_node(
        self,
        workflow: WorkflowDefinition,
        node: WorkflowNode,
        context: ExecutionContext
    ):
        """Execute a single node"""
        context.current_node_id = node.id
        context.executed_nodes.add(node.id)
        
        # Get handler
        handler = self._node_handlers.get(node.type)
        if not handler:
            raise ValueError(f"No handler for node type: {node.type}")
        
        # Execute
        try:
            result = await handler(node, context)
            context.node_outputs[node.id] = result
            
            context.logs.append({
                "timestamp": datetime.utcnow().isoformat(),
                "level": "info",
                "node_id": node.id,
                "node_type": node.type.value,
                "message": f"Executed {node.name}"
            })
            
        except Exception as e:
            context.failed_nodes.add(node.id)
            raise
    
    async def _follow_execution_path(
        self,
        workflow: WorkflowDefinition,
        current_node: WorkflowNode,
        context: ExecutionContext
    ):
        """Follow execution path from current node"""
        # Find outgoing edges
        outgoing = [
            e for e in workflow.edges
            if e.source_node_id == current_node.id
        ]
        
        for edge in outgoing:
            # Check condition for decision nodes
            if edge.condition:
                # Evaluate condition
                result = self._evaluate_condition(edge.condition, context)
                if not result:
                    continue
            
            # Find target node
            target = next(
                (n for n in workflow.nodes if n.id == edge.target_node_id),
                None
            )
            
            if target and target.id not in context.executed_nodes:
                await self._execute_node(workflow, target, context)
                await self._follow_execution_path(workflow, target, context)
    
    def _evaluate_condition(self, condition: str, context: ExecutionContext) -> bool:
        """Evaluate a JavaScript-like condition"""
        # Simple evaluator - in production use a proper JS engine or AST parser
        # For now, support basic comparisons
        try:
            # Replace variable references
            condition = condition.replace("${", "context.variables.get(")
            condition = condition.replace("}", ", '')")
            
            # Evaluate
            return eval(condition, {"context": context, "__builtins__": {}})
        except:
            return False
    
    # ==================== NODE HANDLERS ====================
    
    async def _handle_trigger(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle trigger node"""
        return {"triggered": True, "timestamp": datetime.utcnow().isoformat()}
    
    async def _handle_input(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle input node"""
        return ctx.input_data
    
    async def _handle_ai_analysis(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle AI analysis node"""
        config = node.config
        model = config.get("model", "default")
        
        # Get input data
        input_data = ctx.node_outputs.get(ctx.current_node_id, {})
        
        # Call AI service
        # result = await ai_service.analyze(model, input_data)
        
        return {
            "model": model,
            "analysis": "AI analysis result",
            "confidence": 0.95
        }
    
    async def _handle_decision(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle decision node"""
        condition = node.config.get("condition", "true")
        result = self._evaluate_condition(condition, ctx)
        
        return {"decision": result, "condition": condition}
    
    async def _handle_ehr_lookup(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle EHR lookup"""
        ehr_system = node.config.get("ehr_system")
        patient_id = ctx.variables.get("patient_id")
        
        # Call EHR integration
        return {
            "ehr_system": ehr_system,
            "patient_id": patient_id,
            "data": {}  # Patient data
        }
    
    async def _handle_payer_portal(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle payer portal interaction"""
        payer_id = node.config.get("payer_id")
        action = node.config.get("action")
        
        return {
            "payer_id": payer_id,
            "action": action,
            "result": "success"
        }
    
    async def _handle_send_email(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle send email"""
        template = node.config.get("template")
        to = ctx.variables.get("email")
        
        # Send email
        return {"sent": True, "template": template, "recipient": to}
    
    async def _handle_delay(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle delay"""
        duration = node.config.get("duration_seconds", 0)
        
        if duration > 0:
            await asyncio.sleep(duration)
        
        return {"delayed_seconds": duration}
    
    async def _handle_end(self, node: WorkflowNode, ctx: ExecutionContext) -> Any:
        """Handle end node"""
        return {"completed": True, "execution_id": ctx.execution_id}


# ==================== API ENDPOINTS ====================

async def create_workflow(
    name: str,
    tenant_id: str,
    created_by: str
) -> WorkflowDefinition:
    """API: Create new workflow"""
    workflow = WorkflowDefinition(
        name=name,
        tenant_id=tenant_id,
        created_by=created_by
    )
    
    # Add default trigger node
    builder = WorkflowBuilder(workflow)
    builder.add_node(NodeType.TRIGGER, "Start", 100, 100)
    
    return workflow


async def get_workflow_templates() -> List[Dict[str, Any]]:
    """API: Get pre-built workflow templates"""
    return [
        {
            "id": "prior-auth-workflow",
            "name": "Prior Authorization Workflow",
            "description": "Complete prior authorization workflow with AI analysis",
            "category": "Clinical",
            "nodes": 8,
            "estimated_time": "5-10 minutes"
        },
        {
            "id": "denial-appeal-workflow",
            "name": "Denial Appeal Workflow",
            "description": "Automated denial analysis and appeal generation",
            "category": "Revenue Recovery",
            "nodes": 6,
            "estimated_time": "3-5 minutes"
        },
        {
            "id": "eligibility-check-workflow",
            "name": "Eligibility Verification",
            "description": "Real-time eligibility checking workflow",
            "category": "Verification",
            "nodes": 4,
            "estimated_time": "1-2 minutes"
        }
    ]
