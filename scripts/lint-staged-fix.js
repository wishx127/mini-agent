#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

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

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    encoding: 'utf-8',
  });
  return output.trim().split('\n').filter(Boolean);
}

function filterByExtension(files, extensions) {
  return files.filter((file) => {
    const ext = file.split('.').pop();
    return extensions.includes(ext);
  });
}

function runCommand(command, files) {
  if (files.length === 0) return { success: true, output: '' };

  const fileList = files.map((f) => `"${f}"`).join(' ');
  const fullCommand = `${command} ${fileList}`;

  try {
    const output = execSync(fullCommand, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

function runEslintFix(files) {
  if (files.length === 0)
    return { success: true, output: '', hasUnfixedErrors: false };

  const fileList = files.map((f) => `"${f}"`).join(' ');
  const command = `npx eslint ${fileList} --fix`;

  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output, hasUnfixedErrors: false };
  } catch (error) {
    const output = error.stdout || '';
    const hasUnfixedErrors =
      output.includes('error') || output.includes('warning');
    return {
      success: !hasUnfixedErrors,
      output,
      error: error.stderr || '',
      hasUnfixedErrors,
    };
  }
}

function runPrettierFix(files) {
  if (files.length === 0) return { success: true, output: '' };

  const fileList = files.map((f) => `"${f}"`).join(' ');
  const command = `npx prettier --write ${fileList}`;

  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message,
    };
  }
}

function runStylelintFix(files) {
  if (files.length === 0)
    return { success: true, output: '', hasUnfixedErrors: false };

  const fileList = files.map((f) => `"${f}"`).join(' ');
  const command = `npx stylelint ${fileList} --fix`;

  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output, hasUnfixedErrors: false };
  } catch (error) {
    const output = error.stdout || '';
    const hasUnfixedErrors =
      output.includes('Error') || output.includes('error');
    return {
      success: !hasUnfixedErrors,
      output,
      error: error.stderr || '',
      hasUnfixedErrors,
    };
  }
}

function stageFiles(files) {
  if (files.length === 0) return;

  const fileList = files.map((f) => `"${f}"`).join(' ');
  execSync(`git add ${fileList}`, { encoding: 'utf-8' });
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
  const styleFiles = filterByExtension(stagedFiles, ['less', 'css']);
  const otherFiles = filterByExtension(stagedFiles, ['json', 'md']);

  let hasErrors = false;
  const fixedFiles = [];

  if (jsTsFiles.length > 0) {
    log('📝 Checking JavaScript/TypeScript files...', 'blue');

    const eslintResult = runEslintFix(jsTsFiles);
    if (eslintResult.output) {
      console.log(eslintResult.output);
    }

    if (eslintResult.hasUnfixedErrors) {
      hasErrors = true;
      log('\n❌ ESLint found errors that cannot be auto-fixed.', 'red');
      log('   Please fix the errors above and commit again.\n', 'yellow');
    } else if (eslintResult.success) {
      fixedFiles.push(...jsTsFiles);
    }

    const prettierResult = runPrettierFix(jsTsFiles);
    if (!prettierResult.success) {
      log('\n❌ Prettier formatting failed for some files.', 'red');
      console.log(prettierResult.error);
      hasErrors = true;
    }
  }

  if (styleFiles.length > 0) {
    log('\n🎨 Checking style files...', 'blue');

    const stylelintResult = runStylelintFix(styleFiles);
    if (stylelintResult.output) {
      console.log(stylelintResult.output);
    }

    if (stylelintResult.hasUnfixedErrors) {
      hasErrors = true;
      log('\n❌ Stylelint found errors that cannot be auto-fixed.', 'red');
      log('   Please fix the errors above and commit again.\n', 'yellow');
    } else if (stylelintResult.success) {
      fixedFiles.push(...styleFiles);
    }

    const prettierResult = runPrettierFix(styleFiles);
    if (!prettierResult.success) {
      log('\n❌ Prettier formatting failed for some files.', 'red');
      console.log(prettierResult.error);
      hasErrors = true;
    }
  }

  if (otherFiles.length > 0) {
    log('\n📄 Formatting other files (JSON, Markdown)...', 'blue');

    const prettierResult = runPrettierFix(otherFiles);
    if (!prettierResult.success) {
      log('\n❌ Prettier formatting failed for some files.', 'red');
      console.log(prettierResult.error);
      hasErrors = true;
    }
  }

  const allCheckedFiles = [...jsTsFiles, ...styleFiles, ...otherFiles];
  if (allCheckedFiles.length > 0) {
    stageFiles(allCheckedFiles);
    log('\n✅ Fixed files have been staged.', 'green');
  }

  if (hasErrors) {
    log('\n❌ Commit aborted due to lint errors.', 'red');
    log('   Fix the errors above and try again.\n', 'yellow');
    process.exit(1);
  }

  log('\n✅ All checks passed! Proceeding with commit.\n', 'green');
  process.exit(0);
}

main();
