import type { CommandDefinition, CommandContext } from '../types.js';

/**
 * Help 命令 - 显示帮助信息
 */
export const command: CommandDefinition = {
  name: 'help',
  description: '显示帮助信息',
  aliases: ['h', '?'],
  execute: ({ cli }: CommandContext) => {
    cli.showHelp();
  },
};
