const ALLOWED_STATUSES = new Set([
  'prospect',
  'discovery',
  'proposal_sent',
  'verbal_committed',
  'signed_active',
  'on_hold',
  'closed_lost',
]);

const ALLOWED_REVIEW_DAYS = new Set([
  '',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function clean(value, max = 240) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function cleanLower(value, max = 64) {
  return clean(value, max).toLowerCase();
}

function cleanStatus(value) {
  const normalized = cleanLower(value, 64).replace(/\s+/g, '_');
  return ALLOWED_STATUSES.has(normalized) ? normalized : '';
}

function isValidEmail(value) {
  const input = clean(value, 220);
  if (!input) {
    return true;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

function isValidIsoDate(input) {
  const value = clean(input, 32);
  if (!value) {
    return true;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidHttpUrl(value) {
  const input = clean(value, 500);
  if (!input) {
    return true;
  }

  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parsePercent(input) {
  const value = clean(input, 20);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parsePositiveNumber(input) {
  const value = clean(input, 20);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function normalizeCreateData(body) {
  return {
    id: clean(body.id, 120),
    clinicName: clean(body.clinicName, 120),
    lane: clean(body.lane, 120),
    championName: clean(body.championName, 120),
    championEmail: cleanLower(body.championEmail, 220),
    status: cleanStatus(body.status) || 'prospect',
    targetStartDate: clean(body.targetStartDate, 32),
    baselineDenialRatePercent: clean(body.baselineDenialRatePercent, 20),
    baselineDaysToAuth: clean(body.baselineDaysToAuth, 20),
    currentDenialRatePercent: clean(body.currentDenialRatePercent, 20),
    currentDaysToAuth: clean(body.currentDaysToAuth, 20),
    currentHoursSavedPerCase: clean(body.currentHoursSavedPerCase, 20),
    currentRecoveredRevenueUsd: clean(body.currentRecoveredRevenueUsd, 20),
    signedAt: clean(body.signedAt, 32),
    signedEvidenceUrl: clean(body.signedEvidenceUrl, 500),
    weeklyReviewDay: cleanLower(body.weeklyReviewDay, 40),
    nextStep: clean(body.nextStep, 220),
    notes: clean(body.notes, 4000),
    lastContactAt: clean(body.lastContactAt, 64),
  };
}

function normalizePatchData(body) {
  return {
    id: clean(body.id, 120),
    clinicName: clean(body.clinicName, 120),
    lane: clean(body.lane, 120),
    championName: clean(body.championName, 120),
    championEmail: cleanLower(body.championEmail, 220),
    status: cleanStatus(body.status),
    targetStartDate: clean(body.targetStartDate, 32),
    baselineDenialRatePercent: clean(body.baselineDenialRatePercent, 20),
    baselineDaysToAuth: clean(body.baselineDaysToAuth, 20),
    currentDenialRatePercent: clean(body.currentDenialRatePercent, 20),
    currentDaysToAuth: clean(body.currentDaysToAuth, 20),
    currentHoursSavedPerCase: clean(body.currentHoursSavedPerCase, 20),
    currentRecoveredRevenueUsd: clean(body.currentRecoveredRevenueUsd, 20),
    signedAt: clean(body.signedAt, 32),
    signedEvidenceUrl: clean(body.signedEvidenceUrl, 500),
    weeklyReviewDay: cleanLower(body.weeklyReviewDay, 40),
    nextStep: clean(body.nextStep, 220),
    notes: clean(body.notes, 4000),
    lastContactAt: clean(body.lastContactAt, 64),
  };
}

export function validatePilotCommitmentCreatePayload(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'POST body must be a JSON object.' };
  }

  const data = normalizeCreateData(body);

  if (!data.clinicName) {
    return { ok: false, message: 'clinicName is required.' };
  }

  if (!isValidEmail(data.championEmail)) {
    return { ok: false, message: 'championEmail must be a valid email address.' };
  }

  if (!isValidIsoDate(data.targetStartDate)) {
    return { ok: false, message: 'targetStartDate must be YYYY-MM-DD.' };
  }

  if (!ALLOWED_REVIEW_DAYS.has(data.weeklyReviewDay)) {
    return { ok: false, message: 'weeklyReviewDay must be a valid weekday.' };
  }

  const denialRate = parsePercent(data.baselineDenialRatePercent);
  if (denialRate !== null && (denialRate < 0 || denialRate > 100)) {
    return { ok: false, message: 'baselineDenialRatePercent must be between 0 and 100.' };
  }

  const daysToAuth = parsePositiveNumber(data.baselineDaysToAuth);
  if (daysToAuth !== null && (daysToAuth < 0 || daysToAuth > 365)) {
    return { ok: false, message: 'baselineDaysToAuth must be between 0 and 365.' };
  }

  const currentDenial = parsePercent(data.currentDenialRatePercent);
  if (currentDenial !== null && (currentDenial < 0 || currentDenial > 100)) {
    return { ok: false, message: 'currentDenialRatePercent must be between 0 and 100.' };
  }

  const currentDays = parsePositiveNumber(data.currentDaysToAuth);
  if (currentDays !== null && (currentDays < 0 || currentDays > 365)) {
    return { ok: false, message: 'currentDaysToAuth must be between 0 and 365.' };
  }

  const currentHours = parsePositiveNumber(data.currentHoursSavedPerCase);
  if (currentHours !== null && (currentHours < 0 || currentHours > 24)) {
    return { ok: false, message: 'currentHoursSavedPerCase must be between 0 and 24.' };
  }

  const currentRevenue = parsePositiveNumber(data.currentRecoveredRevenueUsd);
  if (currentRevenue !== null && (currentRevenue < 0 || currentRevenue > 10000000)) {
    return { ok: false, message: 'currentRecoveredRevenueUsd must be between 0 and 10000000.' };
  }

  if (!isValidIsoDate(data.signedAt)) {
    return { ok: false, message: 'signedAt must be YYYY-MM-DD.' };
  }

  if (!isValidHttpUrl(data.signedEvidenceUrl)) {
    return { ok: false, message: 'signedEvidenceUrl must be a valid http(s) URL.' };
  }

  return { ok: true, data };
}

export function validatePilotCommitmentPatchPayload(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'PATCH body must be a JSON object.' };
  }

  const data = normalizePatchData(body);
  const suppliedStatus = clean(body.status, 64);
  if (!data.id) {
    return { ok: false, message: 'id is required.' };
  }

  if (suppliedStatus && !data.status) {
    return { ok: false, message: 'status is invalid.' };
  }

  const hasWritableField = [
    data.clinicName,
    data.lane,
    data.championName,
    data.championEmail,
    data.status,
    data.targetStartDate,
    data.baselineDenialRatePercent,
    data.baselineDaysToAuth,
    data.currentDenialRatePercent,
    data.currentDaysToAuth,
    data.currentHoursSavedPerCase,
    data.currentRecoveredRevenueUsd,
    data.signedAt,
    data.signedEvidenceUrl,
    data.weeklyReviewDay,
    data.nextStep,
    data.notes,
    data.lastContactAt,
  ].some(Boolean);

  if (!hasWritableField) {
    return { ok: false, message: 'At least one writable field is required.' };
  }

  if (!isValidEmail(data.championEmail)) {
    return { ok: false, message: 'championEmail must be a valid email address.' };
  }

  if (!isValidIsoDate(data.targetStartDate)) {
    return { ok: false, message: 'targetStartDate must be YYYY-MM-DD.' };
  }

  if (!ALLOWED_REVIEW_DAYS.has(data.weeklyReviewDay)) {
    return { ok: false, message: 'weeklyReviewDay must be a valid weekday.' };
  }

  const denialRate = parsePercent(data.baselineDenialRatePercent);
  if (denialRate !== null && (denialRate < 0 || denialRate > 100)) {
    return { ok: false, message: 'baselineDenialRatePercent must be between 0 and 100.' };
  }

  const daysToAuth = parsePositiveNumber(data.baselineDaysToAuth);
  if (daysToAuth !== null && (daysToAuth < 0 || daysToAuth > 365)) {
    return { ok: false, message: 'baselineDaysToAuth must be between 0 and 365.' };
  }

  const currentDenial = parsePercent(data.currentDenialRatePercent);
  if (currentDenial !== null && (currentDenial < 0 || currentDenial > 100)) {
    return { ok: false, message: 'currentDenialRatePercent must be between 0 and 100.' };
  }

  const currentDays = parsePositiveNumber(data.currentDaysToAuth);
  if (currentDays !== null && (currentDays < 0 || currentDays > 365)) {
    return { ok: false, message: 'currentDaysToAuth must be between 0 and 365.' };
  }

  const currentHours = parsePositiveNumber(data.currentHoursSavedPerCase);
  if (currentHours !== null && (currentHours < 0 || currentHours > 24)) {
    return { ok: false, message: 'currentHoursSavedPerCase must be between 0 and 24.' };
  }

  const currentRevenue = parsePositiveNumber(data.currentRecoveredRevenueUsd);
  if (currentRevenue !== null && (currentRevenue < 0 || currentRevenue > 10000000)) {
    return { ok: false, message: 'currentRecoveredRevenueUsd must be between 0 and 10000000.' };
  }

  if (!isValidIsoDate(data.signedAt)) {
    return { ok: false, message: 'signedAt must be YYYY-MM-DD.' };
  }

  if (!isValidHttpUrl(data.signedEvidenceUrl)) {
    return { ok: false, message: 'signedEvidenceUrl must be a valid http(s) URL.' };
  }

  return { ok: true, id: data.id, patch: data };
}
