## 多步计划能力

### Requirement：多步计划输出格式

规划器应能输出包含多个工具调用步骤的计划。每个步骤指定工具名、输入、以及依赖的前序步骤（用于描述执行顺序）。

#### Scenario：单步计划

- **WHEN** 任务可通过单个工具解决
- **THEN** 规划器返回包含 1 个步骤的计划：
  ```json
  {
    "type": "tool",
    "steps": [{"tool": "SearchTool", "input": {...}, "dependencies": []}],
    "confidence": 0.9
  }
  ```

#### Scenario：两步串行计划

- **WHEN** 任务需要先搜索后分析
- **THEN** 规划器返回 2 步计划，第二步依赖第一步：
  ```json
  {
    "type": "tool",
    "steps": [
      {"tool": "SearchTool", "input": {...}, "dependencies": []},
      {"tool": "AnalyzeTool", "input": {...}, "dependencies": [0]}
    ],
    "confidence": 0.8
  }
  ```

#### Scenario：三步计划含并行

- **WHEN** 任务包含可并行的操作
- **THEN** 规划器返回 3 步计划，步骤 1 和 2 可并行执行，步骤 3 依赖两者：
  ```json
  {
    "type": "tool",
    "steps": [
      {"tool": "FetchWeather", "input": {...}, "dependencies": []},
      {"tool": "FetchNews", "input": {...}, "dependencies": []},
      {"tool": "Summarize", "input": {...}, "dependencies": [0, 1]}
    ],
    "confidence": 0.7
  }
  ```

---

### Requirement：置信度评分

规划器应为每个计划输出置信度评分（0.0 到 1.0）。置信度表示规划器对此计划成功的信心，反思阶段使用此评分决定是否信任该计划。

#### Scenario：高置信度计划

- **WHEN** 规划器对任务理解充分，计划策略清晰
- **THEN** 计划包含 confidence ≥ 0.8

#### Scenario：低置信度计划

- **WHEN** 规划器对任务不确定，可能需要调整
- **THEN** 计划包含 confidence < 0.6

#### Scenario：中置信度计划

- **WHEN** 规划器有基本理解但可能需要迭代
- **THEN** 计划包含 0.6 ≤ confidence < 0.8

---

### Requirement：步骤依赖描述

每个步骤的 dependencies 字段应使用整数数组，指示依赖的前序步骤的索引（基于 0）。系统应验证依赖图的合法性（无循环）。

#### Scenario：无依赖步骤

- **WHEN** 某步骤可独立执行
- **THEN** 该步骤的 dependencies 为空数组 []

#### Scenario：单依赖

- **WHEN** 步骤 2 依赖步骤 0 的结果
- **THEN** 步骤 2 的 dependencies 为 [0]

#### Scenario：多依赖

- **WHEN** 步骤 3 依赖步骤 0 和步骤 1 的结果
- **THEN** 步骤 3 的 dependencies 为 [0, 1]

#### Scenario：依赖图合法性检查

- **WHEN** ACT 阶段收到计划
- **THEN** 系统验证依赖图中无循环依赖，所有索引在有效范围内，否则返回错误

---

### Requirement：推理字段（可选）

规划器可选提供 reasoning 字段，说明为何选择此计划。此字段用于可调试性和日志，不影响执行逻辑。

#### Scenario：包含推理说明

- **WHEN** 规划器生成计划时提供推理信息
- **THEN** 计划返回包含 reasoning 字段，如："First search for relevant data, then analyze results"

#### Scenario：缺少推理说明

- **WHEN** 规划器未提供 reasoning
- **THEN** 计划返回的 reasoning 字段为空或不存在，不影响执行

---

### Requirement：Plan 和 PlanStep 接口定义

```typescript
interface PlanStep {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  dependsOn: string[];
  confidence: number;
  reasoning?: string;
  expected_output?: string;
  success_criteria?: string;
  retryable?: boolean;
  max_retries?: number;
}

interface Plan {
  steps: PlanStep[];
  overallConfidence: number;
  reasoning?: string;
  isFinalAnswer?: boolean;
  expected_outcome?: string;
  termination_condition?: string;
  priority?: 'high' | 'medium' | 'low';
  estimated_duration?: number;
}
```
