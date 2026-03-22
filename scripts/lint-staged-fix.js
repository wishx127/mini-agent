#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function splitNullDelimited(text) {
  if (!text) return [];
  return text.split('\0').filter(Boolean);
}

function getStagedFiles() {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: 'utf-8' }
  );
  return splitNullDelimited(output);
}

function filterByExtension(files, extensions) {
  const extSet = new Set(extensions.map((e) => e.toLowerCase()));
  return files.filter((file) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    return extSet.has(ext);
  });
}

function chunkFiles(files, chunkSize = 50) {
  const chunks = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }
  return chunks;
}

function resolveBin(name) {
  const binName = process.platform === 'win32' ? `${name}.cmd` : name;
  const localBin = path.join(process.cwd(), 'node_modules', '.bin', binName);
  return existsSync(localBin) ? localBin : null;
}

function runTool(tool, baseArgs, files) {
  if (files.length === 0) return { success: true, output: '' };
  const toolPath = resolveBin(tool);
  if (!toolPath) {
    return {
      success: false,
      output: '',
      error: `${tool} is not installed. Please add it to devDependencies.`,
    };
  }

  let combinedOutput = '';
  let combinedError = '';
  let success = true;

  for (const group of chunkFiles(files)) {
    try {
      const output = execFileSync(toolPath, [...baseArgs, ...group], {
        encoding: 'utf-8',
        stdio: 'pipe',
        shell: process.platform === 'win32', // 在Windows上使用shell执行
      });
      if (output) combinedOutput += output;
    } catch (error) {
      success = false;
      combinedOutput += error.stdout || '';
      combinedError += error.stderr || error.message || '';
    }
  }

  return { success, output: combinedOutput, error: combinedError };
}

function runEslintFix(files) {
  const result = runTool('eslint', ['--fix', '--max-warnings=0'], files);
  return {
    ...result,
    hasUnfixedErrors: !result.success,
  };
}

function runPrettierFix(files) {
  return runTool('prettier', ['--write', '--log-level', 'warn'], files);
}

function runStylelintFix(files) {
  const result = runTool('stylelint', ['--fix', '--allow-empty-input'], files);
  return {
    ...result,
    hasUnfixedErrors: !result.success,
  };
}

function formatDurationMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function stageFiles(files) {
  if (files.length === 0) return;
  execFileSync('git', ['add', '--', ...files], { encoding: 'utf-8' });
}

function main() {
  log('\n🔍 Running pre-commit checks...\n', 'cyan');

  const stagedFiles = getStagedFiles();

  if (stagedFiles.length === 0) {
    log('No staged files to check.', 'yellow');
    process.exit(0);
  }

  const jsTsFiles = filterByExtension(stagedFiles, [
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
  ]);
  const styleFiles = filterByExtension(stagedFiles, ['less', 'css', 'scss']);
  const otherFiles = filterByExtension(stagedFiles, ['json', 'md']);

  let hasErrors = false;
  const totalStart = nowMs();

  if (jsTsFiles.length > 0) {
    log('📝 Checking JavaScript/TypeScript files...', 'blue');

    const eslintStart = nowMs();
    const eslintResult = runEslintFix(jsTsFiles);
    const eslintCost = nowMs() - eslintStart;
    if (eslintResult.output) console.log(eslintResult.output);
    if (!eslintResult.success) {
      hasErrors = true;
      log('\n❌ ESLint found errors that cannot be auto-fixed.', 'red');
      if (eslintResult.error) console.log(eslintResult.error);
      log('   Fix the errors above and commit again.\n', 'yellow');
    }
    log(
      `⏱ ESLint: ${formatDurationMs(eslintCost)} (files: ${jsTsFiles.length})`,
      'cyan'
    );

    const prettierStart = nowMs();
    const prettierResult = runPrettierFix(jsTsFiles);
    const prettierCost = nowMs() - prettierStart;
    if (!prettierResult.success) {
      hasErrors = true;
      log('\n❌ Prettier formatting failed for some files.', 'red');
      if (prettierResult.error) console.log(prettierResult.error);
    }
    log(
      `⏱ Prettier(JS/TS): ${formatDurationMs(prettierCost)} (files: ${jsTsFiles.length})`,
      'cyan'
    );
  }

  if (styleFiles.length > 0) {
    log('\n🎨 Checking style files...', 'blue');

    const stylelintStart = nowMs();
    const stylelintResult = runStylelintFix(styleFiles);
    const stylelintCost = nowMs() - stylelintStart;
    if (stylelintResult.output) console.log(stylelintResult.output);
    if (!stylelintResult.success) {
      hasErrors = true;
      log('\n❌ Stylelint found errors that cannot be auto-fixed.', 'red');
      if (stylelintResult.error) console.log(stylelintResult.error);
      log('   Fix the errors above and commit again.\n', 'yellow');
    }
    log(
      `⏱ Stylelint: ${formatDurationMs(stylelintCost)} (files: ${styleFiles.length})`,
      'cyan'
    );

    const prettierStart = nowMs();
    const prettierResult = runPrettierFix(styleFiles);
    const prettierCost = nowMs() - prettierStart;
    if (!prettierResult.success) {
      hasErrors = true;
      log('\n❌ Prettier formatting failed for some files.', 'red');
      if (prettierResult.error) console.log(prettierResult.error);
    }
    log(
      `⏱ Prettier(Style): ${formatDurationMs(prettierCost)} (files: ${styleFiles.length})`,
      'cyan'
    );
  }

  if (otherFiles.length > 0) {
    log('\n📄 Formatting other files (JSON, Markdown)...', 'blue');

    const prettierStart = nowMs();
    const prettierResult = runPrettierFix(otherFiles);
    const prettierCost = nowMs() - prettierStart;
    if (!prettierResult.success) {
      hasErrors = true;
      log('\n❌ Prettier formatting failed for some files.', 'red');
      if (prettierResult.error) console.log(prettierResult.error);
    }
    log(
      `⏱ Prettier(Other): ${formatDurationMs(prettierCost)} (files: ${otherFiles.length})`,
      'cyan'
    );
  }

  const allCheckedFiles = [...jsTsFiles, ...styleFiles, ...otherFiles];
  if (allCheckedFiles.length > 0) {
    stageFiles(allCheckedFiles);
    log('\n✅ Fixed files have been staged.', 'green');
  }

  const totalCost = nowMs() - totalStart;
  log(
    `\n⏱ Total: ${formatDurationMs(totalCost)} (files: ${allCheckedFiles.length})`,
    'cyan'
  );

  if (hasErrors) {
    log('\n❌ Commit aborted due to lint errors.', 'red');
    process.exit(1);
  }

  log('\n✅ All checks passed! Proceeding with commit.\n', 'green');
  process.exit(0);
}

main();
