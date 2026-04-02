/**
 * Bash 执行工具
 * 提供受限制的 Bash 命令执行能力
 */

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { bashExecute } from './bash-executor.js';

@registerTool()
export class BashTool extends BaseTool {
  readonly name = 'bash';

  readonly description =
    '在受控环境中执行 Bash 命令。支持危险命令检测、路径验证、超时控制和并发限制。危险操作需要用户确认。';

  readonly category = ToolCategories.SANDBOX;

  readonly paramsSchema = z.object({
    command: z.string().describe('要执行的 Bash 命令'),
    args: z.array(z.string()).optional().describe('命令参数列表'),
    cwd: z.string().optional().describe('工作目录路径，默认为项目根目录'),
    timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
    env: z.record(z.string(), z.string()).optional().describe('额外的环境变量'),
    confirmed: z.boolean().optional().describe('确认执行危险操作'),
  });

  readonly timeout = 60000;

  async execute(params: Record<string, unknown>): Promise<string> {
    const { command, args, cwd, timeout, env, confirmed } = params as {
      command: string;
      args?: string[];
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
      confirmed?: boolean;
    };

    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('⚡ bash:')} ${chalk.dim(command)}`);

    const result = await bashExecute({
      command,
      args,
      cwd,
      timeout,
      env,
      confirmed,
    });

    if (result.success && result.data) {
      const output = result.data.stdout || result.data.stderr || '';
      return output;
    }

    const errorMessage =
      result.error?.message || result.data?.stderr || 'Unknown error';
    throw new Error(`Bash execution failed: ${errorMessage}`);
  }
}
