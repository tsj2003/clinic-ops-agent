# Demo Script

Use this for a raw 2-3 minute TinyFish hackathon recording.

## Goal

Show that Clinic Ops Agent uses TinyFish live on real payer web pages to answer two operator questions:

1. Is this chart ready for submission?
2. What is the correct payer precertification route?

## Recording checklist

- Keep the run raw and lightly edited
- Show the app UI and live logs together
- Mention that the patient chart is synthetic and contains no PII
- Mention that both web steps are powered by the TinyFish API

## Suggested talk track

1. Open with the pain

Say: "Clinic staff still read payer policy pages by hand and then search for the right prior-auth channel. Clinic Ops Agent automates both steps."

2. Explain why TinyFish is required

Say: "This is real browser work on insurer websites. It is not a chatbot and it is not a static API integration."

3. Introduce the case

Say: "This is a synthetic lumbar MRI case. The question is whether the chart meets the payer policy and how staff should proceed next."

4. Start the run

Click `Run live readiness and contact lookup`.

5. Narrate the first TinyFish workflow

Point out:
- TinyFish opens the Aetna policy page
- extracts evidence requirements
- the app compares those requirements with chart evidence

6. Narrate the second TinyFish workflow

Point out:
- TinyFish opens Aetna's public contact page
- finds the provider precertification route
- returns the contact details into the operator packet

7. Close on the business outcome

Say: "Instead of making staff manually read policy language and search the payer site, the agent returns a submission-readiness verdict and the exact next channel to use."

## Best final frame

End on the operator handoff packet and say:

"Clinic Ops Agent turns messy payer website research into a live clinical ops handoff."
