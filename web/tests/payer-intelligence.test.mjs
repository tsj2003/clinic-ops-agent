import test from 'node:test';
import assert from 'node:assert/strict';

import { getPayerProcedureSuggestion } from '../lib/payer-intelligence.js';

test('routes Anthem imaging workflows to Carelon', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Blue Shield of California',
    specialty: 'Ortho',
    procedureLabel: 'Shoulder MRI',
  });

  assert.equal(result?.payer?.key, 'blue-shield-california');
  assert.equal(result?.routingStrategy?.vendorKey, 'carelon');
  assert.equal(result?.suggestedPortalName, 'Carelon ProviderPortal');
});

test('routes Cigna advanced imaging to eviCore', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Cigna',
    specialty: 'Spine',
    procedureLabel: 'Cervical MRI',
  });

  assert.equal(result?.payer?.key, 'cigna');
  assert.equal(result?.routingStrategy?.vendorKey, 'evicore');
  assert.match(result?.routeNote || '', /evicore/i);
});

test('routes Humana musculoskeletal surgery to Cohere', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Humana Medicare',
    specialty: 'Ortho',
    procedureLabel: 'Total knee arthroplasty',
  });

  assert.equal(result?.payer?.key, 'humana');
  assert.equal(result?.routingStrategy?.vendorKey, 'cohere');
  assert.equal(result?.suggestedPortalName, 'Cohere Health Provider Hub');
});

test('keeps generic BCBS plans cautious instead of over-claiming a vendor', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Blue Shield',
    specialty: 'Spine',
    procedureLabel: 'Lumbar MRI (CPT 72148)',
  });

  assert.equal(result?.payer?.key, 'bcbs-federation');
  assert.equal(result?.routingStrategy?.mode, 'plan_lookup_then_vendor');
  assert.equal(result?.routingStrategy?.confidence, 'low');
});

test('routes Ambetter Texas imaging to Evolent RadMD', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Ambetter',
    lineOfBusiness: 'Marketplace',
    memberState: 'TX',
    specialty: 'Imaging',
    procedureLabel: 'Lumbar MRI (CPT 72148)',
  });

  assert.equal(result?.payer?.key, 'centene-ambetter');
  assert.equal(result?.routingStrategy?.vendorKey, 'evolent');
  assert.equal(result?.suggestedPortalName, 'Evolent RadMD');
});

test('routes Ambetter Texas musculoskeletal surgery to TurningPoint', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Ambetter',
    lineOfBusiness: 'Marketplace',
    memberState: 'TX',
    specialty: 'Ortho',
    procedureLabel: 'Total knee arthroplasty',
  });

  assert.equal(result?.payer?.key, 'centene-ambetter');
  assert.equal(result?.routingStrategy?.vendorKey, 'turningpoint');
  assert.equal(result?.suggestedPortalName, 'TurningPoint Provider Portal');
});

test('uses Ohio Community Plan override for UHC Medicaid', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'UnitedHealthcare Community Plan',
    lineOfBusiness: 'Medicaid',
    memberState: 'OH',
    specialty: 'Spine',
    procedureLabel: 'CT Spine',
  });

  assert.equal(result?.payer?.key, 'unitedhealthcare');
  assert.equal(result?.selectedLineOfBusiness, 'Medicaid');
  assert.equal(result?.selectedState, 'Ohio');
  assert.match(result?.suggestedContactUrl || '', /oh-cp-prior-auth/i);
});

test('uses Illinois Aetna Better Health override for Medicaid', () => {
  const result = getPayerProcedureSuggestion({
    payerName: 'Aetna Better Health',
    lineOfBusiness: 'Medicaid',
    memberState: 'IL',
    specialty: 'Spine',
    procedureLabel: 'Cervical MRI',
  });

  assert.equal(result?.payer?.key, 'aetna');
  assert.equal(result?.routingStrategy?.mode, 'state_specific_plan');
  assert.match(result?.suggestedContactUrl || '', /aetnabetterhealth\.com\/illinois\/providers\/prior-auth/i);
});
