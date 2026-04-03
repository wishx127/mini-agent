/**
 * Git 操作工具
 * 提供安全的 Git 版本控制操作能力
 */

import readline from 'readline';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';
import { authManager } from '../../auth-manager.js';

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
        const deleteData = result.data as { deleted: string; stdout?: string };
        const forceInfo = force ? ' (forced)' : '';
        const gitOutput = deleteData.stdout || '';
        return `Branch '${name}' deleted${forceInfo}${gitOutput ? '\n' + gitOutput : ''}`;
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
    '提交代码更改到 Git 仓库。执行此工具时会向用户询问提交信息，支持多行输入。不要自动生成提交信息。';

  readonly category = ToolCategories.FILE_SYSTEM;

  /**
   * 设置超时时间为 10 分钟，因为需要用户交互式输入提交信息
   */
  readonly timeout = 600000; // 10 分钟

  readonly paramsSchema = z.object({
    files: z.array(z.string()).optional().describe('要提交的文件列表'),
    all: z.boolean().optional().describe('暂存所有已修改文件'),
    cwd: z.string().optional().describe('仓库路径'),
  });

  /**
   * 向用户询问提交信息，支持多行输入
   * 连续两次 Enter（空行）结束输入
   */
  private async askForCommitMessage(): Promise<string> {
    const callbacks = authManager.getCallbacks();

    // 暂停 spinner 和 CLI 输入，避免与工具的用户输入冲突
    const loadingText = callbacks?.onBeforeAsk?.();
    callbacks?.pauseCliInput?.();

    // 清除可能的 spinner 行，确保提示可见
    process.stdout.write('\r\x1b[K');

    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let isDone = false;
      let emptyLineCount = 0;

      console.log(chalk.cyan('\n请输入提交信息：'));
      console.log(chalk.gray('- 输入内容后按 Enter 换行'));
      console.log(chalk.gray('- 连续按两次 Enter（空行）结束输入'));
      console.log(chalk.gray('- 支持直接粘贴多行文本\n'));

      // 使用 readline 创建接口，启用 terminal 模式以支持行编辑（退格、删除等）
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      // 统一的清理函数
      const cleanup = () => {
        if (isDone) return;
        isDone = true;

        // 移除所有事件监听器，避免内存泄漏和重复调用
        rl.removeAllListeners();

        // 关闭 readline 接口
        try {
          rl.close();
        } catch {
          // 忽略关闭错误
        }

        // 恢复 spinner 和 CLI 输入
        callbacks?.resumeCliInput?.();
        callbacks?.onAfterAsk?.(loadingText ?? null);
      };

      // 完成输入的函数
      const finishInput = () => {
        if (isDone) return;

        // 输出提示信息
        console.log(chalk.dim('\n输入结束，正在处理...'));

        // 标记为已完成，防止重复处理
        isDone = true;

        // 移除所有事件监听器
        rl.removeAllListeners();

        // 关闭 readline
        try {
          rl.close();
        } catch {
          // 忽略关闭错误
        }

        // 恢复 CLI 状态（在 resolve/reject 之前恢复，确保状态正确）
        callbacks?.resumeCliInput?.();
        callbacks?.onAfterAsk?.(loadingText ?? null);

        // 返回提交信息
        if (lines.length > 0) {
          resolve(lines.join('\n'));
        } else {
          reject(new Error('提交信息不能为空'));
        }
      };

      // 处理每一行输入
      rl.on('line', (line) => {
        // 检查是否为空行
        if (line.trim() === '') {
          emptyLineCount++;
          // 连续两次空行，结束输入
          if (emptyLineCount >= 2) {
            finishInput();
            return;
          }
          // 单次空行也添加到 lines 中（可能是多行提交信息中的空行）
          lines.push(line);
        } else {
          // 非空行，重置空行计数
          emptyLineCount = 0;
          lines.push(line);
        }
      });

      // 处理输入结束 (Ctrl+D) - 仍然保留作为备选方案
      rl.on('close', () => {
        if (isDone) return;
        finishInput();
      });

      // 处理错误
      rl.on('error', (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      // 处理 Ctrl+C (用户取消)
      rl.on('SIGINT', () => {
        cleanup();
        reject(new Error('用户取消输入'));
      });
    });
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      files: paramFiles,
      all: paramAll,
      cwd,
    } = params as {
      files?: string[];
      all?: boolean;
      cwd?: string;
    };

    const files = paramFiles;
    const all = paramAll;

    // 强制向用户询问提交信息
    let commitMessage: string;
    try {
      commitMessage = await this.askForCommitMessage();
    } catch (error) {
      throw new Error(
        `获取提交信息失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 验证提交信息不为空
    if (!commitMessage || commitMessage.trim() === '') {
      throw new Error('提交信息不能为空');
    }

    process.stdout.write('\r\x1b[K\n');
    const displayMessage =
      commitMessage.length > 50
        ? commitMessage.substring(0, 50) + '...'
        : commitMessage;
    console.log(
      `  ${chalk.gray('💾 git commit:')} ${chalk.dim(displayMessage)}`
    );

    const result = await gitCommit({ message: commitMessage, files, all, cwd });

    if (result.success) {
      if (result.data?.hash) {
        return `Successfully committed: ${result.data.hash}`;
      }
      return 'Nothing to commit, working tree clean';
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
