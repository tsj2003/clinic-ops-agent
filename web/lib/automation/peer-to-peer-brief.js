import { detectDeniedSignal } from './combat-brief.js';

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export function derivePeerToPeerPayload(run = {}, body = {}) {
  const explicitReason = clean(body?.denialReason, 1000);
  const explicitStatus = clean(body?.denialStatus, 120).toUpperCase();
  const payerReferenceId = clean(
    body?.payerReferenceId ||
      run?.operatorPacket?.emr_sync?.payer_reference_id ||
      run?.emrSync?.payer_reference_id,
    120,
  );

  const fallbackReason = clean(
    run?.operatorPacket?.emr_sync?.message ||
      run?.emrSync?.message ||
      run?.failureReason ||
      run?.failure?.message,
    1000,
  );

  const fallbackStatus = clean(
    run?.operatorPacket?.emr_sync?.status || run?.emrSync?.status || run?.caseLifecycle?.status,
    120,
  ).toUpperCase();

  const denialReason = explicitReason || fallbackReason;
  const denialStatus = explicitStatus || fallbackStatus;

  return {
    denialReason,
    denialStatus,
    payerReferenceId,
    applicable: detectDeniedSignal({
      status: denialStatus,
      subject: denialReason,
      text: denialReason,
    }),
  };
}
