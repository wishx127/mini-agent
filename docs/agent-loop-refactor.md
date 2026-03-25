# Agent Loop Refactor - 评估阶段与状态管理重构

## 概述

本次重构在执行引擎中引入了两个关键增强：

1. **EVALUATE 阶段** - 在 ACT 和 REFLECT 之间添加了智能评估层
2. **状态快照系统** - 增强了 OBSERVE 阶段的系统状态追踪能力

## 新增组件

### 1. Evaluator（评估器）

`src/agent/execution/evaluator.ts` - 负责在 ACT 阶段后评估工具执行结果

```typescript
interface EvaluationScore {
  accuracy: number; // 准确性评估 (0-1)
  completeness: number; // 完整性评估 (0-1)
  efficiency: number; // 效率评估 (0-1)
  confidence: number; // 置信度评估 (0-1)
  overall: number; // 综合评分 (0-1)
  details: {
    successCount: number;
    failureCount: number;
    totalCount: number;
    avgExecutionTime: number;
    informationGrowth: number;
    planCompletion: number;
  };
  suggestions: string[];
  timestamp: number;
  iteration: number;
}
```

**评估逻辑：**

- 分析工具执行结果的质量
- 计算成功率、响应质量、性能评分
- 综合评分决定后续流程

### 2. StateDigestGenerator（状态摘要生成器）

`src/agent/execution/state-digest.ts` - 为 OBSERVE 阶段生成系统状态摘要

**功能：**

- 收集系统状态快照
- 生成启发式状态摘要
- 识别关键指标（进度率、成功率、信息增长率）
- 生成警告信息

### 3. DeltaDetector（变更检测器）

`src/agent/execution/delta-detector.ts` - 检测系统状态变化

**功能：**

- 对比当前与上一次状态快照
- 检测工作记忆大小变化
- 检测工具记忆变化
- 识别状态跳过原因

## 状态机流程变更

### 重构前的流程

```
OBSERVE → PLAN → ACT → REFLECT → (继续循环或终止)
```

### 重构后的流程

```
OBSERVE → PLAN → ACT → EVALUATE → REFLECT → (继续循环或终止)
```

### EVALUATE 阶段决策逻辑

```
评分 >= 0.8:  进入 REFLECT 阶段（执行良好）
评分 < 0.4:  进入 PLAN 阶段重新规划（执行较差）
其他:       进入 REFLECT 阶段（执行一般）
```

## 状态快照数据结构

```typescript
interface StateSnapshot {
  iteration: number; // 当前迭代
  timestamp: number; // 时间戳
  workingMemorySize: number; // 工作记忆大小
  workingMemoryTokens: number; // 工作记忆 Token 数
  toolMemorySize: number; // 工具记忆大小
  recentToolRecords: ToolRecord[]; // 最近工具记录
  currentPlanProgress: {
    totalSteps: number; // 总步骤数
    completedSteps: number; // 已完成步骤
    remainingSteps: number; // 剩余步骤
  };
  failureStats: {
    totalFailures: number; // 总失败数
    recentFailures: number; // 最近失败数
    retryCount: number; // 重试次数
  };
  performanceStats: {
    avgToolExecutionTime: number; // 平均工具执行时间
    totalExecutionTime: number; // 总执行时间
  };
}
```

## 状态摘要数据结构

```typescript
interface StateDigest {
  summary: string; // 状态摘要文本
  keyMetrics: {
    progressRate: number; // 进度率 (0-1)
    successRate: number; // 成功率 (0-1)
    informationGrowth: number; // 信息增长率 (0-1)
  };
  highlights: string[]; // 亮点列表
  warnings: string[]; // 警告列表
  timestamp: number; // 时间戳
  iteration: number; // 迭代次数
}
```

## 状态变更数据结构

```typescript
interface StateDelta {
  progress_delta: number; // 进度变化
  new_errors: number; // 新增错误数
  new_tools_used: boolean; // 是否使用了新工具
  information_growth_rate: number; // 信息增长率
  should_skip_plan: boolean; // 是否跳过规划
  skip_reason?: string; // 跳过原因
  timestamp: number; // 时间戳
}
```

## 执行流程示例

### 场景：用户询问天气

```
1. OBSERVE
   - 收集状态快照
   - 生成状态摘要
   - 检测状态变更
   - 更新工作记忆（添加用户消息）

2. PLAN
   - 构建规划上下文
   - 调用 LLM 生成计划
   - 解析计划响应

3. ACT
   - 调用 tavily 搜索工具
   - 获取天气信息

4. EVALUATE
   - 评估工具执行结果
   - 计算评分 (假设 0.9)
   - 评分 >= 0.8，决定进入 REFLECT

5. REFLECT
   - 分析执行结果
   - 决策：finalize_answer
   - 生成最终答案

6. 终止
   - 返回最终答案和执行指标
```

### 场景：工具执行失败

```
1-3. OBSERVE, PLAN, ACT (同上的前几步)

4. EVALUATE
   - 评估工具执行结果
   - 计算评分 (假设 0.3)
   - 评分 < 0.4，决定进入 PLAN 重新规划

5. PLAN
   - 使用更新后的上下文重新规划
   - 可能选择不同工具或参数

6. EVALUATE
   - 再次评估

7. REFLECT
   - 根据评估结果决定是否继续
```

## 配置参数

### 执行引擎配置

| 参数                      | 默认值   | 说明                 |
| ------------------------- | -------- | -------------------- |
| `maxIterations`           | `10`     | 最大迭代次数         |
| `maxExecutionTime`        | `300000` | 最大执行时间（毫秒） |
| `maxWorkingMemorySize`    | `10`     | 工作记忆最大大小     |
| `maxToolMemorySize`       | `100`    | 工具记忆最大大小     |
| `summaryTriggerRound`     | `5`      | 触发摘要的轮数       |
| `summaryTriggerTokens`    | `8000`   | 触发摘要的 Token 数  |
| `tokenThreshold`          | `0.9`    | Token 预算阈值       |
| `toolTimeout`             | `30000`  | 工具超时时间（毫秒） |
| `maxRetryPerTool`         | `3`      | 每个工具最大重试次数 |
| `enableParallelExecution` | `true`   | 是否启用并行执行     |
| `maxConcurrentTools`      | `5`      | 最大并发工具数       |
| `waveTimeout`             | `60000`  | 波次超时时间（毫秒） |
| `enableStateProtection`   | `true`   | 是否启用状态保护     |
| `maxStateSize`            | `1000`   | 最大状态大小         |
| `verbose`                 | `false`  | 是否输出详细日志     |

### 状态摘要生成器配置

| 参数                                | 默认值  | 说明                  |
| ----------------------------------- | ------- | --------------------- |
| `enableLLMGeneration`               | `false` | 是否启用 LLM 生成摘要 |
| `maxHighlights`                     | `5`     | 最大亮点数量          |
| `maxWarnings`                       | `3`     | 最大警告数量          |
| `warningThresholds.highFailureRate` | `0.5`   | 高失败率阈值          |
| `warningThresholds.lowProgressRate` | `0.1`   | 低进度率阈值          |
| `warningThresholds.highTokenUsage`  | `0.8`   | 高 Token 使用率阈值   |

### 变更检测器配置

| 参数                                          | 默认值 | 说明                     |
| --------------------------------------------- | ------ | ------------------------ |
| `progressThreshold`                           | `0.1`  | 进度变化阈值             |
| `errorThreshold`                              | `3`    | 错误阈值                 |
| `skipPlanConditions.maxConsecutiveNoProgress` | `2`    | 最大连续无进展次数       |
| `skipPlanConditions.maxRecentErrors`          | `3`    | 最大近期错误数           |
| `skipPlanConditions.minIterationsBeforeSkip`  | `2`    | 跳过规划前的最小迭代次数 |

### 评估器配置

| 参数                        | 默认值  | 说明                     |
| --------------------------- | ------- | ------------------------ |
| `accuracyWeight`            | `0.3`   | 准确性权重               |
| `completenessWeight`        | `0.25`  | 完整性权重               |
| `efficiencyWeight`          | `0.2`   | 效率权重                 |
| `confidenceWeight`          | `0.25`  | 置信度权重               |
| `minSuccessThreshold`       | `0.5`   | 最小成功阈值             |
| `maxExecutionTimeThreshold` | `30000` | 最大执行时间阈值（毫秒） |

## 日志输出

执行引擎会在 `verbose` 模式下输出各阶段的详细信息：

```
[OBSERVE] 迭代 0: 尚未开始执行，状态良好
[OBSERVE] 警告: Token 使用量接近上限
[OBSERVE] 建议跳过规划: 连续 2 次无进展
[EVALUATE] 评估完成 (迭代 0), 耗时 5ms
[EVALUATE] 综合评分: 85.0%, 准确性: 90.0%, 完整性: 80.0%, 效率: 85.0%, 置信度: 85.0%
[EVALUATE] 评估结果良好，进入REFLECT阶段
[REFLECT] 决策: 生成最终答案
[Termination] 规划器发出终止信号
```

### 各阶段日志说明

**OBSERVE 阶段**：

- 输出状态摘要，包含当前迭代、进度、成功率等信息
- 如有警告（失败率高、进度缓慢、Token 接近上限等），会输出警告信息
- 如建议跳过规划，会输出跳过原因

**EVALUATE 阶段**：

- 输出评估完成信息和耗时
- 输出综合评分和各维度评分（准确性、完整性、效率、置信度）
- 根据评分输出决策方向（进入 REFLECT 或重新规划）

**REFLECT 阶段**：

- 输出决策结果（`finalize_answer`、`new_plan`、`retry`、`fallback`）
- 如决策为 retry，会输出需要重试的工具名称

## 向后兼容性

本次重构保持以下兼容性：

1. **API 接口不变** - `ExecutionEngine.run()` 签名保持不变
2. **返回值格式兼容** - `finalAnswer` 和 `metrics` 返回格式保持
3. **配置参数扩展** - 新增参数有默认值，不影响现有配置

## 相关文件

| 文件                                    | 说明                 |
| --------------------------------------- | -------------------- |
| `src/agent/execution/engine.ts`         | 主引擎（已更新）     |
| `src/agent/execution/evaluator.ts`      | 新增：评估器         |
| `src/agent/execution/state-digest.ts`   | 新增：状态摘要生成器 |
| `src/agent/execution/delta-detector.ts` | 新增：变更检测器     |
| `src/agent/execution/types.ts`          | 类型定义（已更新）   |

## 未来优化方向

1. **评估模型优化** - 引入更复杂的评估算法
2. **状态压缩** - 历史状态摘要的进一步压缩
3. **自适应阈值** - 根据上下文动态调整 EVALUATE 阶段决策阈值
