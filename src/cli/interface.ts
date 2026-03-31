import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'module';

import chalk from 'chalk';
import { Command } from 'commander';

import { AgentCore } from '../agent/core.js';
import { ModelConfigManager } from '../config/model-config.js';
import type { ModelConfig } from '../types/model-config.js';
import { authManager } from '../tools/index.js';

import { CommandSelector } from './command-selector.js';
import { CommandRegistry, CommandLoader } from './commands/index.js';
import { DisplayManager } from './display-manager.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version: string };
const VERSION = packageJson.version;

const Colors = {
  primary: chalk.hex('#1a73e8'),
  secondary: chalk.hex('#5f6368'),
  success: chalk.hex('#34a853'),
} as const;

/**
 * 加载动画文案 - 随机选择
 */
const LOADING_MESSAGES = [
  'Thinking',
  'Processing',
  'Analyzing',
  'Computing',
  'Generating',
  'Reasoning',
  'Working',
  'Pondering',
  'Brainstorming',
  'Contemplating',
  'Calculating',
  'Evaluating',
  'Formulating',
  'Deciphering',
  'Exploring',
] as const;

/**
 * 随机获取加载文案
 */
function getRandomLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

/**
 * 输入模式
 */
type InputMode = 'normal' | 'command';

/**
 * CLI交互界面类
 */
export class CLIInterface {
  private agent!: AgentCore;
  private program: Command;
  private displayManager: DisplayManager;
  private config!: ModelConfig;
  private workerProcess: ChildProcess | null = null;

  // 命令系统
  private commandRegistry: CommandRegistry;
  private commandSelector: CommandSelector;
  private inputMode: InputMode = 'normal';
  private normalInputBuffer: string = '';

  // stdin 事件处理器（用于暂停/恢复）
  private stdinHandler?: (data: string | Buffer) => void;

  constructor() {
    this.program = new Command();
    this.displayManager = new DisplayManager();
    this.commandRegistry = new CommandRegistry();
    this.commandSelector = new CommandSelector(this.commandRegistry);
    this.setupCommands();
    this.setupCommandRegistry();
    this.setupAuthCallbacks();
  }

  /**
   * 设置授权回调（用于暂停/恢复 spinner 和 CLI 输入）
   */
  private setupAuthCallbacks(): void {
    authManager.setCallbacks({
      onBeforeAsk: () => {
        // 获取当前 loading 文本，然后暂停 spinner
        const text = this.displayManager.getLoadingText();
        this.displayManager.stopLoading();
        return text;
      },
      onAfterAsk: (loadingText) => {
        // 用户输入完成后，恢复 spinner（仅在当前没有 spinner 时）
        if (loadingText && !this.displayManager.getLoadingText()) {
          this.displayManager.startLoading(loadingText);
        }
      },
      pauseCliInput: () => {
        if (this.stdinHandler) {
          process.stdin.removeListener('data', this.stdinHandler);
        }
        if (!process.stdin.isPaused()) {
          process.stdin.pause();
        }
      },
      resumeCliInput: () => {
        try {
          if (this.stdinHandler) {
            process.stdin.removeListener('data', this.stdinHandler);
            process.stdin.on('data', this.stdinHandler);
          }
          if (process.stdin.isPaused()) {
            process.stdin.resume();
          }
          // 恢复raw mode，确保按键被正确捕获
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          this.normalInputBuffer = '';
          this.inputMode = 'normal';
          this.commandSelector.deactivate();
          this.showPrompt();
        } catch (error) {
          console.error(chalk.red('Error resuming CLI input:'), error);
          try {
            if (process.stdin.isPaused()) {
              process.stdin.resume();
            }
            // 即使出错也尝试恢复raw mode
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
            this.showPrompt();
          } catch (fallbackError) {
            console.error(
              chalk.red('Failed to recover CLI input'),
              fallbackError
            );
          }
        }
      },
    });
  }

  /**
   * 设置命令行命令
   */
  private setupCommands(): void {
    this.program
      .name('mini-agent')
      .description('一个最小可用的AI Agent CLI工具')
      .version(VERSION);

    this.program
      .option('-c, --config <path>', '.env配置文件路径')
      .option('-h, --help', '显示帮助信息');
  }

  /**
   * 设置命令注册器
   */
  private setupCommandRegistry(): void {
    const commandDefinitions = CommandLoader.loadBuiltInCommands();
    const context = this.createCommandContext();
    const commands = CommandLoader.bindAllContext(commandDefinitions, context);
    this.commandRegistry.registerAll(commands);
  }

  /**
   * 创建命令上下文
   */
  private createCommandContext() {
    return {
      cli: this,
      showPrompt: () => this.showPrompt(),
      clearScreen: () => {
        console.clear();
        this.showPrompt();
      },
      quit: () => this.quit(),
    };
  }

  /**
   * 显示帮助信息
   */
  showHelp(): void {
    console.log();
    console.log(Colors.primary('Available Commands:'));
    console.log(Colors.secondary('─'.repeat(40)));
    const commands = this.commandRegistry.getAll();
    for (const cmd of commands) {
      console.log(`  /${cmd.name} - ${cmd.description}`);
    }
    console.log();
    this.showPrompt();
  }

  /**
   * 退出程序
   */
  private quit(): void {
    console.log(Colors.secondary('Goodbye.'));
    void this.cleanupAndExit(0);
  }

  /**
   * 初始化Agent
   */
  private initializeAgent(configPath?: string): void {
    try {
      const configManager = new ModelConfigManager(configPath);
      this.config = configManager.getConfig();
      this.agent = new AgentCore(this.config);

      console.log();
      console.log(
        Colors.primary('mini-agent ') + Colors.secondary(`v${VERSION}`)
      );
      console.log(Colors.secondary('─'.repeat(40)));
      console.log(Colors.secondary('Model: ') + this.config.modelName);
      console.log(Colors.secondary('Endpoint: ') + this.config.baseUrl);
      console.log();
      console.log(
        Colors.secondary(
          'Type your message. Press Ctrl+C or enter "/exit" to exit.'
        )
      );
      console.log();
    } catch (error) {
      console.error(
        Colors.primary('[Error] '),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }

  private startMemoryWorker(configPath?: string): void {
    const longTermMemory = this.config.longTermMemory;
    if (!longTermMemory?.enabled) {
      return;
    }
    if (longTermMemory.queueWorkerEnabled === false) {
      return;
    }
    if (this.workerProcess) {
      return;
    }

    const workerPath = path.join('dist', 'worker', 'memory-consumer.js');
    const args = [workerPath, '--parent-pid', String(process.pid)];
    if (configPath) {
      args.push('--config', configPath);
    }

    const logPath = path.join(process.cwd(), 'memory-worker.log');
    const logStream = createWriteStream(logPath, { flags: 'a' });
    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.unref();
    this.workerProcess = child;
  }

  /**
   * 显示提示符
   */
  private showPrompt(): void {
    process.stdout.write(Colors.primary('> '));
  }

  /**
   * 刷新提示符行（清除当前行并重新显示提示符和输入内容）
   */
  private refreshPromptLine(): void {
    const content =
      this.inputMode === 'command'
        ? `/${this.commandSelector.getFilterText()}`
        : this.normalInputBuffer;

    // 清除当前行并重新显示
    process.stdout.write('\r\x1b[K');
    process.stdout.write(Colors.primary('> ') + content);
  }

  /**
   * 处理用户输入
   */
  private async handleUserInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    // 处理空输入
    if (trimmedInput.length === 0) {
      this.showPrompt();
      return;
    }

    console.log();

    const startTime = Date.now();
    const loadingMsg = getRandomLoadingMessage();
    // 记录请求前的会话 token 累计（展示在 spinner 中）
    const prevSession = this.agent.getSessionTokenSummary();

    // 启动计时器：每 100ms 更新 spinner 文字，展示实时elapsed + 会话 token 总量
    let timerHandle: ReturnType<typeof setInterval> | null = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const sessionTokens = prevSession.totalTokens;
      const tokenHint =
        sessionTokens > 0
          ? `  ·  ${sessionTokens.toLocaleString('en-US')} tokens`
          : '';
      this.displayManager.updateLoading(
        `${loadingMsg}${tokenHint}  (${elapsed}s)`
      );
    }, 100);

    const clearTimer = () => {
      if (timerHandle !== null) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
    };

    try {
      // 显示加载动画
      this.displayManager.startLoading(loadingMsg);

      // 调用Agent处理
      const response = await this.agent.processPrompt(trimmedInput);
      const elapsedMs = Date.now() - startTime;

      clearTimer();
      // 停止加载动画
      this.displayManager.stopLoading();

      // 显示响应
      this.displayManager.showAgentResponse(response);

      // 显示 token 统计
      const lastUsage = this.agent.getLastTokenUsage();
      if (lastUsage) {
        this.displayManager.showTokenStats(
          { ...lastUsage, elapsedMs },
          this.agent.getSessionTokenSummary()
        );
      }
    } catch (error) {
      clearTimer();
      // 停止加载动画
      this.displayManager.stopLoading();

      // 显示错误
      this.displayManager.showError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // 无论如何都要继续等待下一次输入
      this.showPrompt();
    }
  }

  /**
   * 启动CLI交互模式
   */
  start(configPath?: string): void {
    // 解析命令行参数
    this.program.parse(process.argv);
    const options = this.program.opts();

    if (options.help) {
      this.program.help();
    }

    // 初始化Agent
    this.initializeAgent(configPath ?? (options.config as string | undefined));
    this.startMemoryWorker(
      configPath ?? (options.config as string | undefined)
    );

    // 设置 stdin 为 raw mode 以捕获单个按键
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // 保存 stdin 处理器引用，以便暂停/恢复
    this.stdinHandler = (data: string | Buffer) => {
      const key = typeof data === 'string' ? data : data.toString('utf8');
      void this.handleKeyPress(key);
    };

    // 处理按键输入
    process.stdin.on('data', this.stdinHandler);

    // 处理 Ctrl+C 和其他退出信号
    process.on('SIGINT', () => {
      this.quit();
    });

    process.on('SIGTERM', () => {
      this.quit();
    });

    // 开始交互
    this.showPrompt();
  }

  /**
   * 处理按键输入
   */
  private async handleKeyPress(key: string): Promise<void> {
    const segments = this.splitInputSegments(key);
    if (segments.length > 1) {
      for (const segment of segments) {
        await this.handleKeyPress(segment);
      }
      return;
    }

    // Ctrl+C
    if (key === '\x03') {
      this.quit();
      return;
    }

    // 命令选择模式
    if (this.inputMode === 'command') {
      await this.handleCommandModeKey(key);
      return;
    }

    // 正常输入模式
    await this.handleNormalModeKey(key);
  }

  private splitInputSegments(key: string): string[] {
    if (!key.includes('\n') && !key.includes('\r')) {
      return [key];
    }

    const segments: string[] = [];
    let buffer = '';

    for (let i = 0; i < key.length; i += 1) {
      const char = key[i];
      if (char === '\r') {
        if (key[i + 1] === '\n') {
          i += 1;
        }
        if (buffer.length > 0) {
          segments.push(buffer);
          buffer = '';
        }
        segments.push('\n');
        continue;
      }
      if (char === '\n') {
        if (buffer.length > 0) {
          segments.push(buffer);
          buffer = '';
        }
        segments.push('\n');
        continue;
      }
      buffer += char;
    }

    if (buffer.length > 0) {
      segments.push(buffer);
    }

    return segments.length > 0 ? segments : ['\n'];
  }

  /**
   * 处理命令选择模式的按键
   */
  private async handleCommandModeKey(key: string): Promise<void> {
    // Enter - 执行选中的命令
    if (key === '\r' || key === '\n') {
      const selectedCommand = this.commandSelector.getSelectedCommand();
      this.commandSelector.deactivate();
      this.inputMode = 'normal';
      this.normalInputBuffer = '';

      if (selectedCommand) {
        console.log();
        await selectedCommand.action();
      } else {
        this.showPrompt();
      }
      return;
    }

    // Esc - 退出命令模式
    if (key === '\x1b') {
      this.commandSelector.deactivate();
      this.inputMode = 'normal';
      this.normalInputBuffer = '';
      this.showPrompt();
      return;
    }

    // 上箭头
    if (key === '\x1b[A') {
      this.commandSelector.handleArrowUp();
      return;
    }

    // 下箭头
    if (key === '\x1b[B') {
      this.commandSelector.handleArrowDown();
      return;
    }

    // 退格键
    if (key === '\x7f' || key === '\b') {
      // 如果 filterText 为空，按退格键退出命令模式
      if (this.commandSelector.getFilterText().length === 0) {
        this.commandSelector.deactivate();
        this.inputMode = 'normal';
        this.normalInputBuffer = '';
        this.showPrompt();
        return;
      }
      this.commandSelector.handleBackspace();
      // commandSelector 已经负责刷新输入行，不需要再调用 refreshPromptLine
      return;
    }

    // 处理多字符输入（粘贴或快速输入）
    // 过滤掉控制字符，只保留可打印字符
    const printableChars = key
      .split('')
      .filter((char) => char.length === 1 && char >= ' ' && char !== '/');
    if (printableChars.length > 0) {
      for (const char of printableChars) {
        this.commandSelector.handleCharInput(char);
      }
      return;
    }
  }

  /**
   * 处理正常输入模式的按键
   */
  private async handleNormalModeKey(key: string): Promise<void> {
    // Enter - 提交输入
    if (key === '\r' || key === '\n') {
      const input = this.normalInputBuffer;
      this.normalInputBuffer = '';
      console.log();
      await this.handleUserInput(input);
      return;
    }

    // / - 进入命令选择模式
    if (key === '/') {
      this.inputMode = 'command';
      this.commandSelector.activate();
      this.refreshPromptLine();
      return;
    }

    // 退格键
    if (key === '\x7f' || key === '\b') {
      if (this.normalInputBuffer.length > 0) {
        this.normalInputBuffer = this.normalInputBuffer.slice(0, -1);
        this.refreshPromptLine();
      }
      return;
    }

    // 处理多字符输入（粘贴或快速输入）
    // 过滤掉控制字符，只保留可打印字符
    const printableChars = key
      .split('')
      .filter((char) => char.length === 1 && char >= ' ');
    if (printableChars.length > 0) {
      this.normalInputBuffer += printableChars.join('');
      this.refreshPromptLine();
      return;
    }
  }

  private async cleanupAndExit(code: number): Promise<void> {
    if (this.agent && this.agent.isObservabilityEnabled()) {
      await this.agent.flushObservability();
    }

    process.exit(code);
  }
}
