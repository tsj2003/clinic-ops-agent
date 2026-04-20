# AuthPilot AI Frontend

Live startup demo UI built with Next.js App Router + Tailwind.

## Run

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

## Demo behavior

- The default mode autostarts a real backend stream on page load
- Custom mode lets you supply your own policy page, contact page, and TinyFish goals
- Live proof, run IDs, artifacts, and the operator packet are rendered in the UI
- Recent runs are persisted and can be replayed from the UI
- The UI now surfaces payer snapshot diffs so changes in policy or routing can be detected across runs
- Custom mode supports saved clinic workspace profiles for design partner calls and repeated workflows
- The operator packet now has a staff-friendly handoff view plus brief export actions
- Guided intake and workspace mode now support case-bundle import/export
- The operator packet can be exported as CSV for downstream ops workflows
- Connector prototype API now supports first-write payload generation for Epic `$submit-attachment` and athenaOne `clinicaldocument + /tasks` workflows
- Operator Packet panel now includes a live `Sync to EMR` action with persisted external EMR IDs and sync timestamps
- BatchUploadDashboard now supports drag-drop specialty referral files with fuzzy header mapping, pre-flight validation, duplicate detection, and run creation at scale
- Operator Packet now supports `Run Portal Submission` with Playwright automation, proof capture, and EMR close-loop patching
- This surface is optimized for product demos, design partner calls, and TinyFish Demo Day

## Connector Prototype API

- Route: `POST /api/integrations/connector-prototype`
- Purpose: Build (and optionally execute) first-write integration requests for Epic and athenahealth.
- Default mode: `dryRun: true` (request preview only)

Minimal body example:

```json
{
	"connector": "both",
	"dryRun": true,
	"packet": {
		"case_id": "CASE-100",
		"payer_name": "Aetna",
		"procedure": "Lumbar MRI",
		"diagnosis": "M54.16",
		"submission_ready": true,
		"practice_id": "195900",
		"patient_id": "12345"
	},
	"athena": {
		"practiceId": "195900",
		"patientId": "12345"
	}
}
```
