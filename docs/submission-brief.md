# Submission Brief

## One-line pitch

Clinic Ops Agent is a TinyFish-powered clinic ops agent that reads live payer policy pages, checks whether a chart is submission-ready, and finds the correct precertification route on the payer site.

## Short description

Revenue-cycle teams lose time before they ever enter a portal. Staff read payer policy pages by hand, compare those rules against a chart, and then search the payer website for the right precertification contact path. Clinic Ops Agent automates that browser-heavy prep work with TinyFish and returns an operator-ready handoff packet.

## Why judges should care

- This is real web work on live insurer pages
- The workflow depends on browser automation, not a static API
- The output is operational and immediately useful to clinic staff
- The problem is painful, frequent, and commercially clear

## What TinyFish is doing

- Opening the Aetna medical policy page
- Extracting documentation requirements from the live web page
- Opening Aetna's public contact page
- Finding provider precertification routing details
- Returning structured outputs for the app to act on

## Suggested HackerEarth description

Clinic Ops Agent helps clinics decide whether a prior authorization case is ready before staff waste time in a payer portal. Using TinyFish, the app reads a live payer policy page, extracts evidence requirements, compares them with a synthetic patient chart, and then finds the correct provider precertification route on the payer site. The final output is an operator handoff packet with readiness status, matched evidence, missing evidence, policy source, and the next contact channel.

## Suggested X post copy

Built Clinic Ops Agent for the @Tiny_fish hackathon.

It uses TinyFish live on payer websites to:
- read policy requirements
- check if a chart is submission-ready
- find the right precertification contact path

Real browser work for clinic ops.

#tinyfish #aiagents #healthtech

## What to say if asked about scope

Today the product solves the pre-submission research bottleneck. The next step is chaining the same flow into private portal submission and status follow-up.

## Final submission checklist

- Record one clean live run
- Show the TinyFish result artifact and operator packet on screen
- Mention synthetic data and zero PII clearly
- Keep the narration focused on clinic operations and time saved
- Be explicit that TinyFish is powering both live web workflows
