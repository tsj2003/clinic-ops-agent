import fs from 'fs/promises';
import path from 'path';

import { processClinicalRecord } from '../ai/fireworks-client.js';
import { redactFreeText } from '../privacy.js';

const DEFAULT_INBOX_DOMAIN = 'agentmail.to';
const RUN_INBOX_PREFIX = 'auth-';
const DEFAULT_REPLY_ANALYZER_MODEL = 'accounts/fireworks/models/llama-v3p1-405b-instruct';
const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';

const PAYER_REPLY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requestedDocument', 'emrReferenceNumber', 'autoReplyDraft'],
  properties: {
    requestedDocument: { type: 'string' },
    emrReferenceNumber: { type: 'string' },
    urgency: { type: 'string' },
    autoReplyDraft: { type: 'string' },
  },
};

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeEmail(value) {
  return clean(value, 240).toLowerCase();
}

function parseJson(value) {
  const text = clean(value, 200_000);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function toIsoNow() {
  return new Date().toISOString();
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function sanitizeRunToken(runId = '') {
  return clean(runId, 120)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function sanitizeRunUsername(runId = '') {
  const token = sanitizeRunToken(runId);
  if (!token) {
    return '';
  }
  const available = Math.max(1, 60 - RUN_INBOX_PREFIX.length);
  return `${RUN_INBOX_PREFIX}${token.slice(0, available)}`;
}

function stripInboxPrefix(value = '') {
  const normalized = clean(value, 120).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith(RUN_INBOX_PREFIX)) {
    return normalized.slice(RUN_INBOX_PREFIX.length);
  }
  return normalized;
}

function normalizeMessageAddress(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return normalizeEmail(value.replace(/^.*<([^>]+)>.*$/, '$1'));
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = normalizeMessageAddress(item);
      if (candidate) {
        return candidate;
      }
    }
    return '';
  }

  if (typeof value === 'object') {
    return normalizeEmail(value.email || value.address || value.value || '');
  }

  return '';
}

export function buildRunInboxAddress(runId = '', domain = '') {
  const username = sanitizeRunUsername(runId);
  const normalizedDomain = clean(domain || process.env.AGENTMAIL_INBOX_DOMAIN || DEFAULT_INBOX_DOMAIN, 200).toLowerCase();
  if (!username || !normalizedDomain) {
    return '';
  }
  return `${username}@${normalizedDomain}`;
}

export function extractRunIdFromEmailAddress(address = '') {
  const normalized = normalizeEmail(address);
  const local = normalized.split('@')[0] || '';
  if (!local) {
    return '';
  }
  return stripInboxPrefix(local.replace(/\+.*$/, ''));
}

export async function createAgentMailClient() {
  const apiKey = clean(process.env.AGENTMAIL_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('AGENTMAIL_API_KEY is required for AgentMail automation.');
  }

  const sdk = await dynamicImport('agentmail');
  const AgentMailClient = sdk?.AgentMailClient || sdk?.default?.AgentMailClient || sdk?.default;
  if (!AgentMailClient) {
    throw new Error('AgentMail SDK is unavailable.');
  }

  return new AgentMailClient({ apiKey });
}

export async function ensureRunInbox({ runId = '', displayName = '' } = {}) {
  const runToken = sanitizeRunToken(runId);
  const username = sanitizeRunUsername(runId);
  if (!runToken || !username) {
    throw new Error('runId is required to provision AgentMail inbox.');
  }

  const client = await createAgentMailClient();
  const domain = clean(process.env.AGENTMAIL_INBOX_DOMAIN || DEFAULT_INBOX_DOMAIN, 200).toLowerCase();

  try {
    const inbox = await client.inboxes.create({
      username,
      domain,
      displayName: clean(displayName || `AuthPilot Run ${runToken}`, 120),
      clientId: runToken,
    });

    return {
      inboxId: clean(inbox?.inboxId || inbox?.id, 120),
      email: normalizeEmail(inbox?.email || buildRunInboxAddress(runToken, domain)),
      created: true,
    };
  } catch (error) {
    return {
      inboxId: '',
      email: buildRunInboxAddress(runToken, domain),
      created: false,
      warning: error instanceof Error ? clean(error.message, 500) : 'Unable to create AgentMail inbox.',
    };
  }
}

export async function provisionRunInbox(runId = '') {
  return ensureRunInbox({ runId });
}

export function normalizeInboundWebhookPayload(payload = {}) {
  const root = asObject(payload);
  const data = asObject(root.data);
  const message = asObject(data.message?.data ? data.message.data : data.message || root.message || data);

  const toAddress = normalizeMessageAddress(
    message.to || message.envelopeTo || message.recipient || data.to || root.to || root.recipient,
  );
  const fromAddress = normalizeMessageAddress(
    message.from || message.envelopeFrom || data.from || root.from,
  );

  const normalized = {
    eventType: clean(root.eventType || root.type || data.type || data.eventType, 120),
    inboxId: clean(
      message.inboxId || data.inboxId || data.inbox_id || root.inboxId || root.inbox_id,
      120,
    ),
    messageId: clean(
      message.messageId || data.messageId || data.message_id || root.messageId || root.message_id,
      120,
    ),
    threadId: clean(message.threadId || data.threadId || data.thread_id || root.threadId || root.thread_id, 120),
    subject: clean(message.subject || data.subject || root.subject, 500),
    text: redactFreeText(clean(
      message.extractedText || message.text || data.extractedText || data.text || root.text || root.body,
      20_000,
    ), { maxLength: 20_000 }),
    from: fromAddress,
    to: toAddress,
    runId: clean(root.runId || data.runId || data.run_id || extractRunIdFromEmailAddress(toAddress), 120),
  };

  return normalized;
}

export async function analyzePayerReplyWithFireworks({
  subject = '',
  text = '',
  from = '',
  runId = '',
} = {}) {
  const apiKey = clean(process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is required for payer reply analysis.');
  }

  const model = clean(process.env.FIREWORKS_REPLY_ANALYZER_MODEL || DEFAULT_REPLY_ANALYZER_MODEL, 200);
  const requestText = redactFreeText(clean(text, 30_000), { maxLength: 30_000 });

  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PayerAdditionalInfoRequestSchema',
          strict: true,
          schema: PAYER_REPLY_JSON_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are an autonomous payer liaison for prior authorization operations.',
            'Extract the requested additional document and the EMR reference number from payer email text.',
            'Return concise, compliant response text for payer follow-up.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Run ID: ${clean(runId, 120) || 'unknown'}`,
            `Payer sender: ${clean(from, 240) || 'unknown'}`,
            `Subject: ${clean(subject, 500)}`,
            `Email text:\n${requestText}`,
          ].join('\n\n'),
        },
      ],
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);
  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.message || 'Payer reply analysis failed.', 500));
  }

  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    '{}';

  const parsed = parseJson(content);
  return {
    requestedDocument: clean(parsed.requestedDocument, 300),
    emrReferenceNumber: clean(parsed.emrReferenceNumber, 120),
    urgency: clean(parsed.urgency, 80),
    autoReplyDraft: redactFreeText(clean(parsed.autoReplyDraft, 8000)),
    modelUsed: model,
  };
}

export async function buildMissingDocumentAttachment({ run = {}, requestedDocument = '' } = {}) {
  const fromPilotVault = await findPilotVaultAttachment({ requestedDocument, runId: run?.appRunId || '' });
  if (fromPilotVault) {
    return fromPilotVault;
  }

  const { generateClinicalJustificationPdf } = await import('./clinical-pdf.js');
  const generated = await generateClinicalJustificationPdf(run);
  const bytes = await fs.readFile(generated.absolutePath);
  const base64 = bytes.toString('base64');

  return {
    filename: clean(
      requestedDocument
        ? `${requestedDocument.replace(/[^a-z0-9._-]+/gi, '_').toLowerCase()}.pdf`
        : generated.fileName || 'clinical-justification.pdf',
      180,
    ),
    contentType: 'application/pdf',
    content: base64,
    absolutePath: clean(generated.absolutePath, 2000),
  };
}

function resolvePilotVaultDir() {
  return clean(process.env.PILOT_VAULT_DIR || '/pilot-vault', 2000);
}

function mimeTypeForExtension(filePath = '') {
  const ext = path.extname(clean(filePath, 400).toLowerCase());
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function tokenizeRequestedDocument(value = '') {
  return clean(value, 300)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
}

async function listFilesRecursive(dir, depth = 0, maxDepth = 4) {
  if (!dir || depth > maxDepth) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isFile()) {
      files.push(absolutePath);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath, depth + 1, maxDepth)));
    }
  }

  return files;
}

async function findPilotVaultAttachment({ requestedDocument = '', runId = '' } = {}) {
  const pilotVaultDir = resolvePilotVaultDir();
  if (!pilotVaultDir) {
    return null;
  }

  try {
    const stats = await fs.stat(pilotVaultDir);
    if (!stats.isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  const runToken = clean(runId, 120).toLowerCase();
  const requestedTokens = tokenizeRequestedDocument(requestedDocument);
  const files = await listFilesRecursive(pilotVaultDir);

  const scored = files
    .map((absolutePath) => {
      const normalized = absolutePath.toLowerCase();
      let score = 0;

      if (runToken && normalized.includes(runToken)) {
        score += 8;
      }
      for (const token of requestedTokens) {
        if (normalized.includes(token)) {
          score += 4;
        }
      }

      return {
        absolutePath,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return null;
  }

  const bytes = await fs.readFile(best.absolutePath);
  return {
    filename: clean(path.basename(best.absolutePath), 180),
    contentType: mimeTypeForExtension(best.absolutePath),
    content: bytes.toString('base64'),
    absolutePath: clean(best.absolutePath, 2000),
    source: 'pilot-vault',
  };
}

export async function replyToPayerMessage({
  inboxId = '',
  messageId = '',
  to = '',
  replyText = '',
  attachment = null,
} = {}) {
  const normalizedInboxId = clean(inboxId, 120);
  const normalizedMessageId = clean(messageId, 120);
  if (!normalizedInboxId || !normalizedMessageId) {
    throw new Error('inboxId and messageId are required to reply to payer email.');
  }

  const client = await createAgentMailClient();

  const response = await client.inboxes.messages.reply(normalizedInboxId, normalizedMessageId, {
    text: clean(replyText, 10_000),
    ...(normalizeEmail(to) ? { to: [normalizeEmail(to)] } : {}),
    ...(attachment
      ? {
          attachments: [
            {
              filename: clean(attachment.filename, 180),
              contentType: clean(attachment.contentType || 'application/pdf', 120),
              content: clean(attachment.content, 20_000_000),
            },
          ],
        }
      : {}),
  });

  return {
    ok: true,
    sentAt: toIsoNow(),
    messageId: clean(response?.messageId || response?.id, 120),
  };
}

export async function runVisionAssistedDocumentCheck({ imageBase64 = '' } = {}) {
  if (!clean(imageBase64, 10_000)) {
    return null;
  }

  try {
    return await processClinicalRecord({ imageBase64 });
  } catch {
    return null;
  }
}
