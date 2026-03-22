# ExecutionEngine API 文档

## 概述

ExecutionEngine 是 Agent 系统的核心执行引擎，实现了 OBSERVE → PLAN → ACT → REFLECT 的状态机循环。它负责协调工具执行、记忆管理、反思决策和终止条件检查。

## 类定义

```typescript
class ExecutionEngine {
  constructor(config: Partial<ExecutionConfig>, deps: ExecutionEngineDeps);
}
```

## 构造函数参数

### ExecutionConfig

| 参数                 | 类型   | 默认值  | 说明                  |
| -------------------- | ------ | ------- | --------------------- |
| maxIterations        | number | 10      | 最大迭代次数          |
| maxExecutionTime     | number | 300000  | 最大执行时间（毫秒）  |
| maxWorkingMemorySize | number | 10      | 工作记忆最大消息数    |
| maxToolMemorySize    | number | 100     | 工具记忆最大记录数    |
| summaryTriggerRound  | number | 5       | 触发摘要的轮数间隔    |
| summaryTriggerTokens | number | 100000  | 触发摘要的 Token 阈值 |
| tokenThreshold       | number | 1000000 | Token 预算阈值        |
| toolTimeout          | number | 30000   | 工具执行超时（毫秒）  |
| maxRetryPerTool      | number | 3       | 每个工具最大重试次数  |

### ExecutionEngineDeps

```typescript
interface ExecutionEngineDeps {
  llm: ChatOpenAI; // LLM 实例
  tools: ToolInfo[]; // 可用工具列表
  generateSummary: (messages: Message[]) => Promise<string>; // 摘要生成函数
  executeTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>; // 工具执行函数
  reflectorConfig?: Partial<ReflectorConfig>; // 反思器配置
}
```

## 核心方法

### run(userPrompt: string)

执行 Agent 循环，返回最终答案和执行指标。

**参数：**

- `userPrompt`: 用户输入的提示词

**返回值：**

```typescript
Promise<{
  finalAnswer: string; // 最终答案
  metrics: ExecutionMetrics; // 执行指标
}>;
```

**示例：**

```typescript
const engine = new ExecutionEngine(config, deps);
const result = await engine.run('搜索今天的天气');
console.log(result.finalAnswer);
console.log(result.metrics);
```

### getPhase()

获取当前执行阶段。

**返回值：** `ExecutionPhase` - OBSERVE | PLAN | ACT | REFLECT

### getIteration()

获取当前迭代次数。

**返回值：** `number`

### getWorkingMemory()

获取工作记忆实例。

**返回值：** `ConversationHistory`

### getToolMemory()

获取工具记忆实例。

**返回值：** `ToolMemory`

### getSummaryMemory()

获取摘要记忆实例。

**返回值：** `SummaryMemory`

### getDeduplicationEngine()

获取去重引擎实例。

**返回值：** `DeduplicationEngine`

## 执行流程

### 1. OBSERVE 阶段

- 收集当前状态快照
- 生成状态摘要（StateDigest）
- 检测状态变更（StateDelta）
- 构建 PlanningContext
- 更新工作记忆

### 2. PLAN 阶段

- 调用规划器生成计划
- 解析计划响应
- 如果是最终答案，直接返回

### 3. ACT 阶段

- 执行工具调用（支持并行）
- 收集工具结果
- 更新工具记忆和工作记忆
- 记录执行指标

### 4. EVALUATE 阶段

- 评估工具执行结果质量
- 计算综合评分（0-1范围）
- 根据评分决策下一步：
  - 评分 ≥ 0.8：进入 REFLECT 阶段
  - 评分 < 0.4：进入 PLAN 阶段重新规划
  - 其他情况：进入 REFLECT 阶段

### 5. REFLECT 阶段

- 分析工具执行结果
- 评估信息增长
- 做出决策：continue / retry / finalize_answer / fallback

## 终止条件

引擎会在以下情况终止：

1. **规划器返回最终答案** - `isFinalAnswer: true`
2. **反思阶段返回最终答案** - `decision: 'finalize_answer'`
3. **达到最大迭代次数** - `iteration >= maxIterations`
4. **达到最大执行时间** - `elapsedTime >= maxExecutionTime`
5. **Token 预算超限** - `tokenUsage >= tokenThreshold`
6. **工具执行失败降级** - `decision: 'fallback'`
7. **无信息增长** - 连续多次无信息增长

## 错误处理

- 工具执行失败会记录到工具记忆
- 计划解析失败会返回空计划并标记为最终答案
- 摘要生成失败会记录错误但继续执行

## 性能考虑

- 并行工具执行减少总耗时
- 定期摘要生成控制内存增长
- 去重机制避免重复工具调用
- 指标收集帮助性能分析

## 日志和监控

引擎会输出详细的日志信息，格式为 `[阶段] 消息`，便于调试和监控。

示例日志：

```
[OBSERVE] 收集状态完成
[PLAN] 生成计划，包含 3 个步骤
[ACT] 执行工具 (迭代 0), 步骤数: 2
[ACT] 生成 1 个波次
[ACT] 波次 0: 2 成功, 0 失败, 耗时 1500ms
[REFLECT] 反思阶段 (迭代 0)
[REFLECT] 反思完成，耗时 50ms，决策: new_plan
[SUMMARY] 触发摘要生成
```
