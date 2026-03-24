import { checkWorkerStatus } from '../../../worker/worker-monitor-utils.js';
import type { CommandDefinition, CommandContext } from '../types.js';

/**
 * Memory 命令 - 查看内存状态
 */
export const command: CommandDefinition = {
  name: 'memory',
  description: '查看内存状态',
  aliases: ['mem', 'status'],
  execute: ({ showPrompt }: CommandContext) => {
    checkWorkerStatus();
    showPrompt();
  },
};
