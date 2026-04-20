function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function toBase64Utf8(value) {
  return Buffer.from(clean(value, 20000), 'utf-8').toString('base64');
}

export function buildEpicDocumentReference(packet = {}) {
  const caseId = clean(packet.case_id || packet.caseId || 'UNKNOWN-CASE', 120);
  const procedure = clean(packet.procedure, 240) || 'Prior authorization request';
  const diagnosis = clean(packet.diagnosis, 300);
  const payer = clean(packet.payer_name || packet.payerName, 120) || 'Unknown payer';
  const summary = clean(packet.readiness_summary || packet.summary || packet.recommended_action || 'submission prep packet', 3000);

  const narrative = [
    `Case: ${caseId}`,
    `Payer: ${payer}`,
    `Procedure: ${procedure}`,
    diagnosis ? `Diagnosis: ${diagnosis}` : '',
    `Submission readiness: ${packet.submission_ready ? 'ready' : 'collecting evidence'}`,
    `Recommended action: ${clean(packet.recommended_action || 'collect_missing_evidence', 120)}`,
    `Summary: ${summary}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    resourceType: 'DocumentReference',
    status: 'current',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11506-3',
          display: 'Progress note',
        },
      ],
      text: 'AuthPilot submission prep packet',
    },
    description: `AuthPilot submission prep for ${procedure}`,
    date: new Date().toISOString(),
    subject: {
      identifier: {
        system: 'urn:authpilot:case-id',
        value: caseId,
      },
    },
    author: [
      {
        display: 'AuthPilot AI',
      },
    ],
    content: [
      {
        attachment: {
          contentType: 'text/plain; charset=utf-8',
          title: `${caseId}-submission-prep.txt`,
          data: toBase64Utf8(narrative),
        },
      },
    ],
  };
}

export function validateDocumentReferenceSchema(docRef = {}) {
  const errors = [];

  if (docRef.resourceType !== 'DocumentReference') {
    errors.push('resourceType must be DocumentReference');
  }

  if (!clean(docRef.status)) {
    errors.push('status is required');
  }

  if (!Array.isArray(docRef.content) || docRef.content.length === 0) {
    errors.push('content must include at least one attachment');
  }

  const attachment = docRef.content?.[0]?.attachment;
  if (!attachment) {
    errors.push('attachment is required');
  } else {
    if (!clean(attachment.contentType)) errors.push('attachment.contentType is required');
    if (!clean(attachment.data)) errors.push('attachment.data is required');
  }

  if (!clean(docRef.subject?.identifier?.value)) {
    errors.push('subject.identifier.value is required');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
