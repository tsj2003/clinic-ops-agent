import path from 'path';
import { spawn } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function withOverride(value, fallback) {
  return value && value.trim() ? value.trim() : fallback;
}

function maybeAssignEnv(target, key, value) {
  if (value && value.trim()) {
    target[key] = value.trim();
  }
}

export async function GET(request) {
  const encoder = new TextEncoder();
  const projectRoot = path.resolve(process.cwd(), '..');
  const runnerPath = path.join(projectRoot, 'stream_runner.py');
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const { searchParams } = new URL(request.url);

  const childEnv = {
    ...process.env,
  };

  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_NAME',
    withOverride(searchParams.get('workflowName'), process.env.TINYFISH_WORKFLOW_NAME || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_URL',
    withOverride(searchParams.get('workflowUrl'), process.env.TINYFISH_WORKFLOW_URL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_GOAL',
    withOverride(searchParams.get('workflowGoal'), process.env.TINYFISH_WORKFLOW_GOAL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_NAME',
    withOverride(searchParams.get('contactWorkflowName'), process.env.TINYFISH_CONTACT_WORKFLOW_NAME || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_URL',
    withOverride(searchParams.get('contactWorkflowUrl'), process.env.TINYFISH_CONTACT_WORKFLOW_URL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_GOAL',
    withOverride(searchParams.get('contactWorkflowGoal'), process.env.TINYFISH_CONTACT_WORKFLOW_GOAL || ''),
  );

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let sawComplete = false;
      const proc = spawn(pythonBin, [runnerPath], {
        cwd: projectRoot,
        env: childEnv,
      });

      let buffer = '';

      const sendPayload = (payload) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      const flushLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || isClosed) return;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'complete') {
            sawComplete = true;
          }
          sendPayload(parsed);
        } catch {
          sendPayload({
            type: 'log',
            channel: 'execution',
            level: 'info',
            id: `raw-${Date.now()}`,
            index: 0,
            totalSteps: 0,
            time: new Date().toLocaleTimeString([], { hour12: false }),
            text: trimmed,
          });
        }
      };

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(flushLine);
      });

      proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (!msg || isClosed) return;
        sendPayload({
          type: 'log',
          channel: 'execution',
          level: 'error',
          id: `stderr-${Date.now()}`,
          index: 0,
          totalSteps: 0,
          time: new Date().toLocaleTimeString([], { hour12: false }),
          text: msg,
        });
      });

      proc.on('close', () => {
        if (isClosed) {
          return;
        }
        if (buffer.trim()) {
          flushLine(buffer);
        }
        isClosed = true;
        try {
          if (!sawComplete) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`));
          }
          controller.close();
        } catch {}
      });
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
