# 性能优化指南

## 概述

Mini Agent 的执行引擎经过精心设计，支持多种性能优化策略。本文档介绍如何优化执行性能，包括 PlanningContext 构建、摘要生成、去重检查和指标采样等方面。

## 1. PlanningContext 构建优化

### 1.1 缓存优化

PlanningContext 的构建是执行引擎的关键路径，我们采用多层缓存策略：

```typescript
// 缓存工具定义摘要
private toolSummaryCache = new Map<string, ToolSummary>();

// 缓存记忆摘要
private memorySummaryCache = new Map<string, string>();

// 缓存去重统计
private dedupStatsCache = new Map<string, DedupStats>();
```

### 1.2 增量更新

避免每次重新构建完整的 PlanningContext：

```typescript
// 增量更新工具记忆
if (toolMemory.hasChanged()) {
  context.toolHistory = toolMemory.getSummary();
  toolMemory.markUnchanged();
}

// 增量更新工作记忆
if (conversationHistory.hasChanged()) {
  context.recentMessages = conversationHistory.getRecent(10);
  conversationHistory.markUnchanged();
}
```

### 1.3 异步构建

对于非关键路径，采用异步构建：

```typescript
// 异步构建完整上下文
const fullContext = await planningContextFactory.buildFullAsync();

// 同步构建精简上下文（用于快速检查）
const lightweightContext = planningContextFactory.buildLightweight();
```

### 1.4 性能指标

监控 PlanningContext 构建性能：

```typescript
const startTime = Date.now();
const context = await planningContextFactory.build();
const buildTime = Date.now() - startTime;

metrics.recordContextBuildTime(buildTime);
logger.debug('PERFORMANCE', 'PlanningContext 构建完成', {
  buildTime,
  toolCount: context.availableTools.length,
  memorySize: context.conversationSummary.length,
});
```

## 2. 摘要生成优化

### 2.1 Token 估算优化

使用高效的 Token 估算算法：

```typescript
// 快速 Token 估算（基于字符数）
function estimateTokensFast(text: string): number {
  // 中文：1 字符 ≈ 2 tokens
  // 英文：4 字符 ≈ 1 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishChars = text.length - chineseChars;
  return chineseChars * 2 + Math.ceil(englishChars / 4);
}

// 精确 Token 估算（使用 tiktoken）
async function estimateTokensPrecise(text: string): Promise<number> {
  const encoding = await getEncoding('cl100k_base');
  return encoding.encode(text).length;
}
```

### 2.2 摘要触发优化

智能判断是否需要生成摘要：

```typescript
// 基于轮数的触发
if (iteration % summaryTriggerRound === 0) {
  shouldSummarize = true;
}

// 基于 Token 的触发（快速估算）
const estimatedTokens = estimateTokensFast(conversationHistory.getText());
if (estimatedTokens > summaryTriggerTokens) {
  shouldSummarize = true;
}

// 基于消息数量的触发
if (conversationHistory.size() > maxWorkingMemorySize * 1.5) {
  shouldSummarize = true;
}
```

### 2.3 摘要内容优化

减少摘要的 Token 消耗：

```typescript
// 只保留最近的工具结果
const recentToolResults = toolMemory.getRecent(5);

// 压缩摘要内容
const compressedSummary = compressSummary(summary, {
  maxLength: 500,
  keepKeyInfo: true,
  removeDuplicates: true,
});
```

### 2.4 并行摘要生成

对于多个独立的摘要任务，采用并行处理：

```typescript
const [workingMemorySummary, toolMemorySummary] = await Promise.all([
  generateWorkingMemorySummary(conversationHistory),
  generateToolMemorySummary(toolMemory),
]);
```

## 3. 去重检查优化

### 3.1 哈希计算优化

使用高效的哈希算法：

```typescript
// 使用 xxHash（快速）
import { xxhash3 } from 'xxhash-wasm';

function calculateInputHash(args: Record<string, unknown>): string {
  const inputStr = JSON.stringify(args, Object.keys(args).sort());
  return xxhash3(inputStr).toString(16);
}

// 使用 MurmurHash（平衡）
import { murmurhash3 } from 'murmurhash';

function calculateInputHashMurmur(args: Record<string, unknown>): string {
  const inputStr = JSON.stringify(args, Object.keys(args).sort());
  return murmurhash3(inputStr).toString(16);
}
```

### 3.2 索引优化

为常用查询建立索引：

```typescript
// 工具名称索引
private toolNameIndex = new Map<string, Set<string>>();

// 时间窗口索引
private timeWindowIndex = new Map<number, Set<string>>();

// 输入哈希索引
private hashIndex = new Map<string, string>();
```

### 3.3 批量检查

批量处理多个去重检查：

```typescript
// 批量检查工具调用
const toolCalls = plan.steps.map((step) => ({
  toolName: step.toolName,
  args: step.args,
}));

const dedupResults = deduplicationEngine.checkBatch(toolCalls);

// 批量更新记录
deduplicationEngine.recordBatch(toolCalls, dedupResults);
```

### 3.4 缓存策略

缓存最近的去重结果：

```typescript
// LRU 缓存
private dedupCache = new LRUCache<string, DedupResult>({
  max: 1000,
  ttl: 60000, // 1 分钟
});

// 检查缓存
const cacheKey = `${toolName}:${inputHash}`;
if (dedupCache.has(cacheKey)) {
  return dedupCache.get(cacheKey);
}
```

## 4. 指标采样优化

### 4.1 采样策略

根据指标类型采用不同的采样策略：

```typescript
// 全量采样（关键指标）
const criticalMetrics = ['totalTime', 'iterations', 'finalDecision'];

// 概率采样（详细指标）
const samplingRate = 0.1; // 10% 采样率
if (Math.random() < samplingRate) {
  recordDetailedMetrics(metrics);
}

// 阈值采样（异常指标）
if (duration > 1000 || errorRate > 0.1) {
  recordDetailedMetrics(metrics);
}
```

### 4.2 异步记录

非关键指标采用异步记录：

```typescript
// 异步记录详细指标
setImmediate(() => {
  metricsCollector.recordDetailed({
    toolName,
    duration,
    success,
    inputSize: JSON.stringify(args).length,
    outputSize: result.length,
  });
});
```

### 4.3 批量上报

批量处理指标上报：

```typescript
// 批量上报指标
private metricsBuffer: MetricEntry[] = [];
private readonly BATCH_SIZE = 100;
private readonly FLUSH_INTERVAL = 5000; // 5 秒

private flushMetrics(): void {
  if (this.metricsBuffer.length === 0) return;

  const batch = this.metricsBuffer.splice(0, this.BATCH_SIZE);
  this.reportMetrics(batch);
}

// 定时刷新
setInterval(() => this.flushMetrics(), this.FLUSH_INTERVAL);
```

### 4.4 内存优化

控制指标数据的内存占用：

```typescript
// 限制历史记录数量
private readonly MAX_HISTORY_SIZE = 1000;

private trimHistory(): void {
  if (this.history.length > this.MAX_HISTORY_SIZE) {
    this.history = this.history.slice(-this.MAX_HISTORY_SIZE);
  }
}

// 压缩历史数据
private compressHistory(): void {
  this.history = this.history.map(entry => ({
    timestamp: entry.timestamp,
    metrics: compressMetrics(entry.metrics),
  }));
}
```

## 5. 工具执行优化

### 5.1 并行执行优化

优化并行工具执行的性能：

```typescript
// 使用 Promise.allSettled 处理部分失败
const results = await Promise.allSettled(
  wave.map((step) => executeTool(step.toolName, step.args))
);

// 快速失败策略
if (failFast && results.some((r) => r.status === 'rejected')) {
  throw new Error('工具执行失败');
}
```

### 5.2 超时控制

精细的超时控制：

```typescript
// 单工具超时
const toolTimeout = setTimeout(() => {
  controller.abort();
}, config.toolTimeout);

// 波次级超时
const waveTimeout = setTimeout(() => {
  throw new Error('波次执行超时');
}, config.waveTimeout);
```

### 5.3 重试优化

智能重试策略：

```typescript
// 指数退避重试
async function executeWithRetry(
  toolName: string,
  args: Record<string, unknown>,
  maxRetries: number
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await executeTool(toolName, args);
    } catch (error) {
      if (attempt === maxRetries) throw error;

      // 指数退避
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await sleep(delay);
    }
  }
}
```

## 6. 内存管理优化

### 6.1 工具记忆清理

定期清理过期的工具记忆：

```typescript
// 基于时间的清理
private cleanupOldRecords(maxAge: number): void {
  const cutoff = Date.now() - maxAge;
  this.records = this.records.filter(r => r.timestamp > cutoff);
}

// 基于数量的清理
private cleanupExcessRecords(maxSize: number): void {
  if (this.records.length > maxSize) {
    this.records = this.records.slice(-maxSize);
  }
}
```

### 6.2 工作记忆优化

优化工作记忆的存储和检索：

```typescript
// 使用 Map 替代数组（O(1) 查找）
private messageMap = new Map<string, Message>();
private messageOrder: string[] = [];

// 快速获取最近消息
getRecent(count: number): Message[] {
  const recentIds = this.messageOrder.slice(-count);
  return recentIds.map(id => this.messageMap.get(id)!);
}
```

### 6.3 摘要记忆压缩

压缩摘要记忆的存储：

```typescript
// 压缩摘要内容
function compressSummary(summary: string): string {
  // 移除冗余空格
  summary = summary.replace(/\s+/g, ' ').trim();

  // 截断过长内容
  if (summary.length > 1000) {
    summary = summary.slice(0, 997) + '...';
  }

  return summary;
}
```

## 7. 性能监控

### 7.1 关键指标

监控以下关键性能指标：

```typescript
interface PerformanceMetrics {
  // 构建时间
  contextBuildTime: number;
  summaryGenerationTime: number;
  dedupCheckTime: number;

  // 执行时间
  totalExecutionTime: number;
  toolExecutionTime: number;
  parallelEfficiency: number;

  // 资源使用
  memoryUsage: number;
  tokenUsage: number;
  cacheHitRate: number;
}
```

### 7.2 性能分析

使用 Node.js 内置的性能分析工具：

```typescript
// 性能标记
performance.mark('context-build-start');
const context = await planningContextFactory.build();
performance.mark('context-build-end');

// 测量性能
performance.measure(
  'context-build',
  'context-build-start',
  'context-build-end'
);

// 获取测量结果
const measures = performance.getEntriesByName('context-build');
console.log('Context build time:', measures[0].duration);
```

### 7.3 性能报告

生成性能报告：

```typescript
function generatePerformanceReport(metrics: PerformanceMetrics): string {
  return `
性能报告
========
总执行时间: ${metrics.totalExecutionTime}ms
工具执行时间: ${metrics.toolExecutionTime}ms
并行效率: ${(metrics.parallelEfficiency * 100).toFixed(1)}%
内存使用: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB
Token 使用: ${metrics.tokenUsage}
缓存命中率: ${(metrics.cacheHitRate * 100).toFixed(1)}%
  `.trim();
}
```

## 8. 基准测试

### 8.1 基准测试套件

运行性能基准测试：

```bash
# 运行完整基准测试
npm run benchmark

# 运行特定基准测试
npm run benchmark:context-build
npm run benchmark:dedup-check
npm run benchmark:parallel-execution
```

### 8.2 基准测试报告

查看基准测试结果：

```bash
# 生成报告
npm run benchmark:report

# 比较版本
npm run benchmark:compare v1.0.0 v2.0.0
```

## 9. 最佳实践

### 9.1 开发阶段

- 启用详细日志：`LOG_LEVEL=debug`
- 使用性能分析工具：`node --inspect`
- 定期运行基准测试
- 监控内存使用情况

### 9.2 生产阶段

- 使用合适的日志级别：`LOG_LEVEL=info`
- 启用采样策略
- 定期清理历史数据
- 监控关键指标

### 9.3 调优建议

1. **根据使用场景调整参数**
   - 简单任务：减少 `maxIterations`
   - 复杂任务：增加 `maxExecutionTime`

2. **根据资源限制调整**
   - 内存受限：减少 `maxWorkingMemorySize`
   - Token 受限：增加 `summaryTriggerTokens`

3. **根据性能要求调整**
   - 高并发：增加并行度
   - 低延迟：减少重试次数

## 10. 常见问题

### Q: 如何提高执行速度？

A:

1. 增加并行工具执行的波次大小
2. 减少摘要生成的频率
3. 优化去重检查的缓存策略
4. 使用更快的哈希算法

### Q: 如何减少内存使用？

A:

1. 减小工作记忆和工具记忆的大小限制
2. 定期清理过期的记录
3. 压缩摘要内容
4. 使用流式处理大量数据

### Q: 如何优化 Token 使用？

A:

1. 调整摘要触发的 Token 阈值
2. 压缩 PlanningContext 的内容
3. 使用更高效的提示词模板
4. 减少不必要的工具调用

### Q: 如何监控性能？

A:

1. 启用性能指标收集
2. 定期查看性能报告
3. 设置性能告警阈值
4. 使用 APM 工具进行深入分析
