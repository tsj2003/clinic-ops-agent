#!/usr/bin/env node
// Portable test runner: discovers *.test.mjs files recursively under tests/
// and spawns `node --test <files...>`. Avoids reliance on shell globbing or
// Node version-specific --test glob support.

import { readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(__dirname);
const testsDir = join(webRoot, 'tests');

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    console.error(`[run-tests] cannot read ${dir}: ${error.message}`);
    process.exit(2);
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walk(fullPath));
    } else if (entry.endsWith('.test.mjs')) {
      out.push(fullPath);
    }
  }
  return out;
}

const files = walk(testsDir).sort();
if (files.length === 0) {
  console.error(`[run-tests] no *.test.mjs files found under ${testsDir}`);
  process.exit(1);
}

console.log(`[run-tests] discovered ${files.length} test files`);
for (const f of files) {
  console.log(`  - ${relative(webRoot, f)}`);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: webRoot,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-tests] exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
