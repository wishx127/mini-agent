/**
 * Git 操作工具
 * 提供安全的 Git 版本控制操作能力
 */

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import {
  gitClone,
  gitStatus,
  gitBranch,
  gitCommit,
  gitPush,
  gitPull,
  gitLog,
  gitReset,
  gitClean,
} from './git-tools.js';

@registerTool()
export class GitCloneTool extends BaseTool {
  readonly name = 'git_clone';

  readonly description = '从远程仓库克隆代码到本地目录';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    url: z.string().describe('远程仓库 URL'),
    directory: z.string().optional().describe('目标目录名'),
    branch: z.string().optional().describe('指定分支'),
    depth: z.number().optional().describe('浅克隆深度'),
    cwd: z.string().optional().describe('工作目录'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { url, directory, branch, depth, cwd } = params as {
      url: string;
      directory?: string;
      branch?: string;
      depth?: number;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📥 git clone:')} ${chalk.dim(url)}`);

    const result = await gitClone({ url, directory, branch, depth, cwd });

    if (result.success) {
      return `Successfully cloned to: ${result.data?.path}`;
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git clone failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitStatusTool extends BaseTool {
  readonly name = 'git_status';

  readonly description =
    '查看 Git 仓库的当前状态，包括分支、已修改文件、已暂存文件列表';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { cwd } = params as { cwd?: string };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📊 git status')}`);

    const result = await gitStatus({ cwd });

    if (result.success && result.data) {
      const { branch, modified, staged, untracked, ahead, behind } =
        result.data;
      let output = `Branch: ${branch}`;
      if (ahead > 0 || behind > 0) {
        output += ` (ahead ${ahead}, behind ${behind})`;
      }
      if (staged.length > 0) {
        output += `\nStaged: ${staged.join(', ')}`;
      }
      if (modified.length > 0) {
        output += `\nModified: ${modified.join(', ')}`;
      }
      if (untracked.length > 0) {
        output += `\nUntracked: ${untracked.join(', ')}`;
      }
      return output;
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git status failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitBranchTool extends BaseTool {
  readonly name = 'git_branch';

  readonly description = '管理 Git 分支，包括列出、创建、切换和删除分支';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    action: z.enum(['list', 'create', 'delete', 'switch']).describe('操作类型'),
    name: z.string().optional().describe('分支名称'),
    force: z.boolean().optional().describe('强制删除'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { action, name, force, cwd } = params as {
      action: 'list' | 'create' | 'delete' | 'switch';
      name?: string;
      force?: boolean;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('🌿 git branch:')} ${action}`);

    const result = await gitBranch({ action, name, force, cwd });

    if (result.success) {
      if (action === 'list' && result.data) {
        const branches = (
          result.data as { branches: { name: string; current: boolean }[] }
        ).branches;
        return branches
          .map((b) => (b.current ? `* ${b.name}` : `  ${b.name}`))
          .join('\n');
      }
      if (action === 'create') {
        return `Branch '${name}' created and switched`;
      }
      if (action === 'delete') {
        return `Branch '${name}' deleted`;
      }
      if (action === 'switch') {
        return `Switched to branch '${name}'`;
      }
      return 'Operation completed';
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git branch failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitCommitTool extends BaseTool {
  readonly name = 'git_commit';

  readonly description =
    '提交代码更改到 Git 仓库。支持直接传入 message，或通过 IDE 扩展调用 API 获取提交信息。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    message: z
      .string()
      .optional()
      .describe(
        '提交信息。如不提供，将尝试从 IDE API 获取（需要 IDE 扩展支持）。'
      ),
    files: z.array(z.string()).optional().describe('要提交的文件列表'),
    all: z.boolean().optional().describe('暂存所有已修改文件'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      message: paramMessage,
      files: paramFiles,
      all: paramAll,
      cwd,
    } = params as {
      message?: string;
      files?: string[];
      all?: boolean;
      cwd?: string;
    };

    let commitMessage = paramMessage;
    let files = paramFiles;
    let all = paramAll;

    if (!commitMessage || commitMessage.trim() === '') {
      const { getPendingCommitMessage, clearPendingCommitMessage } =
        await import('./commit-api-server.js');
      const pending = getPendingCommitMessage();

      if (pending) {
        commitMessage = pending.message;
        if (pending.files) {
          files = pending.files;
        }
        if (pending.all !== undefined) {
          all = pending.all;
        }
        clearPendingCommitMessage();
      }
    }

    if (!commitMessage || commitMessage.trim() === '') {
      throw new Error(
        'Commit message is required. Provide message parameter or set up IDE extension to send commit message via API.'
      );
    }

    process.stdout.write('\r\x1b[K\n');
    console.log(
      `  ${chalk.gray('💾 git commit:')} ${chalk.dim(commitMessage.substring(0, 50))}`
    );

    const result = await gitCommit({ message: commitMessage, files, all, cwd });

    if (result.success) {
      return `Successfully committed: ${result.data?.hash}`;
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git commit failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitPushTool extends BaseTool {
  readonly name = 'git_push';

  readonly description = '将本地提交推送到远程仓库';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    remote: z.string().optional().describe('远程仓库名称'),
    branch: z.string().optional().describe('分支名称'),
    force: z.boolean().optional().describe('强制推送'),
    confirmed: z.boolean().optional().describe('确认执行危险操作'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { remote, branch, force, confirmed, cwd } = params as {
      remote?: string;
      branch?: string;
      force?: boolean;
      confirmed?: boolean;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(
      `  ${chalk.gray('📤 git push:')} ${remote || 'origin'} ${branch || ''}`
    );

    const result = await gitPush({ remote, branch, force, confirmed, cwd });

    if (result.success) {
      return 'Successfully pushed to remote';
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git push failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitPullTool extends BaseTool {
  readonly name = 'git_pull';

  readonly description = '从远程仓库拉取最新代码';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    remote: z.string().optional().describe('远程仓库名称'),
    branch: z.string().optional().describe('分支名称'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { remote, branch, cwd } = params as {
      remote?: string;
      branch?: string;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(
      `  ${chalk.gray('📥 git pull:')} ${remote || 'origin'} ${branch || ''}`
    );

    const result = await gitPull({ remote, branch, cwd });

    if (result.success) {
      return 'Successfully pulled from remote';
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git pull failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitLogTool extends BaseTool {
  readonly name = 'git_log';

  readonly description = '查看 Git 提交历史记录';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    limit: z.number().optional().describe('限制显示的提交数量'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { limit, cwd } = params as {
      limit?: number;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📜 git log')}`);

    const result = await gitLog({ limit, cwd });

    if (result.success && result.data) {
      const { commits } = result.data;
      return commits
        .map((c) => `${c.shortHash} | ${c.author} | ${c.date} | ${c.message}`)
        .join('\n');
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git log failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitResetTool extends BaseTool {
  readonly name = 'git_reset';

  readonly description = '重置 Git 仓库到指定提交';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    target: z.string().optional().describe('目标提交'),
    mode: z.enum(['soft', 'mixed', 'hard']).describe('重置模式'),
    confirmed: z.boolean().optional().describe('确认执行危险操作'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { target, mode, confirmed, cwd } = params as {
      target?: string;
      mode: 'soft' | 'mixed' | 'hard';
      confirmed?: boolean;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('🔄 git reset:')} --${mode}`);

    const result = await gitReset({ target, mode, confirmed, cwd });

    if (result.success) {
      return `Successfully reset to ${target || 'HEAD'} with mode ${mode}`;
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git reset failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitCleanTool extends BaseTool {
  readonly name = 'git_clean';

  readonly description = '清理 Git 仓库中未跟踪的文件和目录';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    force: z.boolean().optional().describe('强制删除文件'),
    directories: z.boolean().optional().describe('删除未跟踪的目录'),
    dryRun: z.boolean().optional().describe('仅预览不实际删除'),
    confirmed: z.boolean().optional().describe('确认执行危险操作'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { force, directories, dryRun, confirmed, cwd } = params as {
      force?: boolean;
      directories?: boolean;
      dryRun?: boolean;
      confirmed?: boolean;
      cwd?: string;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(
      `  ${chalk.gray('🧹 git clean:')} ${dryRun ? '-n (dry run)' : ''}`
    );

    const result = await gitClean({
      force,
      directories,
      dryRun,
      confirmed,
      cwd,
    });

    if (result.success && result.data) {
      const { files } = result.data;
      if (dryRun) {
        return `Would remove: ${files.join(', ') || 'nothing'}`;
      }
      return `Removed: ${files.join(', ') || 'nothing'}`;
    }

    const errorMessage = result.error?.message || 'Unknown error';
    throw new Error(`Git clean failed: ${errorMessage}`);
  }
}
