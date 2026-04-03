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
    '查看 Git 仓库的当前状态，包括分支、已修改文件、已暂存文件列表。' +
    '\n\n**重要：在提交代码前必须先调用此工具查看有哪些变更。**' +
    '\n\n**使用场景：**' +
    '\n- 用户要求提交代码时，首先调用此工具查看变更' +
    '\n- 用户想了解当前仓库状态时调用' +
    '\n- 在执行 git commit、git add 等操作前查看状态';

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

      // 明确区分已暂存和未暂存的文件
      if (staged.length > 0) {
        output += `\n\n已暂存的文件（准备提交）:`;
        staged.forEach((file) => {
          output += `\n  - ${file}`;
        });
      }

      if (modified.length > 0) {
        output += `\n\n已修改但未暂存的文件（需要先暂存才能提交）:`;
        modified.forEach((file) => {
          output += `\n  - ${file}`;
        });
        output += `\n\n提示：使用 git_commit({ all: true }) 可自动暂存并提交这些文件`;
      }

      if (untracked.length > 0) {
        output += `\n\n未跟踪的文件:`;
        untracked.forEach((file) => {
          output += `\n  - ${file}`;
        });
      }

      // 如果没有任何更改
      if (
        staged.length === 0 &&
        modified.length === 0 &&
        untracked.length === 0
      ) {
        output += `\n\n工作目录干净，没有需要提交的更改`;
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
    '提交代码更改到 Git 仓库。这是一个交互式工具，会自动询问用户输入提交信息。' +
    '\n\n**使用场景：**' +
    '\n- 用户要求提交代码、commit、保存更改时调用此工具' +
    '\n- 工具会自动暂停执行并询问用户输入提交信息（支持中文和英文）' +
    '\n\n**调用方式：**' +
    '\n- 通常情况：git_commit() - 提交已暂存的文件' +
    '\n- 文件未暂存：git_commit({ all: true }) - 先暂存所有修改再提交' +
    '\n\n**注意事项：**' +
    '\n- 不需要通过参数传递提交信息，工具会询问用户' +
    '\n- 用户输入的提交信息会被直接使用，支持中英文，不需要额外处理' +
    '\n- 如果用户提供了提交信息作为上下文，仍然要调用此工具，工具会确认' +
    '\n- 直接调用此工具即可，不要只是给用户建议或说明';

  readonly category = ToolCategories.FILE_SYSTEM;

  /**
   * 设置超时时间为 10 分钟，因为需要用户交互式输入提交信息
   */
  readonly timeout = 600000; // 10 分钟

  /**
   * 标记为一次性执行工具，成功后不应再次调用
   * git commit 是有副作用的操作，不应重复执行
   */
  readonly executeOnce = true;

  readonly paramsSchema = z.object({
    files: z
      .array(z.string())
      .optional()
      .describe(
        '【可选】指定要提交的文件列表。' +
          '大多数情况下不需要此参数，工具会提交已暂存的文件。' +
          '如果使用，文件路径应相对于仓库根目录。' +
          '注意：此参数用于指定文件路径，不是提交信息。'
      ),
    all: z
      .boolean()
      .optional()
      .describe(
        '【可选】设为true会自动暂存所有修改后提交。' +
          '仅当文件未暂存且需要提交时使用。' +
          '如果文件已暂存，不需要此参数。'
      ),
    cwd: z.string().optional().describe('仓库路径（可选，默认为当前工作目录）'),
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

    // 校验并过滤 files 参数：
    // LLM 经常误将提交信息文本传入 files 参数，
    // 如果值看起来不像文件路径（含中文、空格、无路径分隔符等），则忽略。
    const isValidFilePath = (value: string): boolean => {
      if (!value || value.trim().length === 0) return false;
      // 包含中文 → 很可能是提交信息而非文件路径
      if (/[\u4e00-\u9fff]/.test(value)) return false;
      // 包含空格且不以常见文件扩展名结尾 → 可能是句子
      if (/\s/.test(value) && !/\.\w+$/.test(value)) return false;
      // 长度超过 200 且不含 / 或 \ → 不太可能是文件路径
      if (value.length > 200 && !/[\\/]/.test(value)) return false;
      return true;
    };

    const files = Array.isArray(paramFiles)
      ? paramFiles.filter(isValidFilePath)
      : undefined;
    // 如果过滤后 files 为空数组或未定义，视为未指定
    const hasValidFiles = files !== undefined && files.length > 0;
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

    const result = await gitCommit({
      message: commitMessage,
      files: hasValidFiles ? files : undefined,
      all,
      cwd,
    });

    if (result.success) {
      if (result.data?.hash) {
        return `Successfully committed: ${result.data.hash}`;
      }
      return 'Nothing to commit, working tree clean';
    }

    const errorMessage = result.error?.message || 'Unknown error';

    // 提供更友好的错误提示
    if (
      errorMessage.includes('did not match any files') ||
      errorMessage.includes('could not be matched')
    ) {
      throw new Error(
        `提交失败：文件路径无法匹配。\n\n` +
          `${errorMessage}\n\n` +
          `建议解决方案：\n` +
          `1. 使用 git status 查看当前修改的文件\n` +
          `2. 使用 git add <file> 手动添加文件到暂存区\n` +
          `3. 然后重新运行 git_commit 工具（不提供 files 参数）\n` +
          `4. 或者使用 all: true 参数自动暂存所有修改`
      );
    }

    throw new Error(`Git commit failed: ${errorMessage}`);
  }
}

@registerTool()
export class GitPushTool extends BaseTool {
  readonly name = 'git_push';

  readonly description = '将本地提交推送到远程仓库';

  readonly category = ToolCategories.FILE_SYSTEM;

  /**
   * 设置超时时间为 3 分钟，因为推送可能需要较长时间
   */
  readonly timeout = 180000; // 3 分钟

  /**
   * 标记为一次性执行工具，成功后不应再次调用
   * git push 是有副作用的操作，不应重复执行
   */
  readonly executeOnce = true;

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

  /**
   * 标记为一次性执行工具，成功后不应再次调用
   * git reset 是有副作用的操作，不应重复执行
   */
  readonly executeOnce = true;

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

  /**
   * 标记为一次性执行工具，成功后不应再次调用
   * git clean 是有副作用的操作，不应重复执行
   */
  readonly executeOnce = true;

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
