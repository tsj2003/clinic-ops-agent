import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAthenaFirstWritePrototype,
  buildEpicSubmitAttachmentPrototype,
  runConnectorPrototype,
  validateConnectorPrototypePayload,
} from '../lib/connector-prototype.js';

test('buildEpicSubmitAttachmentPrototype creates a FHIR Parameters request', () => {
  const packet = {
    case_id: 'CASE-EPIC-1',
    payer_name: 'Aetna',
    procedure: 'Lumbar MRI',
    diagnosis: 'M54.16',
    submission_ready: true,
  };

  const epic = {
    baseUrl: 'https://fhir.epic.example/R4',
    endpointPath: '/DocumentReference/$submit-attachment',
    accessToken: 'epic-token',
  };

  const preview = buildEpicSubmitAttachmentPrototype({ packet, epic });

  assert.equal(preview.connector, 'epic');
  assert.equal(preview.request.method, 'POST');
  assert.match(preview.request.url, /submit-attachment/i);
  assert.equal(preview.request.body.resourceType, 'Parameters');
  assert.equal(preview.schemaCheck.ok, true);
});

test('buildAthenaFirstWritePrototype creates clinical-document and task chain', () => {
  const packet = {
    case_id: 'CASE-ATHENA-1',
    procedure: 'Knee arthroscopy',
    practice_id: '195900',
    patient_id: '12345',
  };

  const athena = {
    baseUrl: 'https://api.athenahealth.example',
    accessToken: 'athena-token',
    assigneeRole: 'Authorization Coordinator',
  };

  const preview = buildAthenaFirstWritePrototype({ packet, athena });

  assert.equal(preview.connector, 'athena');
  assert.equal(preview.requestChain.length, 2);
  assert.match(preview.requestChain[0].url, /clinicaldocument/i);
  assert.match(preview.requestChain[1].url, /\/tasks$/i);
  assert.equal(preview.prerequisites.requiresPracticeId, true);
  assert.equal(preview.prerequisites.requiresPatientId, true);
});

test('validateConnectorPrototypePayload enforces packet and athena IDs', () => {
  const invalid = validateConnectorPrototypePayload({ connector: 'athena', packet: { case_id: '1' } });
  assert.equal(invalid.ok, false);

  const valid = validateConnectorPrototypePayload({
    connector: 'athena',
    packet: { case_id: '1' },
    athena: { practiceId: '100', patientId: '200' },
  });
  assert.equal(valid.ok, true);
});

test('runConnectorPrototype dry-run returns both connector previews', async () => {
  const result = await runConnectorPrototype({
    connector: 'both',
    dryRun: true,
    packet: {
      case_id: 'CASE-DRY-1',
      payer_name: 'Aetna',
      procedure: 'Lumbar MRI',
      diagnosis: 'M54.16',
      practice_id: '195900',
      patient_id: '12345',
    },
    athena: {
      practiceId: '195900',
      patientId: '12345',
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.previews.length, 2);
  const connectorSet = new Set(result.previews.map((preview) => preview.connector));
  assert.equal(connectorSet.has('epic'), true);
  assert.equal(connectorSet.has('athena'), true);
});

test('validateConnectorPrototypePayload supports mode=live and operator tracking', () => {
  const result = validateConnectorPrototypePayload({
    mode: 'live',
    connector: 'epic',
    operatorId: 'user-42',
    packetId: 'CASE-200',
    packet: {
      case_id: 'CASE-200',
      payer_name: 'Aetna',
      procedure: 'Lumbar MRI',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.mode, 'live');
  assert.equal(result.data.dryRun, false);
  assert.equal(result.data.operatorId, 'user-42');
  assert.equal(result.data.packetId, 'CASE-200');
});
