#!/usr/bin/env node

/**
 * Mini Agent Memory Worker - 后台消费长期记忆队列
 */

import { Command } from 'commander';
import { ChatOpenAI } from '@langchain/openai';

import { ModelConfigManager } from '../config/model-config.js';
import { VectorDatabaseClient } from '../agent/memory/vector-database-client.js';
import { LongTermMemoryManager } from '../agent/memory/long-term-memory-manager.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
    memoryManager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('✓ [Worker] 长期记忆 Worker 已启动');
}

void main();
