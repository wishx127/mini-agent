import type { Command, CommandDefinition, CommandContext } from './types.js';
// 同步导入所有命令模块
import * as helpModule from './cmd/help.js';
import * as clearModule from './cmd/clear.js';
import * as exitModule from './cmd/exit.js';
import * as memoryModule from './cmd/memory.js';

/**
 * 命令加载器 - 自动发现和加载命令
 */
export class CommandLoader {
  /**
   * 加载所有内置命令
   * 新增命令时只需导入新模块并添加到数组中
   */
  static loadBuiltInCommands(): CommandDefinition[] {
    const modules = [helpModule, clearModule, exitModule, memoryModule];

    return modules
      .map((module) => module.command)
      .filter((cmd): cmd is CommandDefinition => cmd !== undefined);
  }

  /**
   * 将 CommandDefinition 转换为 Command（绑定上下文）
   */
  static bindContext(
    definition: CommandDefinition,
    context: CommandContext
  ): Command {
    return {
      name: definition.name,
      description: definition.description,
      aliases: definition.aliases,
      action: () => definition.execute(context),
    };
  }

  /**
   * 批量绑定上下文
   */
  static bindAllContext(
    definitions: CommandDefinition[],
    context: CommandContext
  ): Command[] {
    return definitions.map((def) => this.bindContext(def, context));
  }
}
