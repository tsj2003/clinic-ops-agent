import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteWorkspace, listWorkspaces, saveWorkspace } from '../lib/workspace-store.js';

const testWorkspaceId = `ws-test-${Date.now()}`;

test('saveWorkspace persists a valid workspace profile', async () => {
  const result = await saveWorkspace({
    id: testWorkspaceId,
    clinicName: 'Test Spine Clinic',
    config: {
      workflowName: 'Aetna MRI readiness',
      workflowUrl: 'https://www.aetna.com/policy',
    },
    intake: {
      payerName: 'Aetna',
      procedureLabel: 'Lumbar MRI',
      diagnosis: 'M54.5',
    },
  });

  assert.ok(result.workspace);
  assert.equal(result.workspace.id, testWorkspaceId);
  assert.equal(result.workspace.clinicName, 'Test Spine Clinic');
});

test('listWorkspaces includes saved workspace profile', async () => {
  const result = await listWorkspaces(50);
  const found = result.workspaces.find((workspace) => workspace.id === testWorkspaceId);
  assert.ok(found);
  assert.equal(found.clinicName, 'Test Spine Clinic');
});

test('deleteWorkspace removes saved workspace profile', async () => {
  const deleted = await deleteWorkspace(testWorkspaceId);
  assert.equal(deleted.deleted, true);

  const result = await listWorkspaces(50);
  const found = result.workspaces.find((workspace) => workspace.id === testWorkspaceId);
  assert.equal(found, undefined);
});
