# Ralph Loop

## Description
Autonomous planning and execution agent that thinks in cycles — reads PRD, plans, builds, tests, fixes, and iterates until complete.

## Purpose
Ralph Loop is an autonomous planning and execution agent.

It doesn't just follow instructions — it thinks in cycles:

1. **Reads** your PRD (Product Requirements Document)
2. **Checks** current progress
3. **Decides** the next task
4. **Builds** the solution
5. **Tests** it
6. **Fixes** issues
7. **Repeats** until everything works
8. **Saves** final output

It basically removes the need to guide AI at every step.

## Key Benefits
- Automatically decides next steps
- Self-corrects errors
- Speeds up development cycles
- Reduces mental load

## When to Use
- When you have a clear PRD/specification
- For end-to-end feature development
- When you want "hands-off" execution
- Projects requiring multiple iteration cycles
- Complex implementations with testing requirements

## Usage Instructions

### Step 1: Provide a Clear PRD
Create a detailed Product Requirements Document including:
- Feature description
- Acceptance criteria
- Technical constraints
- Edge cases to handle

### Step 2: Start the Agent
Invoke with: `/ralph` or "Start Ralph Loop"

### Step 3: Let It Run
The agent will:
- Parse the PRD
- Create an execution plan
- Build incrementally
- Test each component
- Fix issues automatically
- Iterate until complete

### Step 4: Review Outputs
Review completed work at each checkpoint. Provide feedback if needed.

## The Ralph Cycle

```
┌─────────────────────────────────────┐
│         READ PRD / SPECS            │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│      CHECK CURRENT PROGRESS         │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│      DECIDE NEXT TASK               │
│  (Based on PRD + Progress + Errors) │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│         BUILD SOLUTION              │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│           RUN TESTS                 │
└───────────────┬─────────────────────┘
                ↓
        ┌───────┴───────┐
        ▼               ▼
┌──────────────┐  ┌──────────────┐
│  PASS ✓      │  │  FAIL ✗      │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ↓                 ↓
┌──────────────┐  ┌──────────────┐
│ SAVE OUTPUT  │  │  FIX ISSUES  │
│  & EXIT      │  │  & REPEAT    │
└──────────────┘  └──────┬───────┘
                         │
                         └────────→ (Back to CHECK PROGRESS)
```

## PRD Template

```markdown
# Feature: [Name]

## Overview
[1-2 sentence description]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2

## Technical Notes
- Constraint 1
- Constraint 2

## Edge Cases
- Edge case 1: expected behavior
- Edge case 2: expected behavior
```

## Execution Modes

### Mode 1: Full Autonomy
"Run Ralph Loop on this PRD"
- Agent executes everything automatically
- Stops only for critical decisions or errors

### Mode 2: Checkpoint Review
"Run Ralph Loop with checkpoints"
- Pauses after each major phase
- Waits for human review before continuing

### Mode 3: Step-by-Step
"Run Ralph Loop one step at a time"
- Executes one cycle at a time
- Waits for confirmation after each iteration

## Activation
Invoke with: `/ralph` or "Start Ralph Loop"

## Integration with GSD
Ralph Loop works well with GSD:
- Ralph handles the autonomous execution
- GSD provides the task breakdown structure
- Combined: Autonomous execution of well-structured tasks
