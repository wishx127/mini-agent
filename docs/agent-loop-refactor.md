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
  overall: number; // 综合评分 (0-1)
  successRate: number; // 成功率
  responseQuality: number; // 响应质量
  performanceScore: number; // 性能评分
  warnings: string[]; // 警告信息
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
  warnings: string[]; // 警告列表
  suggestions: string[]; // 建议列表
}
```

## 状态变更数据结构

```typescript
interface StateDelta {
  should_skip_plan: boolean; // 是否跳过规划
  skip_reason?: string; // 跳过原因
  memory_growth: {
    workingMemoryDelta: number; // 工作记忆变化量
    toolMemoryDelta: number; // 工具记忆变化量
  };
  iteration_advanced: boolean; // 是否进入新迭代
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

| 参数      | 默认值  | 说明             |
| --------- | ------- | ---------------- |
| `verbose` | `false` | 是否输出详细日志 |

## 日志输出

执行引擎会在 `verbose` 模式下输出各阶段的详细信息：

```
[OBSERVE] 迭代 1/10 | 进度: 0%, 成功率: N/A, 信息增长: N/A
[OBSERVE] 警告: 工作记忆接近限制
[EVALUATE] 评估结果良好，进入REFLECT阶段
[REFLECT] 决策: 重新规划
```

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
