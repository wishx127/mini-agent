import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import cliSpinners from 'cli-spinners';

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
   * 停止加载动画
   */
  stopLoading(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
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
}
