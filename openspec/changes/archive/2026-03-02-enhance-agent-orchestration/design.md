## Context

当前 Mini Agent 采用扁平化流水线架构，`AgentCore` 类直接处理所有编排逻辑。现有实现存在以下问题：

- **职责混乱**：`llmDecision()` 方法同时负责判断、选择和规划
- **扩展困难**：控制逻辑散落在各处，难以统一调整
- **测试复杂**：业务逻辑与控制逻辑耦合，单元测试困难

**技术约束**：

- 必须保持 `AgentCore.processPrompt()` 对外接口不变
- 使用现有 LangChain 和 TypeScript 能力，不引入新依赖
- 向后兼容现有配置和工具系统

## Goals / Non-Goals

**Goals:**

- 实现清晰的分层架构，分离 Planner、Executor、Controller 职责
- 提供完善的错误处理和重试机制
- 实现 Token 上限控制，防止上下文溢出
- 提供可配置的控制参数（超时、重试次数等）
- 保持代码可测试性和可维护性

**Non-Goals:**

- 不改变现有的工具注册机制
- 不修改 LangChain 集成方式
- 不引入新的外部依赖
- 不改变用户配置文件格式

## Decisions

### 1. 模块分层架构

**决策**：采用三层架构，Planner → Executor → Controller

**理由**：

- Planner 负责决策层：决定是否调用工具、选择哪个工具、规划调用顺序
- Executor 负责执行层：执行工具调用、处理异常、实现重试
- Controller 负责控制层：全局控制 Token 上限、超时、调用次数限制

**替代方案**：

- ❌ 单层架构（当前实现）：职责不清，难以扩展
- ❌ 两层架构（Planner + Executor）：缺少独立控制层，控制逻辑仍然散落

**实现**：

```typescript
// 编排流程
Controller (控制入口)
  → Planner.plan() (决策)
    → Executor.execute() (执行)
      → Controller.checkLimits() (控制检查)
```

### 2. Planner 设计

**决策**：Planner 作为纯决策模块，不执行任何实际操作

**职责**：

- `shouldUseTool(prompt, history)` → 判断是否需要工具
- `selectTool(prompt, tools)` → 选择最合适的工具
- `planExecution(prompt, tools)` → 规划工具调用顺序
- `validateParams(toolCall)` → 验证工具参数

**理由**：

- 决策逻辑独立，便于单元测试
- 支持未来扩展（如多工具编排、条件分支）
- 便于实现不同的规划策略（LLM 规划、规则规划、混合规划）

**实现方式**：

```typescript
class Planner {
  async plan(context: PlanningContext): Promise<ExecutionPlan> {
    // 1. LLM 决策（主要策略）
    // 2. 规则兜底（当 LLM 不可用时）
    // 3. 参数验证
    // 4. 生成执行计划
  }
}
```

### 3. Executor 设计

**决策**：Executor 负责执行层面，包含重试机制

**职责**：

- `executeTool(toolCall)` → 执行单个工具
- `handleError(error)` → 异常分类和处理
- `retry(toolCall, attempt)` → 重试逻辑
- `formatResult(result)` → 格式化结果

**重试策略**：

- 网络错误：最多重试 3 次，指数退避（1s, 2s, 4s）
- 超时错误：最多重试 2 次，固定间隔（1s）
- 参数错误：不重试，直接返回错误
- 其他错误：最多重试 1 次

**理由**：

- 不同错误类型需要不同的重试策略
- 指数退避避免对下游服务造成压力
- 最大重试次数限制防止无限循环

**实现方式**：

```typescript
class Executor {
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    for (const toolCall of plan.toolCalls) {
      const result = await this.executeWithRetry(toolCall);
      // 处理结果，决定是否继续
    }
  }

  private async executeWithRetry(toolCall: ToolCall): Promise<ToolResult> {
    // 重试逻辑实现
  }
}
```

### 4. Controller 设计

**决策**：Controller 作为全局控制器，管理执行边界

**职责**：

- `checkTokenLimit(history)` → 检查 Token 上限
- `checkTimeout(startTime)` → 检查超时
- `checkIterationCount(count)` → 检查调用次数
- `fallback(error)` → 失败兜底策略

**控制参数**：

- `maxTokens`: 4096（可配置）
- `maxIterations`: 3（可配置）
- `timeout`: 30000ms（可配置）
- `tokenThreshold`: 0.9（当达到 90% 时预警）

**兜底策略**：

1. **Token 超限** → 截断历史消息，保留最近上下文
2. **超时** → 返回部分结果 + 超时提示
3. **调用次数超限** → 返回已获取的结果 + 提示
4. **所有工具失败** → 返回 LLM 直接回答（降级）

**理由**：

- 集中管理控制逻辑，便于调整
- 兜底策略确保系统可用性
- 可配置参数适应不同场景

**实现方式**：

```typescript
class Controller {
  private config: ControlConfig;
  private metrics: ExecutionMetrics;

  async runWithControl(plan: ExecutionPlan): Promise<Result> {
    // 检查前置条件
    if (!this.checkPreconditions()) {
      return this.fallback('precondition_failed');
    }

    // 执行并监控
    const result = await this.executeWithMonitoring(plan);

    // 检查后置条件
    return this.checkPostconditions(result);
  }
}
```

### 5. AgentCore 重构

**决策**：AgentCore 作为门面（Facade），集成三个模块

**新架构**：

```typescript
class AgentCore {
  private planner: Planner;
  private executor: Executor;
  private controller: Controller;

  async processPrompt(prompt: string): Promise<string> {
    // 委托给 Controller 执行
    return this.controller.execute(prompt);
  }
}
```

**理由**：

- 保持对外接口不变（向后兼容）
- 内部职责清晰分离
- 便于单元测试（可 mock 各模块）

### 6. Token 计数方案

**决策**：使用 LangChain 内置的 `countTokens` 方法

**实现**：

```typescript
import { countTokens } from 'langchain/dist/util/tokens';

class Controller {
  checkTokenLimit(history: Message[]): TokenStatus {
    const totalTokens = history.reduce((sum, msg) => {
      return sum + countTokens(msg.content);
    }, 0);

    return {
      total: totalTokens,
      limit: this.config.maxTokens,
      percentage: totalTokens / this.config.maxTokens,
      exceeded: totalTokens > this.config.maxTokens,
    };
  }
}
```

**替代方案**：

- ❌ 精确计数（需要分词器）：依赖外部库，增加复杂度
- ❌ 不计数：可能导致上下文溢出错误

## Risks / Trade-offs

### Risk 1: Token 计数不精确

**风险**：LangChain 的 `countTokens` 是估算值，可能与实际使用不一致  
**缓解**：设置 `tokenThreshold` 为 0.9，预留 10% 缓冲空间

### Risk 2: 重试可能导致延迟

**风险**：网络错误重试可能显著增加响应时间  
**缓解**：

- 实现总超时限制，防止无限重试
- 提供配置项调整重试策略
- 在日志中记录重试信息

### Risk 3: 架构复杂度增加

**风险**：三层架构增加代码复杂度和理解成本  
**缓解**：

- 每个模块保持单一职责
- 提供清晰的接口定义
- 编写完善的单元测试和文档

### Risk 4: 向后兼容性

**风险**：重构可能影响现有功能  
**缓解**：

- 保持 `processPrompt()` 接口不变
- 使用现有的工具注册机制
- 完整的回归测试

## Migration Plan

### 阶段 1: 准备工作

1. 创建新模块文件（planner.ts, executor.ts, controller.ts, types.ts）
2. 定义接口和类型
3. 编写单元测试框架

### 阶段 2: 实现模块

1. 实现 Controller（优先，提供控制能力）
2. 实现 Executor（包含重试机制）
3. 实现 Planner（集成 LLM 决策）
4. 编写各模块单元测试

### 阶段 3: 集成重构

1. 重构 AgentCore 集成三个模块
2. 迁移现有逻辑到对应模块
3. 保持向后兼容

### 阶段 4: 测试验证

1. 单元测试覆盖所有模块
2. 集成测试验证端到端流程
3. 回归测试确保向后兼容
4. 性能测试验证控制机制

### 阶段 5: 文档和配置

1. 更新项目文档
2. 添加配置示例
3. 编写使用指南

**回滚策略**：

- Git 分支开发，保留原代码
- 使用特性开关（feature flag）控制新旧实现切换
- 出现问题时可快速回退到原实现

## Open Questions

1. **Token 计数精度**：是否需要引入精确的 Token 计数库（如 tiktoken）？
   - 当前倾向：使用 LangChain 内置方法，后续根据实际使用情况优化

2. **多工具编排**：是否支持一次规划调用多个工具？
   - 当前设计：支持，Planner 可返回多个工具调用

3. **配置粒度**：控制参数是全局配置还是每个工具独立配置？
   - 当前倾向：全局配置 + 工具级别覆盖（优先级更高）

4. **监控指标持久化**：是否需要持久化监控指标？
   - 当前设计：仅在内存中保存，供日志和分析使用
