#!/usr/bin/env node

/**
 * 检查 Memory Worker 状态的工具
 */

import { checkWorkerStatus } from './worker-monitor-utils.js';

/**
 * 主函数
 */
function main(): void {
  checkWorkerStatus();
}

main();
