import type { CLIInterface } from '../interface.js';

/**
 * 命令接口定义
 */
export interface Command {
  /** 命令名称（不含斜杠） */
  name: string;
  /** 命令描述 */
  description: string;
  /** 命令别名 */
  aliases?: string[];
  /** 命令执行函数 */
  action: () => void | Promise<void>;
}

/**
 * 命令选择器状态
 */
export interface CommandSelectorState {
  /** 是否处于命令选择模式 */
  isActive: boolean;
  /** 当前输入的过滤文本（不含斜杠） */
  filterText: string;
  /** 过滤后的命令列表 */
  filteredCommands: Command[];
  /** 当前选中的索引 */
  selectedIndex: number;
  /** 显示的起始索引（用于滚动） */
  displayStartIndex: number;
}

/**
 * 命令选择器配置
 */
export interface CommandSelectorConfig {
  /** 默认显示的命令数量 */
  defaultDisplayCount: number;
  /** 命令前缀 */
  prefix: string;
}

/**
 * 命令上下文 - 提供给命令访问CLI接口的能力
 */
export interface CommandContext {
  /** CLI接口实例 */
  cli: CLIInterface;
  /** 显示提示符 */
  showPrompt: () => void;
  /** 清屏 */
  clearScreen: () => void;
  /** 退出程序 */
  quit: () => void;
}

/**
 * 命令定义接口 - 用于自动注册
 */
export interface CommandDefinition {
  /** 命令名称 */
  name: string;
  /** 命令描述 */
  description: string;
  /** 命令别名 */
  aliases?: string[];
  /** 执行命令 */
  execute: (context: CommandContext) => void | Promise<void>;
}

/**
 * 命令模块接口 - 每个命令文件需要导出的内容
 */
export interface CommandModule {
  /** 命令定义 */
  command: CommandDefinition;
}
