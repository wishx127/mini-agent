import chalk from 'chalk';

import type {
  Command,
  CommandSelectorState,
  CommandSelectorConfig,
} from './commands/types.js';
import type { CommandRegistry } from './commands/registry.js';

/**
 * 颜色定义
 */
const Colors = {
  selected: chalk.hex('#1a73e8'), // Google Blue
  dim: chalk.hex('#9aa0a6'), // Light Grey
  bold: chalk.bold,
} as const;

/**
 * ANSI 转义序列
 */
const ANSI = {
  CLEAR_LINE: '\r\x1b[K',
  CLEAR_SCREEN_DOWN: '\x1b[0J',
  CURSOR_UP: '\x1b[1A',
  CURSOR_DOWN: '\x1b[1B',
  CURSOR_SHOW: '\x1b[?25h',
  CURSOR_HIDE: '\x1b[?25l',
} as const;

/**
 * 将光标移动到指定列（1-based）
 */
function cursorToColumn(n: number): string {
  return `\x1b[${n}G`;
}

/**
 * 命令选择器
 */
export class CommandSelector {
  private registry: CommandRegistry;
  private config: CommandSelectorConfig;
  private state: CommandSelectorState;
  private renderedLineCount: number = 0;
  private lastRenderStartIndex: number = 0;
  private promptText: string = '> ';
  private isFirstRenderDone: boolean = false;

  constructor(
    registry: CommandRegistry,
    config?: Partial<CommandSelectorConfig>
  ) {
    this.registry = registry;
    this.config = {
      defaultDisplayCount: config?.defaultDisplayCount ?? 3,
      prefix: config?.prefix ?? '/',
    };

    this.state = {
      isActive: false,
      filterText: '',
      filteredCommands: [],
      selectedIndex: 0,
      displayStartIndex: 0,
    };
  }

  /**
   * 激活命令选择模式
   */
  activate(): void {
    this.state.isActive = true;
    this.state.filterText = '';
    this.state.selectedIndex = 0;
    this.state.displayStartIndex = 0;
    this.renderedLineCount = 0;
    this.lastRenderStartIndex = 0;
    this.isFirstRenderDone = false;
    this.updateFilteredCommands();
    // 首次渲染：在输入行下方显示命令列表
    this.firstRender();
  }

  /**
   * 停用命令选择模式
   */
  deactivate(): void {
    this.clearRenderedLines();
    this.state.isActive = false;
    this.state.filterText = '';
    this.state.filteredCommands = [];
    this.state.selectedIndex = 0;
    this.state.displayStartIndex = 0;
    this.lastRenderStartIndex = 0;
  }

  /**
   * 是否处于激活状态
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * 获取当前选中的命令
   */
  getSelectedCommand(): Command | null {
    if (this.state.filteredCommands.length === 0) {
      return null;
    }
    return this.state.filteredCommands[this.state.selectedIndex] ?? null;
  }

  /**
   * 处理字符输入
   */
  handleCharInput(char: string): void {
    if (!this.state.isActive) {
      return;
    }

    this.state.filterText += char;
    this.state.selectedIndex = 0;
    this.state.displayStartIndex = 0;
    this.updateFilteredCommands();
    this.rerender();
  }

  /**
   * 处理退格键
   */
  handleBackspace(): void {
    if (!this.state.isActive) {
      return;
    }

    if (this.state.filterText.length > 0) {
      this.state.filterText = this.state.filterText.slice(0, -1);
      this.state.selectedIndex = 0;
      this.state.displayStartIndex = 0;
      this.updateFilteredCommands();
      this.rerender();
    }
  }

  /**
   * 处理上箭头
   */
  handleArrowUp(): void {
    if (!this.state.isActive || this.state.filteredCommands.length === 0) {
      return;
    }

    if (this.state.selectedIndex > 0) {
      this.state.selectedIndex--;

      // 调整显示起始位置
      if (this.state.selectedIndex < this.state.displayStartIndex) {
        this.state.displayStartIndex = this.state.selectedIndex;
      }

      this.rerender();
    }
  }

  /**
   * 处理下箭头
   */
  handleArrowDown(): void {
    if (!this.state.isActive || this.state.filteredCommands.length === 0) {
      return;
    }

    const maxIndex = this.state.filteredCommands.length - 1;
    if (this.state.selectedIndex < maxIndex) {
      this.state.selectedIndex++;

      // 调整显示起始位置
      const displayEndIndex =
        this.state.displayStartIndex + this.config.defaultDisplayCount - 1;
      if (this.state.selectedIndex > displayEndIndex) {
        this.state.displayStartIndex =
          this.state.selectedIndex - this.config.defaultDisplayCount + 1;
      }

      this.rerender();
    }
  }

  /**
   * 更新过滤后的命令列表
   */
  private updateFilteredCommands(): void {
    this.state.filteredCommands = this.registry.filterByPrefix(
      this.state.filterText
    );
  }

  /**
   * 获取命令列表的文本行
   */
  private getCommandLines(): string[] {
    const commands = this.state.filteredCommands;
    const displayCount = this.config.defaultDisplayCount;
    const startIndex = this.state.displayStartIndex;
    const lines: string[] = [];

    if (commands.length === 0) {
      for (let i = 0; i < displayCount; i++) {
        lines.push('');
      }
    } else {
      const endIndex = Math.min(startIndex + displayCount, commands.length);
      const displayCommands = commands.slice(startIndex, endIndex);

      const maxNameLength = Math.max(
        ...displayCommands.map((cmd) => cmd.name.length),
        10
      );

      for (let i = 0; i < displayCommands.length; i++) {
        const cmd = displayCommands[i];
        const globalIndex = startIndex + i;
        const isSelected = globalIndex === this.state.selectedIndex;

        const marker = isSelected ? '▸' : ' ';
        const name = `/${cmd.name}`.padEnd(maxNameLength + 2);
        const description = Colors.dim(`- ${cmd.description}`);

        if (isSelected) {
          lines.push(
            `${marker} ${Colors.selected(Colors.bold(name))} ${description}`
          );
        } else {
          lines.push(`${marker} ${name} ${description}`);
        }
      }

      for (let i = displayCommands.length; i < displayCount; i++) {
        lines.push('');
      }
    }

    return lines;
  }

  /**
   * 首次渲染命令列表
   * 在输入行下方显示命令列表，然后将光标移回输入行
   */
  private firstRender(): void {
    const lines = this.getCommandLines();
    const displayCount = this.config.defaultDisplayCount;

    // 1. 先清除光标到行尾的内容，确保没有残留
    process.stdout.write(ANSI.CLEAR_SCREEN_DOWN);

    // 2. 显示命令列表（每行前面加换行）
    for (let i = 0; i < displayCount; i++) {
      process.stdout.write('\n' + lines[i]);
    }

    // 3. 将光标移回输入行（向上移动 displayCount 行）
    for (let i = 0; i < displayCount; i++) {
      process.stdout.write(ANSI.CURSOR_UP);
    }

    // 4. 将光标移动到输入行末尾（/ 后面）
    const inputLineLength =
      this.promptText.length + 1 + this.state.filterText.length;
    process.stdout.write(cursorToColumn(inputLineLength + 1));

    this.renderedLineCount = displayCount;
    this.lastRenderStartIndex = this.state.displayStartIndex;
    this.isFirstRenderDone = true;
  }

  /**
   * 重新渲染命令列表（原地更新）
   * 先刷新输入行，然后更新下方的命令列表
   */
  private rerender(): void {
    const lines = this.getCommandLines();
    const displayCount = this.config.defaultDisplayCount;

    // 1. 将光标移到输入行开头
    process.stdout.write('\r');

    // 2. 清除整行并重新显示输入
    process.stdout.write(ANSI.CLEAR_LINE);
    process.stdout.write(this.promptText + '/' + this.state.filterText);

    // 3. 清除光标下方的所有内容
    process.stdout.write(ANSI.CLEAR_SCREEN_DOWN);

    // 4. 显示命令列表
    for (let i = 0; i < displayCount; i++) {
      process.stdout.write('\n' + lines[i]);
    }

    // 5. 将光标移回输入行（向上移动 displayCount 行）
    for (let i = 0; i < displayCount; i++) {
      process.stdout.write(ANSI.CURSOR_UP);
    }

    // 6. 将光标移动到输入行末尾（/ 后面）
    const inputLineLength =
      this.promptText.length + 1 + this.state.filterText.length;
    process.stdout.write(cursorToColumn(inputLineLength + 1));

    this.renderedLineCount = displayCount;
    this.lastRenderStartIndex = this.state.displayStartIndex;
  }

  /**
   * 清除渲染的行
   */
  private clearRenderedLines(): void {
    if (this.renderedLineCount > 0) {
      // 1. 将光标移到输入行开头
      process.stdout.write('\r');

      // 2. 清除整行（不显示提示符，由调用方负责显示）
      process.stdout.write(ANSI.CLEAR_LINE);

      // 3. 清除光标下方的所有内容
      process.stdout.write(ANSI.CLEAR_SCREEN_DOWN);

      this.renderedLineCount = 0;
      this.isFirstRenderDone = false;
    }
  }

  /**
   * 获取当前过滤文本
   */
  getFilterText(): string {
    return this.state.filterText;
  }
}
