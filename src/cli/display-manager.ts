import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import cliSpinners from 'cli-spinners';

import type { CostSummary } from '../agent/memory/types.js';

/**
 * Google风格颜色定义
 */
const Colors = {
  primary: chalk.hex('#1a73e8'), // Google Blue
  secondary: chalk.hex('#5f6368'), // Google Grey
  success: chalk.hex('#34a853'), // Google Green
  error: chalk.hex('#ea4335'), // Google Red
  warning: chalk.hex('#fbbc04'), // Google Yellow
  dim: chalk.hex('#9aa0a6'), // Light Grey
  bold: chalk.bold,
} as const;

/**
 * Diff 颜色定义 - 带有良好可读性的背景色
 */
const DiffColors = {
  // 删除行 - 淡红色背景配深红色字体
  removed: {
    bg: chalk.bgHex('#ffeaea'), // 淡红色背景
    text: chalk.hex('#c0392b'), // 深红色字体
  },
  // 新增行 - 淡绿色背景配深绿色字体
  added: {
    bg: chalk.bgHex('#e8f5e9'), // 淡绿色背景
    text: chalk.hex('#27ae60'), // 深绿色字体
  },
  // 行号信息 - 淡蓝色背景配深蓝色字体
  lineInfo: {
    bg: chalk.bgHex('#e3f2fd'), // 淡蓝色背景
    text: chalk.hex('#1976d2'), // 深蓝色字体
  },
} as const;

/**
 * 加载动画样式 - 随机选择
 * 直接使用 cli-spinners 对象，避免 isUnicodeSupported 检查导致的问题
 */
const SPINNER_STYLES: cliSpinners.Spinner[] = [
  cliSpinners.dots,
  cliSpinners.line,
  cliSpinners.simpleDots,
  cliSpinners.simpleDotsScrolling,
  cliSpinners.star,
  cliSpinners.star2,
  cliSpinners.noise,
  cliSpinners.bounce,
];

/**
 * 随机获取 spinner 样式
 */
function getRandomSpinner(): cliSpinners.Spinner {
  return SPINNER_STYLES[Math.floor(Math.random() * SPINNER_STYLES.length)];
}

/**
 * 消息类型
 */
export type MessageType = 'user' | 'agent' | 'error' | 'info';

/**
 * DisplayManager类 - Google简约风格CLI显示
 */
export class DisplayManager {
  private spinner: Ora | null = null;
  private terminalWidth: number;

  constructor() {
    this.terminalWidth = process.stdout.columns || 80;
    process.stdout.on('resize', () => {
      this.terminalWidth = process.stdout.columns || 80;
    });
  }

  /**
   * 显示用户输入 - 简洁风格
   */
  showUserInput(input: string): void {
    console.log();
    console.log(Colors.primary('> ') + input);
    console.log();
  }

  /**
   * 显示Agent响应 - 带标题的分段显示
   */
  showAgentResponse(response: string): void {
    const lines = response.split('\n').filter((line) => line.trim());

    console.log(Colors.secondary('─'.repeat(Math.min(40, this.terminalWidth))));

    lines.forEach((line) => {
      console.log('  ' + line);
    });

    console.log();
  }

  /**
   * 显示错误信息 - 简洁红色提示
   */
  showError(error: string): void {
    console.log();
    console.log(Colors.error('Error: ') + error);
    console.log();
  }

  /**
   * 显示信息提示
   */
  showInfo(message: string): void {
    console.log(Colors.dim(message));
  }

  /**
   * 启动加载动画 - 随机样式
   */
  startLoading(text: string = 'Processing'): void {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora({
      text: Colors.primary(text),
      spinner: getRandomSpinner(),
      isEnabled: true,
      discardStdin: false, // 不丢弃 stdin,保持交互式输入
    }).start();
  }

  /**
   * 更新加载动画文字（不重启 spinner）
   */
  updateLoading(text: string): void {
    if (this.spinner) {
      this.spinner.text = Colors.primary(text);
    }
  }

  /**
   * 停止加载动画
   */
  stopLoading(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * 获取当前 spinner 的文本
   */
  getLoadingText(): string | null {
    return this.spinner?.text ?? null;
  }

  /**
   * 在 spinner 下方输出工具调用信息
   * 清除当前 spinner 行，输出工具调用，然后重新显示 spinner
   */
  logToolCall(icon: string, name: string, detail: string): void {
    if (this.spinner) {
      // 清除当前 spinner 行
      process.stdout.write('\r\x1b[K');
      // 输出工具调用信息
      console.log(
        `  ${Colors.dim(icon + ' ' + name + ':')} ${Colors.dim(detail)}`
      );
      // 重新启动 spinner 保持动画
      const currentText = this.spinner.text;
      this.spinner = ora({
        text: currentText,
        spinner: this.spinner.spinner,
        isEnabled: true,
        discardStdin: false,
      }).start();
    } else {
      // 如果没有 spinner，直接输出
      console.log(
        `  ${Colors.dim(icon + ' ' + name + ':')} ${Colors.dim(detail)}`
      );
    }
  }

  /**
   * 显示 token 使用统计
   */
  showTokenStats(
    last: { inputTokens: number; outputTokens: number; elapsedMs: number },
    session: CostSummary
  ): void {
    const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');
    const elapsed = (last.elapsedMs / 1000).toFixed(1);

    const requestTotal = (last.inputTokens ?? 0) + (last.outputTokens ?? 0);

    const perRequest =
      Colors.dim('↑') +
      ' ' +
      Colors.secondary(fmt(last.inputTokens)) +
      '  ' +
      Colors.dim('↓') +
      ' ' +
      Colors.secondary(fmt(last.outputTokens)) +
      '  ' +
      Colors.dim('Cost') +
      ' ' +
      Colors.secondary(fmt(requestTotal) + ' tokens') +
      '  ' +
      Colors.dim(elapsed + 's');

    const sessionPart =
      Colors.dim('·  Session ') +
      Colors.secondary(fmt(session.totalTokens)) +
      Colors.dim(' tokens') +
      Colors.dim('  (' + session.requestCount + ' req)');

    console.log('  ' + perRequest + '  ' + sessionPart);
    console.log();
  }

  /**
   * 打印分隔线
   */
  printDivider(): void {
    console.log(Colors.dim('─'.repeat(Math.min(60, this.terminalWidth))));
  }

  /**
   * 打印空行
   */
  printSpacer(lines: number = 1): void {
    console.log('\n'.repeat(lines));
  }

  /**
   * 检查终端是否支持颜色
   */
  isColorSupported(): boolean {
    return chalk.level > 0;
  }

  /**
   * 显示 diff（文件变更对比）
   * @param diffContent diff 字符串内容
   * @param filePath 文件路径（可选，用于显示标题）
   */
  showDiff(diffContent: string, filePath?: string): void {
    if (!diffContent || diffContent.trim().length === 0) {
      return;
    }

    const lines = diffContent.split('\n');

    // 显示标题
    if (filePath) {
      console.log();
      console.log(Colors.dim('─'.repeat(Math.min(40, this.terminalWidth))));
      console.log(Colors.secondary(`  变更: ${filePath}`));
      console.log(Colors.dim('─'.repeat(Math.min(40, this.terminalWidth))));
    }

    // 解析并着色显示 diff，过滤掉不必要的头部信息
    for (const line of lines) {
      const trimmedLine = line.trim();

      // 跳过不必要的 diff 头部信息（包括行号信息）
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('+++') ||
        line.startsWith('---') ||
        line.startsWith('@@') ||
        trimmedLine.startsWith('===')
      ) {
        continue;
      }

      if (line.startsWith('+')) {
        // 新增行 - 淡绿色背景配深绿色字体
        const styledLine = DiffColors.added.bg(DiffColors.added.text(line));
        console.log(styledLine);
      } else if (line.startsWith('-')) {
        // 删除行 - 淡红色背景配深红色字体
        const styledLine = DiffColors.removed.bg(DiffColors.removed.text(line));
        console.log(styledLine);
      } else if (trimmedLine.length > 0) {
        // 上下文行（只显示非空行）
        console.log(Colors.dim(line));
      }
    }

    if (filePath) {
      console.log(Colors.dim('─'.repeat(Math.min(40, this.terminalWidth))));
    }
    console.log();
  }
}
