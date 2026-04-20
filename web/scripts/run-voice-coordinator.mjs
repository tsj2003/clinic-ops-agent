import { buildVoiceStatusSystemPrompt, placeVoiceStatusCheckCall, runVoiceCoordinator } from '../lib/automation/voice-agent.js';

function clean(value, max = 240) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

const callbackUrl = clean(process.env.VOICE_STATUS_CALLBACK_URL, 1200);
const clinicName = clean(process.env.CLINIC_NAME || 'Clinic', 120);

const outcome = await runVoiceCoordinator({
  triggerCall: async (run) => {
    const authId = clean(run?.operatorPacket?.case_id || run?.appRunId, 120);
    const prompt = buildVoiceStatusSystemPrompt({
      clinicName,
      patientLastName: clean(run?.intake?.lastName || run?.operatorPacket?.last_name, 120),
      npi: clean(process.env.CLINIC_NPI, 40),
      authId,
    });

    const call = await placeVoiceStatusCheckCall({
      payerPhoneNumber: clean(
        run?.operatorPacket?.provider_precert_phone ||
          run?.artifact?.contactResult?.provider_precert_phone ||
          process.env.VOICE_PAYER_PHONE_DEFAULT,
        40,
      ),
      fromPhoneNumber: clean(process.env.TWILIO_PHONE_NUMBER, 30),
      statusCallbackUrl: callbackUrl,
      clinicName,
      authId,
    });

    return {
      dispatched: true,
      callSid: call.callSid,
      status: call.status,
      promptPreview: prompt,
    };
  },
});

console.info('[voice-coordinator]', JSON.stringify(outcome));

const hardFail = clean(process.env.VOICE_COORDINATOR_HARD_FAIL, 10).toLowerCase() === 'true';
if (hardFail && !outcome.results.some((item) => item.dispatched)) {
  process.exit(1);
}
