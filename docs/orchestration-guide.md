# 编排层使用指南

本文档介绍 Mini Agent 编排层的架构设计和配置使用方法。

## 架构概述

编排层采用基于状态机的循环执行架构，实现了 OBSERVE → PLAN → ACT → REFLECT 的多轮执行流程。

```
用户输入 → Controller.execute()
               ↓
          ExecutionEngine.run()
               ↓
          ┌─────────────────────────────────────┐
          │  OBSERVE → PLAN → ACT → REFLECT    │
          │       ↑                   │         │
          │       └───────────────────┘         │
          │         (循环直到终止条件满足)        │
          └─────────────────────────────────────┘
               ↓
          返回最终答案或降级处理
```

## 配置说明

编排层支持以下环境变量配置：

| 环境变量                          | 默认值 | 说明                 |
| --------------------------------- | ------ | -------------------- |
| `ORCHESTRATION_MAX_ITERATIONS`    | 10     | 最大迭代次数         |
| `ORCHESTRATION_TIMEOUT`           | 300000 | 执行超时时间（毫秒） |
| `ORCHESTRATION_TOKEN_THRESHOLD`   | 0.9    | Token 预警阈值       |
| `ORCHESTRATION_TOOL_TIMEOUT`      | 30000  | 工具执行超时（毫秒） |
| `ORCHESTRATION_MAX_RESULT_LENGTH` | 4000   | 结果最大字符数       |

## 使用示例

### 基础配置

```bash
# .env 文件
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-api-key

# 编排层配置
ORCHESTRATION_MAX_ITERATIONS=10
ORCHESTRATION_TIMEOUT=300000
ORCHESTRATION_TOKEN_THRESHOLD=0.9
```

### 编程配置

```typescript
import { AgentCore } from './src/agent/core.js';
import { ModelConfig } from './src/types/model-config.js';

const config: ModelConfig = {
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
  orchestration: {
    maxIterations: 10,
    timeout: 300000,
    tokenThreshold: 0.9,
    toolTimeout: 30000,
    maxResultLength: 8000,
  },
};

const agent = new AgentCore(config);
const response = await agent.processPrompt('今天天气怎么样？');
console.log(response);
```

## 核心组件

### ExecutionEngine（执行引擎）

执行引擎是编排层的核心，负责管理多轮循环执行：

- **状态机管理**：维护 OBSERVE → PLAN → ACT → REFLECT 状态转移
- **循环控制**：管理迭代次数和终止条件检查
- **记忆系统**：协调工作记忆、工具记忆和摘要记忆
- **并行执行**：支持工具调用的并行执行

### Reflector（反思器）

反思器负责评估工具执行结果并做出决策：

- **成功率评估**：分析工具调用的成功/失败情况
- **信息增长检测**：判断是否获得新信息
- **错误归因**：分析失败原因（工具/规划器/系统）
- **决策制定**：选择 continue/retry/new_plan/finalize_answer/fallback

### ParallelExecutor（并行执行器）

并行执行器负责工具的并行调用：

- **依赖图解析**：识别工具调用之间的依赖关系
- **拓扑排序**：确定执行顺序和波次划分
- **并行执行**：同时执行无依赖的工具调用
- **超时控制**：波次级和工具级的超时管理

### DeduplicationEngine（去重引擎）

去重引擎负责避免重复的工具调用：

- **输入哈希**：计算工具调用的输入哈希
- **重复检测**：识别相同的工具调用
- **重试预算**：管理每个工具的重试次数
- **智能建议**：提供去重警告和建议

## 记忆系统

### 工作记忆（Working Memory）

存储最近的对话消息，用于规划器的上下文：

- **FIFO 淘汰**：保留最近 N 条消息
- **Token 限制**：基于 Token 数量的自动压缩
- **消息类型**：支持 user/assistant/tool/system 消息

### 工具记忆（Tool Memory）

存储所有工具调用记录，用于去重和统计：

- **调用记录**：存储工具名、输入、输出、状态
- **输入哈希**：基于输入内容的去重键
- **统计信息**：成功率、平均执行时间等
- **清理策略**：基于保留期和大小限制的自动清理

### 摘要记忆（Summary Memory）

存储历史摘要，用于 Token 压缩：

- **LLM 生成**：使用 LLM 生成语义摘要
- **触发机制**：基于轮数或 Token 数量的触发
- **时间范围**：记录摘要覆盖的时间范围
- **关键信息**：保留重要的事实和决策

## 终止条件

执行引擎支持多种语义终止条件：

| 终止条件     | 优先级 | 说明                       |
| ------------ | ------ | -------------------------- |
| 规划器信号   | 1      | 规划器返回 `type: "final"` |
| 无信息增长   | 2      | 连续 N 轮无新信息          |
| 最大迭代     | 3      | 达到最大迭代次数限制       |
| Token 超预算 | 4      | Token 使用超过阈值         |
| 执行超时     | 5      | 总执行时间超过限制         |
| 失败预算     | 6      | 工具失败次数超过预算       |

## 配置参数详解

### 执行配置

```typescript
interface ExecutionConfig {
  maxIterations: number; // 最大迭代次数（默认 10）
  maxExecutionTime: number; // 最大执行时间（默认 300000ms）
  maxWorkingMemorySize: number; // 工作记忆大小（默认 10）
  maxToolMemorySize: number; // 工具记忆大小（默认 100）
  summaryTriggerRound: number; // 摘要触发轮数（默认 5）
  summaryTriggerTokens: number; // 摘要触发 Token（默认 8000）
  tokenThreshold: number; // Token 阈值（默认 0.9）
  toolTimeout: number; // 工具超时（默认 30000ms）
  maxRetryPerTool: number; // 每工具最大重试（默认 3）
  enableParallelExecution: boolean; // 启用并行执行（默认 true）
}
```

### 反思配置

```typescript
interface ReflectorConfig {
  strategy: 'conservative' | 'balanced' | 'aggressive'; // 策略
  timeoutMs: number; // 反思超时（默认 100ms）
  similarityThreshold: number; // 相似度阈值（默认 0.7）
  maxRetryPerTool: number; // 每工具最大重试（默认 3）
}
```

### 终止配置

```typescript
interface TerminationConfig {
  maxIterations: number; // 最大迭代（默认 10）
  maxExecutionTime: number; // 最大时间（默认 300000ms）
  tokenBudgetThreshold: number; // Token 阈值（默认 0.9）
  similarityThreshold: number; // 相似度阈值（默认 0.95）
  noGrowthIterationsRequired: number; // 无增长轮数（默认 2）
  failureBudget: number; // 失败预算（默认 3）
  warningThresholdRatio: number; // 警告阈值比例（默认 0.8）
}
```

## 指标追踪

执行引擎会记录详细的执行指标：

```typescript
const controller = agent.getController();
const status = controller.getStatus();

console.log(status.metrics);
// {
//   startTime: 1234567890,
//   endTime: 1234567900,
//   totalDuration: 10000,
//   iterationCount: 3,
//   toolSuccessCount: 5,
//   toolFailureCount: 1,
//   toolResults: [...],
//   phaseTimings: {
//     OBSERVE: 100,
//     PLAN: 500,
//     ACT: 2000,
//     REFLECT: 200
//   },
//   terminationReason: 'planner_final'
// }
```

## 调试和追踪

### 查看执行状态

```typescript
const controller = agent.getController();
const status = controller.getStatus();

console.log('当前状态:', status.state);
console.log('当前阶段:', status.phase);
console.log('迭代次数:', status.metrics.iterationCount);
```

### 查看记忆状态

```typescript
const engine = controller.getEngine();

console.log('工作记忆:', engine.getWorkingMemory().size());
console.log('工具记忆:', engine.getToolMemory().size());
console.log('摘要记忆:', engine.getSummaryMemory().size());
```

### 查看去重状态

```typescript
const engine = controller.getEngine();
const dedupState = engine.getDeduplicationEngine().getDeduplicationState();

console.log('检测到重复:', dedupState.duplicateCallsDetected);
console.log('跳过重复:', dedupState.duplicateCallsSkipped);
console.log('重试预算:', dedupState.toolRetryBudgets);
```

## 最佳实践

### 1. 合理配置迭代次数

根据任务复杂度配置 `maxIterations`：

- 简单任务：3-5 次
- 中等任务：5-10 次
- 复杂任务：10-20 次

### 2. 监控 Token 使用

设置合理的 `tokenThreshold`（建议 0.8-0.9），避免 Token 超限。

### 3. 使用并行执行

启用 `enableParallelExecution` 提升性能，特别是对于独立的工具调用。

### 4. 配置合适的超时

根据工具响应时间配置 `toolTimeout`，避免不必要的等待。

### 5. 监控终止原因

通过 `terminationReason` 了解执行终止的原因，优化配置和工具。

## 故障排除

### 执行超时

如果频繁出现 `execution_timeout`：

- 增加 `maxExecutionTime`
- 优化工具响应时间
- 减少不必要的工具调用

### Token 超限

如果频繁出现 `token_budget_exceeded`：

- 增加 `tokenThreshold`
- 启用摘要压缩
- 减少工作记忆大小

### 无信息增长

如果频繁出现 `no_information_growth`：

- 检查工具是否返回有效结果
- 调整 `similarityThreshold`
- 优化规划器的工具选择

### 工具失败

如果频繁出现 `failure_budget_exhausted`：

- 检查工具的可用性
- 增加 `maxRetryPerTool`
- 优化工具的错误处理
