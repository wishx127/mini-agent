#!/usr/bin/env node

/**
 * Mini Agent CLI - 主入口文件
 */

import { CLIInterface } from './cli/interface';

async function main(): Promise<void> {
  try {
    const cli = new CLIInterface();
    await cli.start();
  } catch (error) {
    console.error('❌ 程序启动失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// 启动程序
main();