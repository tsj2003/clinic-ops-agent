# GSD (Get Sh*t Done)

## Description
Project task breakdown and step-by-step execution engine that converts large projects into small, clear, executable tasks.

## Purpose
GSD takes a large project and breaks it into small, clear, executable tasks.

Instead of overwhelming the AI with everything at once, it forces a step-by-step execution approach.

This directly solves two major problems:
- **Hallucination** (AI generating incorrect or made-up outputs)
- **Context overload** (AI losing track in long workflows)

When tasks are smaller and isolated, results become more accurate and predictable.

## Key Benefits
- Converts big projects into manageable steps
- Improves output accuracy
- Maintains consistency across long workflows
- Keeps execution structured and organized

## When to Use
- Large, complex projects with multiple components
- When AI responses become inconsistent or hallucinated
- Long-running workflows that need structure
- Any task that feels "too big" to tackle at once

## Usage Instructions

### Step 1: Define Your End Goal
Clearly articulate what you want to achieve. Be specific about the deliverable.

### Step 2: Task Breakdown
The skill automatically breaks the project into:
- **Macro tasks** - Major phases or milestones
- **Micro tasks** - Individual executable steps
- **Dependencies** - What needs to happen before what

### Step 3: Execute One by One
- Focus on ONE micro task at a time
- Complete it fully before moving to the next
- Update progress after each task

### Step 4: Validate & Iterate
- Review outputs for accuracy
- If issues arise, break down further
- Maintain a running task log

## Workflow Integration

```
Project Input
    ↓
[Analyze & Decompose]
    ↓
Task Queue Generated
    ↓
[Execute Task 1] → [Validate] → [Mark Complete]
    ↓
[Execute Task 2] → [Validate] → [Mark Complete]
    ↓
        ...
    ↓
[Final Assembly & Review]
    ↓
Deliverable Output
```

## Example Prompt Template

```
I need to build [PROJECT DESCRIPTION].

Use GSD to break this into executable tasks:
1. Analyze the requirements
2. Break into macro phases
3. Divide each phase into micro tasks
4. Execute tasks one by one
5. Validate each step

End goal: [SPECIFIC DELIVERABLE]
```

## Output Format

Each task should include:
- **Task ID**: Unique identifier
- **Task Name**: Clear, action-oriented title
- **Description**: What needs to be done
- **Acceptance Criteria**: How to know it's done
- **Dependencies**: Prerequisites (if any)
- **Status**: Pending | In Progress | Complete | Blocked

## Activation
Enabled by default for all complex projects. Explicitly invoke with: `/gsd` or "Use GSD methodology"
