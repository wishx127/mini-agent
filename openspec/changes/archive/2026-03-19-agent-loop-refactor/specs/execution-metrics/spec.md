## 执行指标能力

### Requirement：关键指标收集

系统应在循环执行过程中收集关键指标，用于性能分析和优化。

#### Scenario：基础执行指标
- **WHEN** 执行完成
- **THEN** 返回指标包含：
  ```
  - totalIterations (number)
  - totalElapsedTime (milliseconds)
  - totalTokensUsed (number)
  - terminationReason (string)
  - toolCallCount (number)
  - toolSuccessCount (number)
  - toolFailureCount (number)
  ```

#### Scenario：迭代级指标
- **WHEN** 每轮循环完成
- **THEN** 系统记录该轮的指标：
  ```
  - iterationNumber (number)
  - phaseDurations {observe, plan, act, reflect} (milliseconds)
  - toolsExecuted (string[])
  - toolsSucceeded (number)
  - toolsFailed (number)
  - informationGrowth (number 0-1)
  - tokensConsumed (number)
  ```

#### Scenario：工具级指标
- **WHEN** 工具执行完毕
- **THEN** 系统记录工具指标：
  ```
  - toolName (string)
  - duration (milliseconds)
  - status (success / failed / timeout)
  - inputSize (characters)
  - outputSize (characters)
  - tokensCost (number)
  - errorType (string, 如果失败)
  - iterationNumber (number)
  ```

---

### Requirement：指标汇总和聚合

系统应支持对指标进行聚合分析，生成执行摘要。

#### Scenario：工具统计聚合
- **WHEN** 执行完成，需要工具级统计
- **THEN** 返回各工具的聚合数据：
  ```
  {
    "SearchTool": {
      "callCount": 5,
      "successCount": 4,
      "failureCount": 1,
      "avgDuration": 250,
      "avgInputSize": 50,
      "avgOutputSize": 500,
      "totalTokensCost": 1200
    }
  }
  ```

#### Scenario：时间分布
- **WHEN** 分析执行时间分布
- **THEN** 系统提供：
  ```
  - observeTime (总计)
  - planTime (总计)
  - actTime (总计)
  - reflectTime (总计)
  - 各阶段的平均耗时
  ```

#### Scenario：成功率统计
- **WHEN** 需要评估执行质量
- **THEN** 返回：
  ```
  - overallSuccessRate (number 0-1)
  - toolSuccessRate (number 0-1)
  - informationAcquisitionRate (0-1, 新信息/总工具调用)
  - convergenceSpeed (迭代次数到收敛)
  ```

---

### Requirement：异常和错误指标

系统应详细记录执行过程中的异常和错误。

#### Scenario：错误分类统计
- **WHEN** 执行期间发生错误
- **THEN** 指标包含错误分类统计：
  ```
  - toolErrors (count by tool)
  - timeoutErrors (count)
  - parameterErrors (count)
  - networkErrors (count)
  - tokenLimitHits (count)
  ```

#### Scenario：错误事件日志
- **WHEN** 需要详细错误信息
- **THEN** 系统提供错误事件列表，每个包含：
  ```
  - timestamp
  - errorType
  - tool (if applicable)
  - iterationNumber
  - errorMessage
  - isRecoverable (boolean)
  ```

#### Scenario：失败模式识别
- **WHEN** 分析失败原因
- **THEN** 指标包含失败原因分布：
  ```
  - failureByReason {
      "network_timeout": 2,
      "invalid_parameter": 1,
      "tool_unavailable": 1
    }
  ```

---

### Requirement：资源消耗指标

系统应追踪资源消耗情况，包括 token、时间、内存等。

#### Scenario：Token 消耗详解
- **WHEN** 需要了解 token 消耗
- **THEN** 返回：
  ```
  - tokensByPhase {
      "observe": 100,
      "plan": 500,
      "act": 200,
      "reflect": 150
    }
  - tokensBySource {
      "conversationHistory": 600,
      "workingMemory": 200,
      "summaryMemory": 150
    }
  ```

#### Scenario：时间消耗分析
- **WHEN** 需要性能分析
- **THEN** 返回按阶段的时间分布，以及最耗时的操作

#### Scenario：资源效率指标
- **WHEN** 评估执行效率
- **THEN** 返回：
  ```
  - tokensPerSuccessfulTool (number)
  - timePerNewInformation (milliseconds per unit)
  - successRatePerIteration (trending)
  ```

---

### Requirement：决策和选择指标

系统应记录规划器、反思器的决策统计。

#### Scenario：规划器置信度分布
- **WHEN** 分析规划质量
- **THEN** 返回所有规划的置信度分布：
  ```
  - averageConfidence (number 0-1)
  - minConfidence (number)
  - maxConfidence (number)
  - confidenceByIteration (array)
  ```

#### Scenario：反思决策统计
- **WHEN** 分析循环进展
- **THEN** 返回：
  ```
  - decisionCounts {
      "continue": 5,
      "retry": 2,
      "finalize_answer": 1,
      "fallback": 0
    }
  - averageTimeToDecision (milliseconds)
  ```

#### Scenario：工具选择多样性
- **WHEN** 评估规划器多样性
- **THEN** 返回：
  ```
  - uniqueToolsUsed (number)
  - toolUsageDistribution (tool -> count)
  - repeatToolRatio (number 0-1)
  ```

---

### Requirement：信息质量指标

系统应度量执行过程中的信息质量和增长。

#### Scenario：信息增长曲线
- **WHEN** 分析信息获取过程
- **THEN** 返回按迭代的信息增长率：
  ```
  - iterationGrowthRates (array of number 0-1)
  - cumulativeInformationGrowth (number)
  - averageGrowthPerIteration (number)
  ```

#### Scenario：重复率指标
- **WHEN** 评估工具调用效率
- **THEN** 返回：
  ```
  - duplicateCallsDetected (number)
  - duplicateCallsSkipped (number)
  - duplicateCallRatio (number 0-1)
  ```

#### Scenario：信息相关性
- **WHEN** 衡量获取的信息质量
- **THEN** 返回：
  ```
  - informationRelevanceScore (number 0-1)
  - noiseLevelEstimate (number 0-1)
  ```

---

### Requirement：实时指标流和回调

系统应支持在执行过程中实时推送指标，允许观察者订阅。

#### Scenario：迭代完成回调
- **WHEN** 每完成一轮循环
- **THEN** 系统调用注册的回调函数，传入该轮的指标

#### Scenario：阶段完成回调
- **WHEN** 每个阶段完成
- **THEN** 系统可发送阶段级指标，如 actPhaseCompleted 事件

#### Scenario：指标流订阅
- **WHEN** 上层应用需要实时监控
- **THEN** 系统提供 `metrics.subscribe(listener)` 接口，listener 接收增量指标

---

### Requirement：指标持久化和导出

系统应支持指标的保存和导出，便于离线分析。

#### Scenario：指标序列化
- **WHEN** 执行完成
- **THEN** 系统可将全部指标序列化为 JSON，格式标准化

#### Scenario：CSV 导出
- **WHEN** 需要导出迭代级指标进行分析
- **THEN** 系统提供 `metrics.exportToCSV()` 生成可导入电子表格的文件

#### Scenario：指标归档
- **WHEN** 长期保存指标
- **THEN** 系统支持将指标存储到数据库或文件系统，带上执行 ID 和时间戳

#### Scenario：指标查询接口
- **WHEN** 需要回顾历史执行
- **THEN** 系统提供接口按执行 ID、时间范围、工具名等维度查询指标

---

### Requirement：指标警报和异常检测

系统应能检测指标中的异常模式并发出警报。

#### Scenario：性能下降警报
- **WHEN** 相邻迭代的平均耗时增长 > 50%
- **THEN** 系统记录警报，可能指示性能问题

#### Scenario：高失败率警报
- **WHEN** 工具失败率 > 50%
- **THEN** 系统发出警报，建议检查工具或参数

#### Scenario：收敛速度异常
- **WHEN** 迭代次数 > 预期（如预期 3 轮，实际 8 轮）
- **THEN** 系统记录异常，供后续优化

#### Scenario：资源耗尽预警
- **WHEN** Token 消耗速率表明将在规定轮次内耗尽预算
- **THEN** 系统发出预警，建议提前终止或优化

---

### Requirement：指标基准和对标

系统应支持将执行指标与基准对标。

#### Scenario：基准设定
- **WHEN** 系统初始化
- **THEN** 允许配置基准指标：
  ```
  - targetIterations (default: 3)
  - targetTokens (default: 5000)
  - minSuccessRate (default: 0.8)
  ```

#### Scenario：对标评分
- **WHEN** 执行完成
- **THEN** 系统计算对标评分 0-100，基于与基准的偏差

#### Scenario：对标报告
- **WHEN** 需要性能评价
- **THEN** 返回报告对比实际 vs 基准：
  ```
  - iterationsScore (100 if met, scaled down if exceeded)
  - tokenScore (similar)
  - successScore (similar)
  - overallScore (weighted average)
  ```

---

### Requirement：指标配置和采样

系统应允许配置指标收集的粒度，平衡开销和信息量。

#### Scenario：采样率配置
- **WHEN** 系统初始化
- **THEN** 允许配置 metricsCollectionRate (0.0-1.0)，仅收集该比例的详细指标

#### Scenario：采样级别
- **WHEN** 配置 metricsLevel="basic"
- **THEN** 仅收集基础指标，性能开销 < 1%

#### Scenario：详细级别
- **WHEN** 配置 metricsLevel="detailed"
- **THEN** 收集全部指标包括工具级细节，性能开销 ~5%

#### Scenario：运行时调整
- **WHEN** 执行进行中需要调整采样
- **THEN** 系统允许 `metrics.setSamplingRate(newRate)` 动态调整
