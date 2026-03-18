#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, '.husky');
const LOG_FILE = path.join(LOG_DIR, 'pre-commit-tests.log');

function formatDate(date) {
  return date.toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runTests() {
  ensureDir(LOG_DIR);

  const timestamp = formatDate(new Date());
  const startMsg = `[pre-commit] ${timestamp} running tests\n`;

  let output = startMsg;

  try {
    execSync('npm test', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    output += '\n[pre-commit] Tests passed';
    fs.writeFileSync(LOG_FILE, output);
    console.log('[pre-commit] Tests passed');
  } catch (error) {
    output += error.stdout?.toString() || '';
    output += error.stderr?.toString() || '';
    fs.writeFileSync(LOG_FILE, output);

    console.error('[pre-commit] Tests failed. See log:', LOG_FILE);
    console.error('[pre-commit] Full output:');

    const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
    console.error(logContent);

    process.exit(1);
  }
}

runTests();
