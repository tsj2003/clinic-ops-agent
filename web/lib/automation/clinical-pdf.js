import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getScopedDataDir } from '@/lib/data-scope';

function clean(value, max = 3000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function escapePdfText(value) {
  return clean(value, 3000).replace(/[()\\]/g, (char) => `\\${char}`);
}

function toSafeSlug(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function pdfFromLines(lines = []) {
  const contentLines = lines.filter(Boolean);
  const textOps = contentLines
    .map((line, index) => `${index === 0 ? 'BT\n/F1 11 Tf\n1 0 0 1 40 760 Tm' : 'T*'}\n(${escapePdfText(line)}) Tj`)
    .join('\n');

  const stream = `${textOps}\nET`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];

  let offset = 9;
  const body = [];
  const xref = ['0000000000 65535 f '];

  for (const object of objects) {
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    body.push(object);
    offset += object.length + 1;
  }

  const xrefStart = offset;
  const trailer = [
    `xref\n0 ${objects.length + 1}`,
    ...xref,
    `trailer << /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefStart}`,
    '%%EOF',
  ].join('\n');

  return `%PDF-1.4\n${body.join('\n')}\n${trailer}\n`;
}

async function ensurePdfDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(getScopedDataDir(moduleDir), 'automation', 'clinical-pdf');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function generateClinicalJustificationPdf(run = {}) {
  const packet = run?.operatorPacket || {};
  const caseId = clean(packet.case_id || run?.workflow?.caseId || run?.appRunId || 'case', 120);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${toSafeSlug(caseId)}-${timestamp}.pdf`;
  const dir = await ensurePdfDir();
  const absolutePath = path.join(dir, fileName);

  const lines = [
    'AuthPilot Clinical Justification',
    `Case ID: ${caseId}`,
    `Payer: ${clean(packet.payer_name || '', 120)}`,
    `Member ID: ${clean(packet.member_id || run?.intake?.memberId || '', 120)}`,
    `Procedure Code: ${clean(packet.procedure_code || run?.intake?.procedureCode || '', 120)}`,
    `Service Date: ${clean(packet.service_date || run?.intake?.serviceDate || '', 40)}`,
    `Diagnosis: ${clean(packet.diagnosis || run?.intake?.diagnosis || '', 200)}`,
    `Summary: ${clean(packet.readiness_summary || run?.readiness?.summary || '', 900)}`,
  ];

  const pdf = pdfFromLines(lines);
  await fs.writeFile(absolutePath, pdf, 'utf-8');

  return {
    absolutePath,
    fileName,
  };
}
