import type { Command } from './types.js';

/**
 * 命令注册器
 */
export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliasMap: Map<string, string> = new Map();

  /**
   * 注册命令
   */
  register(command: Command): void {
    this.commands.set(command.name, command);

    // 注册别名
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias, command.name);
      }
    }
  }

  /**
   * 批量注册命令
   */
  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * 获取命令
   */
  get(name: string): Command | undefined {
    // 先查找直接匹配
    const command = this.commands.get(name);
    if (command) {
      return command;
    }

    // 再查找别名
    const realName = this.aliasMap.get(name);
    if (realName) {
      return this.commands.get(realName);
    }

    return undefined;
  }

  /**
   * 获取所有命令
   */
  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * 根据前缀过滤命令
   */
  filterByPrefix(prefix: string): Command[] {
    if (!prefix) {
      return this.getAll();
    }

    const lowerPrefix = prefix.toLowerCase();
    return this.getAll().filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(lowerPrefix) ||
        cmd.aliases?.some((alias) =>
          alias.toLowerCase().startsWith(lowerPrefix)
        )
    );
  }

  /**
   * 检查命令是否存在
   */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliasMap.has(name);
  }
}
