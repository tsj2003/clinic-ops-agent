function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function cleanState(value) {
  return clean(value, 8).toUpperCase();
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

function normalizeIntakeRow(input = {}) {
  const diagnosis =
    clean(input.diagnosis || input.dx || input.icd10 || input.icd || input.primaryDiagnosis, 300) || '';

  return {
    payerName: clean(input.payerName || input.payer || input.payer_name, 120),
    lineOfBusiness: clean(input.lineOfBusiness || input.lob || input.line_of_business, 120),
    memberState: cleanState(input.memberState || input.state || input.member_state),
    specialty: clean(input.specialty || input.serviceLine || input.service_line, 120),
    procedureLabel: clean(input.procedureLabel || input.procedure || input.cpt || input.procedure_code, 220),
    diagnosis,
    caseLabel: clean(input.caseLabel || input.caseId || input.case_id || input.patientCaseId, 120),
    policyPageUrl: clean(input.policyPageUrl || input.policy_url || input.policyUrl, 500),
    contactPageUrl: clean(input.contactPageUrl || input.contact_url || input.contactUrl, 500),
    chartSummary: clean(input.chartSummary || input.chart_summary || input.clinicalSummary || input.clinical_summary, 4000),
    evidenceFiles: clean(input.evidenceFiles || input.evidence_files || input.attachments, 1000),
  };
}

function missingRequiredFields(row) {
  const missing = [];
  if (!row.payerName) missing.push('payerName');
  if (!row.procedureLabel) missing.push('procedureLabel');
  if (!row.diagnosis) missing.push('diagnosis');
  if (!row.chartSummary) missing.push('chartSummary');
  return missing;
}

export function parseCsvIntake(rawText) {
  const text = clean(rawText, 500_000);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSV intake must include a header row and at least one data row.');
  }

  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => splitCsvLine(line));

  return rows.map((values) => {
    const mapped = {};
    header.forEach((key, index) => {
      mapped[key] = values[index] || '';
    });
    return mapped;
  });
}

function mapFhirEntryResource(resource = {}) {
  if (!resource || typeof resource !== 'object') {
    return {};
  }

  const coding = Array.isArray(resource.code?.coding) ? resource.code.coding[0] || {} : {};
  const diagnosis = Array.isArray(resource.reasonCode) && resource.reasonCode[0]?.text ? resource.reasonCode[0].text : '';

  return {
    procedure: resource.code?.text || coding.display || coding.code || '',
    diagnosis,
    chart_summary: clean(resource.note?.[0]?.text || resource.description || '', 4000),
    case_id: clean(resource.id || '', 120),
  };
}

function parseJsonBatch(rawText) {
  const parsed = JSON.parse(rawText);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.cases)) {
    return parsed.cases;
  }

  if (parsed?.resourceType === 'Bundle' && Array.isArray(parsed.entry)) {
    return parsed.entry.map((entry) => mapFhirEntryResource(entry?.resource || {}));
  }

  return [parsed];
}

export function parseBatchIntake(rawText, formatHint = '') {
  const text = clean(rawText, 500_000);
  if (!text) {
    throw new Error('Import file is empty.');
  }

  const hint = clean(formatHint, 16).toLowerCase();

  let records = [];
  if (hint === 'csv' || (!hint && text.includes(',') && !text.trimStart().startsWith('{') && !text.trimStart().startsWith('['))) {
    records = parseCsvIntake(text);
  } else {
    records = parseJsonBatch(text);
  }

  if (!Array.isArray(records) || !records.length) {
    throw new Error('No intake records were found in the imported file.');
  }

  const rows = records.map((record, index) => {
    const normalized = normalizeIntakeRow(record);
    const missing = missingRequiredFields(normalized);
    return {
      index,
      normalized,
      valid: missing.length === 0,
      missing,
    };
  });

  return {
    total: rows.length,
    valid: rows.filter((row) => row.valid).length,
    invalid: rows.filter((row) => !row.valid).length,
    rows,
  };
}
