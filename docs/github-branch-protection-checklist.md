# GitHub Branch Protection Checklist

Updated: 2026-04-17

This checklist covers the remaining manual GitHub configuration that cannot be enforced from repo code alone.

## Goal

Make the `TestSprite Reliability Gate` workflow a real deployment blocker for protected branches.

## Prerequisites

- The workflow file exists at [web-reliability-gate.yml](/Users/tarandeepsinghjuneja/tinyfish_hackathone/.github/workflows/web-reliability-gate.yml).
- The repo secret `TESTSPRITE_API_KEY` is available in GitHub Actions.
- The workflow has run at least once successfully so the status check name appears in branch-protection settings.

## Manual Steps

1. Open the GitHub repository.
2. Go to `Settings -> Secrets and variables -> Actions`.
3. Add or verify the repository secret `TESTSPRITE_API_KEY`.
4. Go to `Settings -> Branches`.
5. Create or edit the branch-protection rule for `main`.
6. Enable `Require a pull request before merging`.
7. Enable `Require status checks to pass before merging`.
8. Search for and select `TestSprite Reliability Gate`.
9. Keep `Require branches to be up to date before merging` enabled.
10. Save the rule.

## Verification

- Open a pull request against `main`.
- Confirm the `TestSprite Reliability Gate` job appears in the checks list.
- Confirm merge is blocked if that job fails.
- Confirm merge is blocked if the workflow is required but the job does not complete.

## Truth-First Note

This repository can make the workflow fail clearly when the secret is missing, but it cannot apply GitHub branch-protection settings by itself. That final enforcement step must be completed in the GitHub UI by a repo admin.
