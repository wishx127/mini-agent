/**
 * Git 操作工具实现
 */

import { ErrorCode, ErrorType, ToolError } from '../command-security/types.js';
import { createConfirmationError } from '../command-security/dangerous-patterns.js';

import { GitExecutor } from './git-executor.js';
import {
  GitCloneOptions,
  GitStatusOptions,
  GitBranchOptions,
  GitCommitOptions,
  GitPushOptions,
  GitPullOptions,
  GitLogOptions,
  GitResetOptions,
  GitCleanOptions,
  GitStatusResult,
  GitBranchInfo,
  GitCommitInfo,
} from './types.js';

// 克隆操作超时 120 秒
const CLONE_TIMEOUT = 120000;

/**
 * Git 克隆
 */
export async function gitClone(
  options: GitCloneOptions
): Promise<{ success: boolean; data?: { path: string }; error?: ToolError }> {
  const executor = new GitExecutor('clone', options.timeout || CLONE_TIMEOUT);

  const args = ['clone'];

  if (options.branch) {
    args.push('--branch', options.branch);
  }

  if (options.depth) {
    args.push('--depth', options.depth.toString());
  }

  args.push(options.url);

  if (options.directory) {
    args.push(options.directory);
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  return {
    success: true,
    data: {
      path:
        options.directory ||
        options.url.split('/').pop()?.replace('.git', '') ||
        '',
    },
  };
}

/**
 * Git 状态
 */
export async function gitStatus(
  options: GitStatusOptions = {}
): Promise<{ success: boolean; data?: GitStatusResult; error?: ToolError }> {
  const executor = new GitExecutor('status');

  // 获取状态
  const statusResult = await executor.execute(['status', '--porcelain', '-b'], {
    cwd: options.cwd,
  });

  if (!statusResult.success) {
    const error = GitExecutor.parseGitError(
      statusResult.stderr,
      statusResult.exitCode
    );
    return { success: false, error };
  }

  // 解析状态输出
  const lines = statusResult.stdout.split('\n');
  const branchLine = lines.find((line) => line.startsWith('##'));

  let branch = 'unknown';
  let ahead = 0;
  let behind = 0;

  if (branchLine) {
    const match = branchLine.match(
      /##\s+([^.\s]+)(?:\.\.\.[^[]+)?(?:\[ahead\s+(\d+),?\s*behind\s+(\d+)?\])?/
    );
    if (match) {
      branch = match[1];
      ahead = parseInt(match[2] || '0', 10);
      behind = parseInt(match[3] || '0', 10);
    }
  }

  const modified: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith('##') || !line.trim()) continue;

    const status = line.substring(0, 2);
    const file = line.substring(3);

    if (status[0] !== ' ' && status[0] !== '?') {
      staged.push(file);
    }

    if (status[1] !== ' ') {
      if (status[1] === '?') {
        untracked.push(file);
      } else {
        modified.push(file);
      }
    }
  }

  return {
    success: true,
    data: {
      branch,
      modified,
      staged,
      untracked,
      ahead,
      behind,
    },
  };
}

/**
 * Git 分支操作
 */
export async function gitBranch(
  options: GitBranchOptions
): Promise<{ success: boolean; data?: unknown; error?: ToolError }> {
  const executor = new GitExecutor('branch');

  switch (options.action) {
    case 'list': {
      const result = await executor.execute(['branch', '-a'], {
        cwd: options.cwd,
      });

      if (!result.success) {
        const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
        return { success: false, error };
      }

      const branches: GitBranchInfo[] = result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const current = line.startsWith('*');
          const name = line.replace(/^\*?\s*/, '').trim();
          return {
            name,
            current,
            remote: name.startsWith('remotes/') ? name : undefined,
          };
        });

      return { success: true, data: { branches } };
    }

    case 'create': {
      if (!options.name) {
        return {
          success: false,
          error: {
            code: ErrorCode.GIT_BRANCH_NOT_FOUND,
            message: 'Branch name is required',
            type: ErrorType.GIT,
            retryable: false,
          },
        };
      }

      const result = await executor.execute(['checkout', '-b', options.name], {
        cwd: options.cwd,
      });

      if (!result.success) {
        const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
        return { success: false, error };
      }

      return { success: true, data: { branch: options.name } };
    }

    case 'switch': {
      if (!options.name) {
        return {
          success: false,
          error: {
            code: ErrorCode.GIT_BRANCH_NOT_FOUND,
            message: 'Branch name is required',
            type: ErrorType.GIT,
            retryable: false,
          },
        };
      }

      const result = await executor.execute(['checkout', options.name], {
        cwd: options.cwd,
      });

      if (!result.success) {
        const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
        return { success: false, error };
      }

      return { success: true, data: { branch: options.name } };
    }

    case 'delete': {
      if (!options.name) {
        return {
          success: false,
          error: {
            code: ErrorCode.GIT_BRANCH_NOT_FOUND,
            message: 'Branch name is required',
            type: ErrorType.GIT,
            retryable: false,
          },
        };
      }

      const args = ['branch', '-d'];
      if (options.force) {
        args[1] = '-D';
      }
      args.push(options.name);

      const result = await executor.execute(args, { cwd: options.cwd });

      if (!result.success) {
        const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
        return { success: false, error };
      }

      return {
        success: true,
        data: { deleted: options.name, stdout: result.stdout },
      };
    }

    default:
      return {
        success: false,
        error: {
          code: ErrorCode.GIT_BRANCH_NOT_FOUND,
          message: `Unknown action: ${String(options.action)}`,
          type: ErrorType.GIT,
          retryable: false,
        },
      };
  }
}

/**
 * Git 提交
 */
export async function gitCommit(
  options: GitCommitOptions
): Promise<{ success: boolean; data?: { hash: string }; error?: ToolError }> {
  const executor = new GitExecutor('commit');

  if (!options.message || !options.message.trim()) {
    return {
      success: false,
      error: {
        code: ErrorCode.GIT_UNCOMMITTED_CHANGES,
        message: 'Commit message cannot be empty',
        type: ErrorType.GIT,
        retryable: false,
      },
    };
  }

  // 先检查是否有需要提交的更改
  const statusResult = await executor.execute(['status', '--porcelain'], {
    cwd: options.cwd,
  });

  if (statusResult.success && !statusResult.stdout.trim()) {
    // 工作目录干净，没有需要提交的更改
    return {
      success: true,
      data: { hash: '' },
    };
  }

  if (options.files && options.files.length > 0) {
    const addResult = await executor.execute(['add', ...options.files], {
      cwd: options.cwd,
    });

    if (!addResult.success) {
      const error = GitExecutor.parseGitError(
        addResult.stderr,
        addResult.exitCode
      );
      return { success: false, error };
    }
  } else if (options.all) {
    const addResult = await executor.execute(['add', '-A'], {
      cwd: options.cwd,
    });

    if (!addResult.success) {
      const error = GitExecutor.parseGitError(
        addResult.stderr,
        addResult.exitCode
      );
      return { success: false, error };
    }
  } else {
    // 用户调用了 commit 但未指定 files 和 all 参数，
    // 且工作区有更改（否则前面已返回）。
    // 此时自动暂存所有更改以匹配用户的提交意图。
    const autoAddResult = await executor.execute(['add', '-A'], {
      cwd: options.cwd,
    });
    if (!autoAddResult.success) {
      const error = GitExecutor.parseGitError(
        autoAddResult.stderr,
        autoAddResult.exitCode
      );
      return { success: false, error };
    }
  }

  // 再次检查是否有已暂存的更改需要提交
  const stagedResult = await executor.execute(
    ['diff', '--cached', '--name-only'],
    { cwd: options.cwd }
  );

  if (stagedResult.success && !stagedResult.stdout.trim()) {
    // 没有已暂存的更改，无需提交
    return {
      success: true,
      data: { hash: '' },
    };
  }

  // 处理多行提交信息：分割成多行，使用多个 -m 参数
  // 这样可以确保每行都被正确处理，特别是在 Windows shell 中
  // 过滤掉完全为空的行（避免 git commit -m "" 在 Windows 上解析错误）
  const messageLines = options.message
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const commitArgs: string[] = ['commit'];
  for (const line of messageLines) {
    commitArgs.push('-m', line);
  }

  const result = await executor.execute(commitArgs, {
    cwd: options.cwd,
  });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  const hashMatch = result.stdout.match(/\[.+\s+([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : '';

  return { success: true, data: { hash } };
}

/**
 * Git 推送
 */
export async function gitPush(
  options: GitPushOptions = {}
): Promise<{ success: boolean; data?: unknown; error?: ToolError }> {
  // 检查是否需要确认
  if (options.force && !options.confirmed) {
    return {
      success: false,
      error: createConfirmationError({
        operation: 'git push --force',
        command: `git push ${options.force ? '--force ' : ''}${options.remote || 'origin'} ${options.branch || ''}`,
        risks: [
          'Will overwrite remote branch history',
          'Other collaborators may lose commits',
          'Cannot be undone',
        ],
        alternatives: [
          'Use regular push after pulling changes',
          'Use git reflog to recover lost commits',
        ],
      }),
    };
  }

  const executor = new GitExecutor('push');

  const args = ['push'];

  if (options.force) {
    args.push('--force');
  }

  args.push(options.remote || 'origin');

  if (options.branch) {
    args.push(options.branch);
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  return { success: true, data: { pushed: true } };
}

/**
 * Git 拉取
 */
export async function gitPull(
  options: GitPullOptions = {}
): Promise<{ success: boolean; data?: unknown; error?: ToolError }> {
  const executor = new GitExecutor('pull');

  const args = ['pull'];

  if (options.remote) {
    args.push(options.remote);
  }

  if (options.branch) {
    args.push(options.branch);
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  return { success: true, data: { pulled: true } };
}

/**
 * Git 日志
 */
export async function gitLog(options: GitLogOptions = {}): Promise<{
  success: boolean;
  data?: { commits: GitCommitInfo[] };
  error?: ToolError;
}> {
  const executor = new GitExecutor('log');

  const args = ['log', '--pretty=format:%H|%an|%ad|%s', '--date=iso'];

  if (options.limit) {
    args.push(`-${options.limit}`);
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  const commits: GitCommitInfo[] = result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split('|');
      return {
        hash: parts[0] || '',
        shortHash: (parts[0] || '').substring(0, 7),
        author: parts[1] || '',
        date: parts[2] || '',
        message: parts[3] || '',
      };
    });

  return { success: true, data: { commits } };
}

/**
 * Git 重置
 */
export async function gitReset(
  options: GitResetOptions
): Promise<{ success: boolean; data?: unknown; error?: ToolError }> {
  // 检查是否需要确认
  if (options.mode === 'hard' && !options.confirmed) {
    return {
      success: false,
      error: createConfirmationError({
        operation: 'git reset --hard',
        command: `git reset --hard ${options.target || 'HEAD'}`,
        risks: [
          'Will discard all uncommitted changes',
          'Will discard all untracked files',
          'Cannot be undone',
        ],
        alternatives: [
          'Use git stash to save changes temporarily',
          'Use git reset --soft to keep changes staged',
          'Use git reset --mixed to keep changes unstaged',
        ],
      }),
    };
  }

  const executor = new GitExecutor('reset');

  const args = ['reset', `--${options.mode}`];

  if (options.target) {
    args.push(options.target);
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  return { success: true, data: { reset: true } };
}

/**
 * Git 清理
 */
export async function gitClean(options: GitCleanOptions = {}): Promise<{
  success: boolean;
  data?: { files: string[] };
  error?: ToolError;
}> {
  // 检查是否需要确认
  if ((options.force || options.directories) && !options.confirmed) {
    return {
      success: false,
      error: createConfirmationError({
        operation: 'git clean',
        command: `git clean ${options.force ? '-f' : ''}${options.directories ? 'd' : ''}`,
        risks: [
          'Will permanently delete untracked files',
          options.directories
            ? 'Will permanently delete untracked directories'
            : '',
          'Cannot be undone',
        ].filter(Boolean),
        alternatives: [
          'Use git clean -n (dry run) to preview files first',
          'Manually backup important files before cleaning',
        ],
      }),
    };
  }

  const executor = new GitExecutor('clean');

  // 先执行 dry-run 获取将要删除的文件列表
  const dryRunArgs = ['clean', '-n'];
  if (options.directories) {
    dryRunArgs.push('-d');
  }

  const dryRunResult = await executor.execute(dryRunArgs, { cwd: options.cwd });

  const files: string[] = dryRunResult.stdout
    .split('\n')
    .filter((line) => line.startsWith('Would remove'))
    .map((line) => line.replace('Would remove ', '').trim());

  // 如果是 dry-run 模式，只返回文件列表
  if (options.dryRun) {
    return { success: true, data: { files } };
  }

  // 执行清理
  const args = ['clean'];

  if (options.force) {
    args.push('-f');
  }

  if (options.directories) {
    args.push('-d');
  }

  const result = await executor.execute(args, { cwd: options.cwd });

  if (!result.success) {
    const error = GitExecutor.parseGitError(result.stderr, result.exitCode);
    return { success: false, error };
  }

  return { success: true, data: { files } };
}
