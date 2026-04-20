import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealedSelectorDiff,
  classifyTestFailure,
} from '../lib/automation/testsprite-auto-heal.js';

test('classifyTestFailure identifies selector breakage as portal layout changed', () => {
  const result = classifyTestFailure({
    code: 'selector_not_found',
    message: 'Timeout waiting for selector button#submitAuth',
    selector: 'button#submitAuth',
  });

  assert.equal(result.type, 'portal_layout_changed');
  assert.equal(result.emrStatus, 'PORTAL_LAYOUT_CHANGED');
  assert.equal(result.lifecycleStatus, 'portal_layout_changed');
});

test('classifyTestFailure identifies member validation issues as data errors', () => {
  const result = classifyTestFailure({
    message: 'Invalid member ID for this payer',
  });

  assert.equal(result.type, 'data_error');
  assert.equal(result.emrStatus, 'SUBMITTED_PENDING_DATA_FIX');
});

test('buildHealedSelectorDiff includes previous and healed selector values', () => {
  const diff = buildHealedSelectorDiff({
    elementKey: 'form.submit',
    healedSelector: 'button[data-test="prior-auth-submit"]',
  });

  assert.equal(diff.elementKey, 'form.submit');
  assert.match(diff.oldSelector, /Submit|Send/i);
  assert.equal(diff.healedSelector, 'button[data-test="prior-auth-submit"]');
});
