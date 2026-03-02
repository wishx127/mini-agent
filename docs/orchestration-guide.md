# 编排层使用指南

本文档介绍 Mini Agent 编排层的架构设计和配置使用方法。

## 架构概述

编排层采用三层架构：Controller（控制层）→ Planner（决策层）→ Executor（执行层）。

```
用户输入 → Controller.execute()
               ↓
          Planner.shouldUseTool()  // 判断是否需要工具
               ↓
          Planner.selectTool()     // 选择工具
               ↓
          Planner.generateExecutionPlan()  // 生成执行计划
               ↓
          Executor.execute()       // 执行工具
               ↓
          返回响应或兜底策略
```

## 配置说明

编排层支持以下环境变量配置：

| 环境变量                          | 默认值 | 说明                 |
| --------------------------------- | ------ | -------------------- |
| `ORCHESTRATION_MAX_ITERATIONS`    | 3      | 最大迭代次数         |
| `ORCHESTRATION_TIMEOUT`           | 30000  | 执行超时时间（毫秒） |
| `ORCHESTRATION_TOKEN_THRESHOLD`   | 0.9    | Token 预警阈值       |
| `ORCHESTRATION_TOOL_TIMEOUT`      | 10000  | 工具执行超时（毫秒） |
| `ORCHESTRATION_MAX_RESULT_LENGTH` | 4000   | 结果最大字符数       |

## 使用示例

### 基础配置

```bash
# .env 文件
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-3.5-turbo
MODEL_API_KEY=your-api-key

# 编排层配置
ORCHESTRATION_MAX_ITERATIONS=5
ORCHESTRATION_TIMEOUT=60000
ORCHESTRATION_TOKEN_THRESHOLD=0.8
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
    maxIterations: 5,
    timeout: 60000,
    tokenThreshold: 0.8,
    toolTimeout: 15000,
    maxResultLength: 8000,
  },
};

const agent = new AgentCore(config);
const response = await agent.processPrompt('今天天气怎么样？');
console.log(response);
```

## 各模块职责

### Controller（控制层）

负责全局控制和边界管理：

- **Token 限制检查**: 防止上下文溢出
- **超时控制**: 防止无限等待
- **迭代次数限制**: 防止循环调用
- **兜底策略**: 异常情况下的优雅降级

### Planner（决策层）

负责智能决策：

- **工具判断**: 判断是否需要使用工具
- **工具选择**: 选择最合适的工具
- **执行规划**: 规划工具调用顺序
- **参数验证**: 验证工具参数

### Executor（执行层）

负责工具执行：

- **工具执行**: 执行工具调用
- **重试机制**: 网络错误自动重试（指数退避）
- **错误处理**: 异常分类和处理
- **结果格式化**: 截断过长结果

## 重试策略

Executor 实现智能重试机制：

| 错误类型 | 最大重试次数 | 退避策略              |
| -------- | ------------ | --------------------- |
| 网络错误 | 3            | 指数退避 (1s, 2s, 4s) |
| 超时错误 | 2            | 固定间隔 (1s)         |
| 参数错误 | 0            | 不重试                |
| 其他错误 | 1            | 固定间隔              |

## 兜底策略

当遇到异常情况时，Controller 会执行兜底策略：

1. **Token 超限**: 截断历史消息，保留最近上下文
2. **超时**: 返回部分结果 + 超时提示
3. **迭代次数超限**: 返回已获取的结果 + 提示
4. **所有工具失败**: 返回 LLM 直接回答（降级）

## 访问编排层模块

```typescript
const agent = new AgentCore(config);

// 获取各模块实例
const controller = agent.getController();
const planner = agent.getPlanner();
const executor = agent.getExecutor();
```

## 指标追踪

编排层会记录执行指标：

```typescript
const controller = agent.getController();
const metrics = controller.getMetrics();
console.log(metrics);
// {
//   totalIterations: 3,
//   toolExecutions: 2,
//   totalTokens: 1500,
//   executionTime: 2500
// }
```
