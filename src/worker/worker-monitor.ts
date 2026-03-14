/**
 * Worker 监控器 - 监控 memory-worker 子进程状态
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Worker 状态
 */
export interface WorkerStatus {
  /** 是否存活 */
  isAlive: boolean;
  /** 进程 ID */
  pid: number | null;
  /** 运行时间（秒） */
  uptime: number;
  /** 最后心跳时间 */
  lastHeartbeat: Date | null;
  /** 重启次数 */
  restartCount: number;
  /** 最后错误信息 */
  lastError: string | null;
  /** 队列积压数量 */
  pendingJobs: number;
}

/**
 * 监控配置
 */
export interface MonitorConfig {
  /** 心跳超时时间（毫秒），默认 30000 */
  heartbeatTimeout: number;
  /** 最大重启次数，默认 5 */
  maxRestarts: number;
  /** 重启间隔（毫秒），默认 5000 */
  restartDelay: number;
  /** 健康检查间隔（毫秒），默认 10000 */
  healthCheckInterval: number;
  /** 日志文件路径 */
  logPath?: string;
}

/**
 * Worker 监控器
 */
export class WorkerMonitor {
  private workerProcess: ChildProcess | null = null;
  private startTime: number = 0;
  private lastHeartbeat: Date | null = null;
  private restartCount: number = 0;
  private lastError: string | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: MonitorConfig;
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private workerPath: string;
  private workerArgs: string[];
  private pendingJobs: number = 0;

  constructor(
    workerPath: string,
    workerArgs: string[],
    config?: Partial<MonitorConfig>
  ) {
    this.workerPath = workerPath;
    this.workerArgs = workerArgs;
    this.config = {
      heartbeatTimeout: 30000,
      maxRestarts: 5,
      restartDelay: 5000,
      healthCheckInterval: 10000,
      ...config,
    };

    // 设置日志路径
    if (!this.config.logPath) {
      const logDir = join(tmpdir(), 'mini-agent');
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.config.logPath = join(logDir, 'memory-worker.log');
    }

    // 创建日志流
    this.logStream = createWriteStream(this.config.logPath, { flags: 'a' });
  }

  /**
   * 启动 Worker
   */
  async start(): Promise<void> {
    if (this.workerProcess) {
      this.log('Worker 已在运行中');
      return;
    }

    this.log('启动 Worker...');
    await this.spawnWorker();
    this.startHealthCheck();
  }

  /**
   * 停止 Worker
   */
  async stop(): Promise<void> {
    this.log('停止 Worker...');
    this.stopHealthCheck();

    if (this.workerProcess) {
      // 发送 SIGTERM 信号
      this.workerProcess.kill('SIGTERM');

      // 等待最多 5 秒让进程优雅退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.workerProcess) {
            this.log('Worker 未响应 SIGTERM，强制终止');
            this.workerProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.workerProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.workerProcess = null;
    }

    if (this.logStream) {
      this.logStream.end();
    }
  }

  /**
   * 获取 Worker 状态
   */
  getStatus(): WorkerStatus {
    return {
      isAlive: this.isWorkerAlive(),
      pid: this.workerProcess?.pid ?? null,
      uptime:
        this.startTime > 0
          ? Math.floor((Date.now() - this.startTime) / 1000)
          : 0,
      lastHeartbeat: this.lastHeartbeat,
      restartCount: this.restartCount,
      lastError: this.lastError,
      pendingJobs: this.pendingJobs,
    };
  }

  /**
   * 更新心跳
   */
  updateHeartbeat(): void {
    this.lastHeartbeat = new Date();
  }

  /**
   * 更新队列积压数量
   */
  updatePendingJobs(count: number): void {
    this.pendingJobs = count;
  }

  /**
   * 设置错误信息
   */
  setError(error: string): void {
    this.lastError = error;
    this.log(`错误: ${error}`);
  }

  /**
   * 生成 Worker 进程
   */
  private async spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const child = spawn('node', [this.workerPath, ...this.workerArgs], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false, // 改为 false，保持引用
        });

        this.workerProcess = child;
        this.startTime = Date.now();
        this.lastError = null;

        // 管道输出到日志
        if (this.logStream) {
          child.stdout?.pipe(this.logStream);
          child.stderr?.pipe(this.logStream);
        }

        // 监听进程退出
        child.on('exit', (code, signal) => {
          this.log(`Worker 退出: code=${code}, signal=${signal}`);
          this.workerProcess = null;

          // 如果不是主动停止，尝试重启
          if (code !== 0 && this.restartCount < this.config.maxRestarts) {
            this.scheduleRestart();
          }
        });

        // 监听错误
        child.on('error', (error) => {
          this.setError(`Worker 错误: ${error.message}`);
          reject(error);
        });

        // 给进程一点启动时间
        setTimeout(() => {
          if (this.isWorkerAlive()) {
            this.log(`Worker 启动成功 (PID: ${child.pid})`);
            resolve();
          } else {
            reject(new Error('Worker 启动失败'));
          }
        }, 1000);
      } catch (error) {
        reject(
          new Error(
            `启动失败: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    });
  }

  /**
   * 安排重启
   */
  private scheduleRestart(): void {
    this.restartCount++;
    this.log(`计划重启 (第 ${this.restartCount} 次)...`);

    setTimeout(() => {
      if (this.restartCount <= this.config.maxRestarts) {
        this.spawnWorker().catch((error) => {
          this.setError(`重启失败: ${error}`);
        });
      } else {
        this.setError(`达到最大重启次数 (${this.config.maxRestarts})`);
      }
    }, this.config.restartDelay);
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    // 定期检查进程存活
    this.healthCheckTimer = setInterval(() => {
      if (
        !this.isWorkerAlive() &&
        this.restartCount < this.config.maxRestarts
      ) {
        this.log('健康检查: Worker 未运行，尝试重启');
        this.scheduleRestart();
      }
    }, this.config.healthCheckInterval);

    // 定期检查心跳超时
    this.heartbeatTimer = setInterval(() => {
      if (this.lastHeartbeat) {
        const elapsed = Date.now() - this.lastHeartbeat.getTime();
        if (elapsed > this.config.heartbeatTimeout) {
          this.setError(`心跳超时 (${elapsed}ms)`);
        }
      }
    }, this.config.heartbeatTimeout / 2);
  }

  /**
   * 停止健康检查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 检查 Worker 是否存活
   */
  private isWorkerAlive(): boolean {
    if (!this.workerProcess || !this.workerProcess.pid) {
      return false;
    }

    try {
      // 发送信号 0 检查进程是否存在
      process.kill(this.workerProcess.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 记录日志
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [Monitor] ${message}\n`;
    console.log(`[WorkerMonitor] ${message}`);

    if (this.logStream) {
      this.logStream.write(logLine);
    }
  }
}
