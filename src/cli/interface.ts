import * as readline from 'readline';
import { createRequire } from 'module';

import chalk from 'chalk';
import { Command } from 'commander';

import { AgentCore } from '../agent/core.js';
import { ModelConfigManager } from '../config/model-config.js';

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
 * CLI交互界面类
 */
export class CLIInterface {
  private agent!: AgentCore;
  private rl!: readline.Interface;
  private program: Command;
  private displayManager: DisplayManager;

  constructor() {
    this.program = new Command();
    this.displayManager = new DisplayManager();
    this.setupCommands();
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
   * 初始化Agent
   */
  private initializeAgent(configPath?: string): void {
    try {
      const configManager = new ModelConfigManager(configPath);
      const config = configManager.getConfig();
      this.agent = new AgentCore(config);

      console.log();
      console.log(
        Colors.primary('mini-agent ') + Colors.secondary(`v${VERSION}`)
      );
      console.log(Colors.secondary('─'.repeat(40)));
      console.log(Colors.secondary('Model: ') + config.modelName);
      console.log(Colors.secondary('Endpoint: ') + config.baseUrl);
      console.log();
      console.log(
        Colors.secondary(
          'Type your message. Press Ctrl+C or enter "quit" to exit.'
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

  /**
   * 创建readline接口
   */
  private createReadlineInterface(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * 显示提示符并等待用户输入
   */
  private promptUser(): void {
    this.rl.question(Colors.primary('> '), (input) => {
      void this.handleUserInput(input).catch((error) => {
        console.error(
          Colors.primary('[Error] '),
          error instanceof Error ? error.message : error
        );
        // 即使出错也要继续提示用户
        this.promptUser();
      });
    });
  }

  /**
   * 处理用户输入
   */
  private async handleUserInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    // 检查退出命令
    if (['quit', 'exit'].includes(trimmedInput.toLowerCase())) {
      console.log(Colors.secondary('Goodbye.'));
      this.rl.close();
      return;
    }

    // 处理空输入
    if (trimmedInput.length === 0) {
      this.promptUser();
      return;
    }

    console.log();

    const startTime = Date.now();
    const loadingMsg = getRandomLoadingMessage();
    // 记录请求前的会话 token 累计（展示在 spinner 中）
    const prevSession = this.agent.getSessionTokenSummary();

    // 启动计时器：每 200ms 更新 spinner 文字，展示实时elapsed + 会话 token 总量
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
      this.promptUser();
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

    // 创建readline接口
    this.createReadlineInterface();

    // 设置关闭处理
    this.rl.on('close', () => {
      console.log();
      process.exit(0);
    });

    // 开始交互
    this.promptUser();
  }
}
