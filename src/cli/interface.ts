import * as readline from 'readline';

import { Command } from 'commander';

import { AgentCore } from '../agent/core.js';
import { ModelConfigManager } from '../config/model-config.js';

/**
 * CLI交互界面类
 */
export class CLIInterface {
  private agent!: AgentCore;
  private rl!: readline.Interface;
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  /**
   * 设置命令行命令
   */
  private setupCommands(): void {
    this.program
      .name('mini-agent')
      .description('一个最小可用的AI Agent CLI工具')
      .version('1.0.0');

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

      console.log('🤖 Agent初始化成功!');
      console.log(`📡 模型: ${config.modelName}`);
      console.log(`🌐 Base URL: ${config.baseUrl}`);
      console.log('💬 输入您的消息开始对话 (输入 "quit" 或 "exit" 退出):\n');
    } catch (error) {
      console.error(
        '❌ [Agent] 初始化失败:',
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
    this.rl.question('👤 您: ', (input) => {
      void this.handleUserInput(input);
    });
  }

  /**
   * 处理用户输入
   */
  private async handleUserInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    // 检查退出命令
    if (['quit', 'exit', 'q'].includes(trimmedInput.toLowerCase())) {
      console.log('👋 再见！');
      this.rl.close();
      return;
    }

    // 处理空输入
    if (trimmedInput.length === 0) {
      this.promptUser();
      return;
    }

    try {
      // 显示处理状态
      process.stdout.write('🤖 Agent: 思考中');

      // 调用Agent处理
      const response = await this.agent.processPrompt(trimmedInput);

      // 清除处理状态行
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      // 显示响应
      console.log(`🤖 Agent: ${response}\n`);
    } catch (error) {
      // 清除处理状态行
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      console.error(
        `❌ [Error] ${error instanceof Error ? error.message : String(error)}\n`
      );
    }

    // 继续等待下一次输入
    this.promptUser();
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
      return;
    }

    // 初始化Agent
    this.initializeAgent(configPath ?? (options.config as string | undefined));

    // 创建readline接口
    this.createReadlineInterface();

    // 设置关闭处理
    this.rl.on('close', () => {
      console.log('\n🛑 程序已退出');
      process.exit(0);
    });

    // 开始交互
    this.promptUser();
  }
}
