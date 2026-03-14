#!/usr/bin/env node

/**
 * Mini Agent Memory Worker - 后台消费长期记忆队列
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ChatOpenAI } from '@langchain/openai';
import { Command } from 'commander';

import { ModelConfigManager } from '../config/model-config.js';
import { VectorDatabaseClient } from '../agent/memory/vector-database-client.js';
import { LongTermMemoryManager } from '../agent/memory/long-term-memory-manager.js';

/**
 * Worker 状态接口
 */
interface WorkerStatus {
  pid: number;
  timestamp: string;
  pendingJobs: number;
  parentPid: number | null;
  uptime: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 写入状态文件（用于父进程监控）
 */
function writeStatusFile(status: WorkerStatus): void {
  try {
    const statusDir = join(tmpdir(), 'mini-agent');
    if (!existsSync(statusDir)) {
      mkdirSync(statusDir, { recursive: true });
    }
    const statusPath = join(statusDir, `worker-${status.pid}.json`);
    writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch {
    // 静默失败，不影响主流程
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('memory-consumer-worker')
    .description('长期记忆后台 Worker')
    .option('-c, --config <path>', '.env配置文件路径')
    .option('--poll <ms>', '队列轮询间隔（毫秒）', (v) => Number(v))
    .option('--parent-pid <pid>', '父进程 PID', (v) => Number(v))
    .option('--drain-on-parent-exit', '父进程退出后，处理完队列再退出');

  program.parse(process.argv);
  const options = program.opts();

  const configManager = new ModelConfigManager(
    options.config as string | undefined
  );
  const config = configManager.getConfig();

  const longTermMemory = config.longTermMemory;
  if (!longTermMemory?.enabled) {
    console.error('❌ [Worker] 长期记忆未启用，无法启动 Worker');
    process.exit(1);
  }

  if (!longTermMemory.supabaseUrl || !longTermMemory.supabaseApiKey) {
    console.error('❌ [Worker] 向量数据库配置不完整，无法启动 Worker');
    process.exit(1);
  }

  const llm = new ChatOpenAI({
    model: config.modelName,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 2048,
    configuration: {
      baseURL: config.baseUrl,
      ...(config.apiKey && { apiKey: config.apiKey }),
    },
  });

  const dbClient = new VectorDatabaseClient({
    supabaseUrl: longTermMemory.supabaseUrl,
    supabaseApiKey: longTermMemory.supabaseApiKey,
    tableName: longTermMemory.tableName,
    embeddingDimension: longTermMemory.embeddingDimension,
    embeddingApiUrl: longTermMemory.embeddingApiUrl,
    embeddingModel: longTermMemory.embeddingModel,
    embeddingApiKey: longTermMemory.embeddingApiKey,
  });

  const memoryManager = new LongTermMemoryManager(dbClient, llm, {
    enabled: true,
    topK: longTermMemory.topK ?? 5,
    extractionThreshold: longTermMemory.extractionThreshold ?? 0.7,
    queueWorkerEnabled: true,
    queuePollIntervalMs:
      Number.isFinite(options.poll) && (options.poll as number) > 0
        ? (options.poll as number)
        : undefined,
  });

  const connected = await memoryManager.initialize();
  if (!connected) {
    console.error('❌ [Worker] 向量数据库连接失败，Worker 退出');
    process.exit(1);
  }

  const parentPid = Number(options.parentPid);
  const drainOnParentExit =
    Boolean(options.drainOnParentExit) || Number.isFinite(parentPid);

  // 启动时间戳
  const startTime = Date.now();

  // 定期发送心跳和状态（通过文件）
  const heartbeatInterval = setInterval(() => {
    void (async () => {
      try {
        const pendingJobs = await memoryManager.getPendingJobCount();
        const status: WorkerStatus = {
          pid: process.pid,
          timestamp: new Date().toISOString(),
          pendingJobs,
          parentPid: Number.isFinite(parentPid) ? parentPid : null,
          uptime: Math.floor((Date.now() - startTime) / 1000),
        };

        // 写入状态文件供父进程监控
        writeStatusFile(status);

        // 如果有 IPC 通道，发送消息给父进程
        if (process.send) {
          process.send({
            type: 'heartbeat',
            status,
          });
        }
      } catch (error) {
        console.error('❌ [Worker] 发送心跳失败:', error);
      }
    })();
  }, 5000); // 每 5 秒发送一次心跳

  let parentGone = false;
  if (Number.isFinite(parentPid)) {
    const checkIntervalMs = 2000;
    setInterval(() => {
      if (!parentGone && !isProcessAlive(parentPid)) {
        parentGone = true;
        console.log('ℹ️ [Worker] 父进程已退出，将在队列清空后自动退出');
      }
    }, checkIntervalMs);

    if (drainOnParentExit) {
      setInterval(() => {
        if (!parentGone) {
          return;
        }
        void (async () => {
          const pending = await memoryManager.getPendingJobCount();
          if (pending === 0) {
            console.log('✓ [Worker] 队列已清空，Worker 退出');
            memoryManager.shutdown();
            process.exit(0);
          }
        })();
      }, 2000);
    }
  }

  const shutdown = () => {
    console.log('🔌 [Worker] 收到退出信号，正在关闭...');
    clearInterval(heartbeatInterval);
    memoryManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 立即发送初始状态
  void (async () => {
    try {
      const pendingJobs = await memoryManager.getPendingJobCount();
      writeStatusFile({
        pid: process.pid,
        timestamp: new Date().toISOString(),
        pendingJobs,
        parentPid: Number.isFinite(parentPid) ? parentPid : null,
        uptime: 0,
      });
    } catch {
      // 静默失败
    }
  })();

  console.log('✓ [Worker] 长期记忆 Worker 已启动');
  console.log(
    `📋 [Worker] PID: ${process.pid}, 父进程 PID: ${parentPid || '无'}`
  );
}

void main();
