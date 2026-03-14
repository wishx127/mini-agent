import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import chalk from 'chalk';

// 获取临时目录路径
const TEMP_DIR = tmpdir();

export interface WorkerStatus {
  pid: number;
  timestamp: string;
  pendingJobs: number;
  parentPid: number | null;
  uptime: number;
}

/**
 * 检查进程是否存活
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取所有 Worker 状态文件
 */
export function getWorkerStatusFiles(): string[] {
  const statusDir = join(TEMP_DIR, 'mini-agent');
  try {
    const files = readdirSync(statusDir);
    return files
      .filter((f: string) => f.startsWith('worker-') && f.endsWith('.json'))
      .map((f: string) => join(statusDir, f));
  } catch {
    // 目录不存在时不报错，返回空列表
    return [];
  }
}

/**
 * 读取并解析状态文件
 */
export function readWorkerStatus(filePath: string): WorkerStatus | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WorkerStatus;
  } catch {
    return null;
  }
}

/**
 * 格式化运行时间
 */
export function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  }
}

/**
 * 执行 Worker 状态检查并输出结果
 */
export function checkWorkerStatus(): void {
  console.log(chalk.bold('\n📊 Memory Worker 状态检查\n'));

  const statusFiles = getWorkerStatusFiles();

  if (statusFiles.length === 0) {
    console.log(chalk.yellow('⚠️  没有找到运行中的 Worker'));
    const statusDir = join(TEMP_DIR, 'mini-agent');
    console.log(chalk.gray(`提示: Worker 状态文件位于: ${statusDir}`));
    return;
  }

  const activeWorkers: Array<{ status: WorkerStatus; file: string }> = [];
  const deadWorkers: string[] = [];

  // 检查每个 Worker
  for (const file of statusFiles) {
    const status = readWorkerStatus(file);
    if (!status) {
      deadWorkers.push(file);
      continue;
    }

    if (isProcessAlive(status.pid)) {
      activeWorkers.push({ status, file });
    } else {
      deadWorkers.push(file);
    }
  }

  // 清理死亡的 Worker 状态文件
  for (const file of deadWorkers) {
    try {
      unlinkSync(file);
    } catch {
      // 忽略删除失败
    }
  }

  if (deadWorkers.length > 0) {
    console.log(
      chalk.gray(`清理了 ${deadWorkers.length} 个已终止 Worker 的状态文件\n`)
    );
  }

  // 显示活跃的 Worker
  if (activeWorkers.length === 0) {
    console.log(chalk.yellow('⚠️  没有活跃的 Worker'));
    return;
  }

  for (let i = 0; i < activeWorkers.length; i++) {
    const { status } = activeWorkers[i];
    const heartbeatAge = Date.now() - new Date(status.timestamp).getTime();
    const isHealthy = heartbeatAge < 15000; // 15 秒内的心跳视为健康

    console.log(chalk.bold(`Worker #${i + 1}`));
    console.log(`  PID:            ${chalk.cyan(status.pid)}`);
    console.log(
      `  状态:           ${isHealthy ? chalk.green('● 运行中') : chalk.yellow('● 心跳超时')}`
    );
    console.log(`  运行时间:       ${formatUptime(status.uptime)}`);
    console.log(`  队列积压:       ${status.pendingJobs} 个任务`);
    console.log(`  父进程 PID:     ${status.parentPid ?? '无'}`);
    console.log(
      `  最后心跳:       ${new Date(status.timestamp).toLocaleString()}`
    );
    console.log(`  心跳延迟:       ${(heartbeatAge / 1000).toFixed(1)} 秒`);
    console.log();
  }

  // 健康检查建议
  const unhealthyWorkers = activeWorkers.filter(
    ({ status }) => Date.now() - new Date(status.timestamp).getTime() > 15000
  );

  if (unhealthyWorkers.length > 0) {
    console.log(chalk.yellow('⚠️  警告: 有 Worker 心跳超时'));
    console.log(chalk.gray('建议: 检查日志文件或重启 Worker'));
  } else {
    console.log(chalk.green('✓ 所有 Worker 状态正常'));
  }

  // 显示监控相关信息
  console.log(chalk.gray('\n提示:'));
  console.log(chalk.gray('  - 查看日志: tail -f memory-worker.log'));
  const statusFilePath = join(TEMP_DIR, 'mini-agent');
  console.log(chalk.gray(`  - 状态文件: ${statusFilePath}`));
}
