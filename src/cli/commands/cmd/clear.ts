import type { CommandDefinition, CommandContext } from '../types.js';

/**
 * Clear 命令 - 清屏
 */
export const command: CommandDefinition = {
  name: 'clear',
  description: '清屏',
  aliases: ['cls'],
  execute: ({ clearScreen }: CommandContext) => {
    clearScreen();
  },
};
