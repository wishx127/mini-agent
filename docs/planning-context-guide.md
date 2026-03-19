# PlanningContext 使用指南

## 概述

PlanningContext 是 ExecutionEngine 传递给规划器的上下文信息，包含了规划所需的所有状态和历史数据。它帮助规划器做出更明智的决策。

## 接口定义

```typescript
interface PlanningContext {
  userPrompt: string; // 用户原始输入
  workingMemory: Message[]; // 工作记忆中的消息
  toolMemory: ToolRecord[]; // 工具执行历史记录
  summaryMemory: Summary[]; // 摘要记忆
  iterationCount: number; // 当前迭代次数
  availableTools: ToolInfo[]; // 可用工具列表
  remainingIterations: number; // 剩余迭代次数
  deduplicationInfo: DeduplicationState; // 去重信息
}
```

## 字段说明

### userPrompt

用户输入的原始提示词，是任务的起点。

**示例：**

```
"搜索今天的天气并计算温度转换"
```

### workingMemory

工作记忆中的消息列表，包含最近的对话历史。

**Message 结构：**

```typescript
interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}
```

**使用建议：**

- 检查之前的对话以避免重复
- 利用上下文理解用户意图
- 注意工具执行结果

### toolMemory

工具执行历史记录，包含所有工具调用的详细信息。

**ToolRecord 结构：**

```typescript
interface ToolRecord {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'success' | 'failure' | 'timeout';
  iteration: number;
  executionTime: number;
  retryCount: number;
}
```

**使用建议：**

- 检查工具是否已经成功执行
- 分析失败原因以调整策略
- 避免重复的工具调用

### summaryMemory

摘要记忆列表，包含之前轮次的摘要信息。

**Summary 结构：**

```typescript
interface Summary {
  timeRange: {
    from: number;
    to: number;
  };
  messageCount: number;
  summary: string;
  iteration: number;
}
```

**使用建议：**

- 利用摘要了解之前的工作
- 避免重复已经完成的任务
- 基于摘要做出更好的规划

### iterationCount

当前迭代次数，从 0 开始。

**使用建议：**

- 控制任务复杂度
- 判断是否需要简化计划
- 考虑剩余迭代次数

### availableTools

可用工具列表。

**ToolInfo 结构：**

```typescript
interface ToolInfo {
  name: string;
  description: string;
  enabled: boolean;
}
```

**使用建议：**

- 选择合适的工具完成任务
- 检查工具是否可用
- 考虑工具的限制

### remainingIterations

剩余迭代次数。

**使用建议：**

- 评估任务可行性
- 简化计划以适应剩余迭代
- 优先执行关键步骤

### deduplicationInfo

去重信息，帮助避免重复的工具调用。

**DeduplicationState 结构：**

```typescript
interface DeduplicationState {
  recentCalls: Map<string, ToolRecord>;
  budgetUsed: Map<string, number>;
}
```

**使用建议：**

- 检查工具调用是否重复
- 利用之前的结果
- 调整参数以避免去重

## 使用示例

### 示例 1: 基于上下文的规划

```typescript
function createPlan(context: PlanningContext): Plan {
  const { userPrompt, toolMemory, remainingIterations } = context;

  // 检查是否已经完成搜索
  const searchResult = toolMemory.find(
    (record) => record.toolName === 'search' && record.status === 'success'
  );

  if (searchResult) {
    // 已经有搜索结果，进行分析
    return {
      steps: [
        {
          id: 'analyze',
          toolName: 'analyze',
          arguments: { data: searchResult.result },
          dependsOn: [],
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
      isFinalAnswer: false,
    };
  }

  // 没有搜索结果，先搜索
  return {
    steps: [
      {
        id: 'search',
        toolName: 'search',
        arguments: { query: userPrompt },
        dependsOn: [],
        confidence: 0.9,
      },
    ],
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}
```

### 示例 2: 考虑剩余迭代

```typescript
function createPlan(context: PlanningContext): Plan {
  const { remainingIterations, iterationCount } = context;

  // 剩余迭代不足，返回最终答案
  if (remainingIterations < 2) {
    return {
      steps: [],
      overallConfidence: 0.5,
      reasoning: '剩余迭代不足，返回当前最佳答案',
      isFinalAnswer: true,
    };
  }

  // 正常规划
  return {
    steps: [
      // ... 步骤
    ],
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}
```

### 示例 3: 避免重复调用

```typescript
function createPlan(context: PlanningContext): Plan {
  const { toolMemory, deduplicationInfo } = context;

  // 检查是否已经成功调用过
  const successfulCalls = toolMemory.filter(
    (record) => record.status === 'success'
  );

  const alreadyCalled = successfulCalls.some(
    (record) => record.toolName === 'search'
  );

  if (alreadyCalled) {
    // 已经调用过，使用不同工具
    return {
      steps: [
        {
          id: 'analyze',
          toolName: 'analyze',
          arguments: {},
          dependsOn: [],
          confidence: 0.9,
        },
      ],
      overallConfidence: 0.9,
      isFinalAnswer: false,
    };
  }

  // 首次调用
  return {
    steps: [
      {
        id: 'search',
        toolName: 'search',
        arguments: {},
        dependsOn: [],
        confidence: 0.9,
      },
    ],
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}
```

## 最佳实践

1. **始终检查 toolMemory** - 避免重复已经完成的工作
2. **考虑 remainingIterations** - 确保计划可行
3. **利用 summaryMemory** - 了解之前的工作进展
4. **检查去重信息** - 避免重复的工具调用
5. **提供清晰的 reasoning** - 解释规划决策
6. **设置合理的 confidence** - 反映计划的可靠性

## 常见错误

### 错误 1: 忽略已有的工具结果

```typescript
// ❌ 错误做法
function createPlan(context: PlanningContext): Plan {
  return {
    steps: [
      {
        id: 'search',
        toolName: 'search',
        arguments: { query: 'test' },
        dependsOn: [],
        confidence: 0.9,
      },
    ],
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}

// ✅ 正确做法
function createPlan(context: PlanningContext): Plan {
  const existingResult = context.toolMemory.find(
    (r) => r.toolName === 'search' && r.status === 'success'
  );

  if (existingResult) {
    // 使用已有结果
    return {
      steps: [],
      reasoning: '已有搜索结果',
      isFinalAnswer: true,
    };
  }

  return {
    steps: [
      {
        id: 'search',
        toolName: 'search',
        arguments: { query: 'test' },
        dependsOn: [],
        confidence: 0.9,
      },
    ],
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}
```

### 错误 2: 不考虑剩余迭代

```typescript
// ❌ 错误做法
function createPlan(context: PlanningContext): Plan {
  return {
    steps: Array(10)
      .fill(null)
      .map((_, i) => ({
        id: `step${i}`,
        toolName: 'tool',
        arguments: {},
        dependsOn: [],
        confidence: 0.9,
      })),
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}

// ✅ 正确做法
function createPlan(context: PlanningContext): Plan {
  const maxSteps = Math.min(5, context.remainingIterations);

  return {
    steps: Array(maxSteps)
      .fill(null)
      .map((_, i) => ({
        id: `step${i}`,
        toolName: 'tool',
        arguments: {},
        dependsOn: [],
        confidence: 0.9,
      })),
    overallConfidence: 0.9,
    isFinalAnswer: false,
  };
}
```
