# CodeRabbit

## Description
Real-time AI code reviewer that works alongside your development process to review code instantly, detect bugs early, and suggest improvements.

## Purpose
CodeRabbit is a real-time AI code reviewer.

It works alongside your development process and:
- **Reviews** code instantly
- **Detects** bugs early
- **Suggests** improvements
- **Prevents** production-level errors

Think of it as having a senior developer reviewing every line in real time.

## Key Benefits
- Early bug detection
- Cleaner pull requests
- Higher code quality
- Safer deployments

## When to Use
- Before committing code
- During code reviews
- When refactoring existing code
- Before merging branches
- When learning best practices

## Usage Instructions

### Step 1: Write/Update Code
Develop normally. CodeRabbit integrates into your workflow.

### Step 2: Request Review
Invoke with:
- `/review` - Review current file/selection
- `/review [file-path]` - Review specific file
- "CodeRabbit, review this" - Natural language invocation

### Step 3: Review Feedback
CodeRabbit provides:
- **Issues Found**: Bugs, anti-patterns, potential errors
- **Suggestions**: Improvements, optimizations, best practices
- **Security**: Vulnerabilities, unsafe patterns
- **Style**: Formatting, naming, consistency

### Step 4: Apply or Dismiss
- Apply suggestions that make sense
- Dismiss those that don't fit your context
- Learn from the feedback

## Review Categories

### 1. Bugs & Errors
- Logic errors
- Null/undefined handling
- Async/await issues
- Type safety problems

### 2. Performance
- Unnecessary re-renders
- Inefficient algorithms
- Memory leaks
- Bundle size impact

### 3. Security
- XSS vulnerabilities
- Injection risks
- Unsafe eval/innerHTML
- Hardcoded secrets

### 4. Maintainability
- Code duplication
- Complex functions
- Unclear naming
- Missing documentation

### 5. Best Practices
- Framework-specific patterns
- TypeScript strictness
- Testing coverage
- Error handling

## Review Output Format

```markdown
## CodeRabbit Review: [file-name]

### ✅ Good Practices
- [Positive observations]

### ⚠️ Issues Found
| Line | Severity | Issue | Suggestion |
|------|----------|-------|------------|
| 23   | High     | [Issue] | [Fix] |

### 💡 Suggestions
- [Improvement 1]
- [Improvement 2]

### 🔒 Security
- [Security notes]

### 📊 Summary
- Total issues: X
- Critical: Y
- Warnings: Z
- Suggestions: W
```

## Special Review Modes

### Pre-Commit Review
```
/review --pre-commit
```
Quick scan of staged changes before committing.

### Deep Review
```
/review --deep
```
Thorough analysis including:
- Architecture patterns
- Design decisions
- Test coverage
- Documentation

### Security Audit
```
/review --security
```
Focused security review for vulnerabilities.

### Performance Check
```
/review --performance
```
Performance-focused review for optimizations.

## Integration Points

1. **During Development**: `/review` on current work
2. **Before Commit**: Automatic pre-commit review
3. **Code Review**: Review PR changes
4. **Refactoring**: Review before/after comparison

## Review Checklist (Internal)

When reviewing code, CodeRabbit checks:

- [ ] No TypeScript `any` types
- [ ] Proper error handling
- [ ] No console.logs in production code
- [ ] Consistent naming conventions
- [ ] Proper React hook dependencies
- [ ] No memory leaks in effects
- [ ] Accessible JSX elements
- [ ] Proper key props in lists
- [ ] No unused imports/variables
- [ ] Proper async/await usage

## Activation
Invoke with: `/review` or "CodeRabbit, review this"

## Git Integration
CodeRabbit integrates with git workflow:
- Reviews staged changes: `/review --staged`
- Reviews specific commit: `/review --commit [hash]`
- Compares branches: `/review --compare [branch]`
