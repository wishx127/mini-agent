import type { CommandDefinition, CommandContext } from '../types.js';

/**
 * Exit 命令 - 退出程序
 */
export const command: CommandDefinition = {
  name: 'exit',
  description: '退出程序',
  aliases: ['exit', 'e'],
  execute: ({ quit }: CommandContext) => {
    quit();
  },
};
