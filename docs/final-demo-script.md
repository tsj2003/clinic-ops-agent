# Final Demo Script

Use this version for the raw 2-3 minute hackathon recording.

## Before You Record

- Set `TINYFISH_MODE=live`
- Confirm `TINYFISH_API_KEY` is valid
- Open the deployed app
- Hard refresh once
- Leave the app on the autoplay default mode

## 2-3 Minute Script

Say:

"Prior authorization teams lose time before they ever touch a payer portal. Staff manually read policy pages, compare those rules against the chart, and then search insurer sites for the correct precertification route. AuthPilot AI automates that browser-heavy prep work."

Pause for a beat and let the app start.

Say:

"This is a live TinyFish-powered workflow, not a chatbot and not a static API integration. The app is using real browser infrastructure against live insurer pages."

As the run begins, point at the proof panel.

Say:

"At the top left you can see the runtime mode and workflow proof. The policy run and contact run both show live TinyFish execution state, so the demo is not just a front-end animation."

As logs stream in:

Say:

"The first workflow opens the payer policy page and extracts the evidence requirements. We then compare those requirements against a synthetic patient chart with zero PII."

When the artifact or readiness result appears:

Say:

"The app turns the payer page into structured operational data: policy requirements, matched evidence, missing evidence, and a clear readiness recommendation."

Then move to the second workflow:

Say:

"The second workflow opens the payer's contact or precertification page and finds the right next route for clinic staff. That means staff no longer have to hunt around the insurer website by hand."

When the operator packet is visible:

Say:

"The output is an operator handoff packet. Instead of asking staff to read policy language and search the payer site themselves, AuthPilot AI returns a submission-readiness decision and the next payer action to take."

Close with:

"AuthPilot AI turns prior authorization from a brittle manual research task into an adaptive clinic-ops workflow powered by live browser agents."

## Backup Line If Asked Whether It Is Really Live

Say:

"Yes. The default mode now autostarts the real backend stream, and the UI exposes TinyFish execution proof directly instead of relying on narration."
