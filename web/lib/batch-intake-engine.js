import { createHash } from 'crypto';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function cleanState(value) {
  return clean(value, 8).toUpperCase();
}

function normalizeKey(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

const INTERNAL_FIELDS = [
  'patientId',
  'firstName',
  'lastName',
  'dob',
  'memberId',
  'procedureCode',
  'procedureLabel',
  'serviceDate',
  'diagnosis',
  'chartSummary',
  'payerName',
  'lineOfBusiness',
  'memberState',
  'specialty',
  'departmentId',
  'organizationId',
  'practiceId',
  'caseLabel',
  'policyPageUrl',
  'contactPageUrl',
  'evidenceFiles',
];

const FIELD_ALIASES = {
  patientId: ['patientid', 'patid', 'patient', 'patientnumber', 'mrn'],
  firstName: ['firstname', 'fname', 'givenname', 'patientfirstname'],
  lastName: ['lastname', 'lname', 'familyname', 'patientlastname'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthdt'],
  memberId: ['memberid', 'member', 'membernumber', 'memberno', 'member#', 'subscriberid', 'subscribernumber'],
  procedureCode: ['procedurecode', 'proccode', 'cpt', 'cptcode'],
  procedureLabel: ['procedure', 'procedurelabel', 'servicedescription', 'service'],
  serviceDate: ['servicedate', 'dateofservice', 'dos', 'scheduleddate'],
  diagnosis: ['diagnosis', 'dx', 'dxcode', 'icd', 'icd10', 'primarydiagnosis'],
  chartSummary: ['chartsummary', 'clinicalsummary', 'clinicals', 'clinicalnotes', 'summary', 'note'],
  payerName: ['payer', 'payername', 'insurance', 'planname'],
  lineOfBusiness: ['lineofbusiness', 'lob', 'plan', 'businessline'],
  memberState: ['memberstate', 'state', 'region'],
  specialty: ['specialty', 'serviceline', 'departmentname'],
  departmentId: ['departmentid', 'deptid', 'department'],
  organizationId: ['organizationid', 'orgid', 'facilityid'],
  practiceId: ['practiceid', 'practice', 'clinicid', 'tenantid'],
  caseLabel: ['caselabel', 'caseid', 'referralid', 'orderid'],
  policyPageUrl: ['policypageurl', 'policyurl', 'policypage'],
  contactPageUrl: ['contactpageurl', 'contacturl', 'routeurl'],
  evidenceFiles: ['evidencefiles', 'attachments', 'files', 'filelist'],
};

function parseCsvRecords(rawText) {
  const text = clean(rawText, 3_000_000);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSV file must include a header row and at least one data row.');
  }

  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  const records = rows.map((values) => {
    const mapped = {};
    headers.forEach((header, index) => {
      mapped[header] = values[index] || '';
    });
    return mapped;
  });

  return { headers, records };
}

function parseJsonRecords(rawText) {
  const parsed = JSON.parse(clean(rawText, 3_000_000));

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : Array.isArray(parsed?.cases)
        ? parsed.cases
        : Array.isArray(parsed?.data)
          ? parsed.data
          : [parsed];

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  return { headers, records: rows };
}

function pickFieldFromRecord(record = {}, sourceHeader = '') {
  if (!sourceHeader) {
    return '';
  }

  if (Object.prototype.hasOwnProperty.call(record, sourceHeader)) {
    return record[sourceHeader];
  }

  const target = normalizeKey(sourceHeader);
  const key = Object.keys(record).find((candidate) => normalizeKey(candidate) === target);
  return key ? record[key] : '';
}

export function inferHeaderMapping(headers = [], overrides = {}) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeKey(header),
  }));

  const mapping = {};

  for (const field of INTERNAL_FIELDS) {
    const override = clean(overrides[field], 120);
    if (override) {
      mapping[field] = override;
      continue;
    }

    const candidates = (FIELD_ALIASES[field] || []).map((alias) => normalizeKey(alias));
    const exact = normalizedHeaders.find((header) => header.normalized === normalizeKey(field));
    if (exact) {
      mapping[field] = exact.original;
      continue;
    }

    const fuzzy = normalizedHeaders.find((header) => candidates.includes(header.normalized));
    if (fuzzy) {
      mapping[field] = fuzzy.original;
    }
  }

  return mapping;
}

export function mapRecordToAuthPilotSchema(record = {}, mapping = {}) {
  const raw = {};
  for (const field of INTERNAL_FIELDS) {
    raw[field] = pickFieldFromRecord(record, mapping[field]);
  }

  return {
    patientId: clean(raw.patientId, 120),
    firstName: clean(raw.firstName, 120),
    lastName: clean(raw.lastName, 120),
    dob: clean(raw.dob, 40),
    memberId: clean(raw.memberId, 120),
    procedureCode: clean(raw.procedureCode, 120),
    procedureLabel: clean(raw.procedureLabel, 220),
    serviceDate: clean(raw.serviceDate, 40),
    diagnosis: clean(raw.diagnosis, 240),
    chartSummary: clean(raw.chartSummary, 6000),
    payerName: clean(raw.payerName, 120),
    lineOfBusiness: clean(raw.lineOfBusiness, 120),
    memberState: cleanState(raw.memberState),
    specialty: clean(raw.specialty, 120),
    departmentId: clean(raw.departmentId, 120),
    organizationId: clean(raw.organizationId, 120),
    practiceId: clean(raw.practiceId, 120),
    caseLabel: clean(raw.caseLabel, 120),
    policyPageUrl: clean(raw.policyPageUrl, 500),
    contactPageUrl: clean(raw.contactPageUrl, 500),
    evidenceFiles: clean(raw.evidenceFiles, 1200),
  };
}

export function parseBatchInput({ rawText = '', formatHint = '', mappingOverrides = {} } = {}) {
  const hint = clean(formatHint, 20).toLowerCase();
  const asCsv =
    hint === 'csv' ||
    (!hint && clean(rawText, 100).includes(',') && !clean(rawText, 100).trimStart().startsWith('{') && !clean(rawText, 100).trimStart().startsWith('['));

  const parsed = asCsv ? parseCsvRecords(rawText) : parseJsonRecords(rawText);
  if (!parsed.records?.length) {
    throw new Error('No rows found in uploaded batch file.');
  }

  const mapping = inferHeaderMapping(parsed.headers, mappingOverrides);
  const rows = parsed.records.map((record, index) => ({
    index,
    source: record,
    normalized: mapRecordToAuthPilotSchema(record, mapping),
  }));

  return {
    format: asCsv ? 'csv' : 'json',
    headers: parsed.headers,
    mapping,
    rows,
  };
}

export function buildBatchIdempotencyKey({
  memberId = '',
  procedureCode = '',
  serviceDate = '',
  practiceId = '',
} = {}) {
  const raw = [
    clean(practiceId, 120).toLowerCase(),
    clean(memberId, 120).toLowerCase(),
    clean(procedureCode, 120).toLowerCase(),
    clean(serviceDate, 40).toLowerCase(),
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

export function listInternalBatchFields() {
  return [...INTERNAL_FIELDS];
}

export function getFuzzyDictionary() {
  return {
    ...FIELD_ALIASES,
  };
}
