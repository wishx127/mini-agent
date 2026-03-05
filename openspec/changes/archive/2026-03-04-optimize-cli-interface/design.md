# CLI Interface Optimization - Technical Design

## Context

当前mini-agent CLI使用Node.js原生`readline`模块实现交互界面。显示逻辑简单直接:

- 用户输入后显示静态"思考中"文本
- 响应直接输出到控制台
- 没有样式区分和视觉层次

**约束:**

- 必须保持与现有Agent核心逻辑的解耦
- 不能影响命令行参数解析和配置管理
- 需要兼容Windows、macOS、Linux终端
- 性能开销应最小化,不影响Agent响应速度

**相关代码:**

- `src/cli/interface.ts` - CLI交互界面主逻辑
- 依赖Agent的`processPrompt`方法,不修改Agent内部

## Goals / Non-Goals

**Goals:**

- 实现流畅的动态加载动画,提供实时视觉反馈
- 为不同消息类型提供清晰的视觉区分(用户输入、Agent响应、错误信息)
- 实现段落级别的背景块显示,提升可读性
- 保持代码简洁,易于维护和扩展

**Non-Goals:**

- 不实现完整的TUI(Text User Interface)框架
- 不添加配置项来自定义样式(颜色、字体等)
- 不实现多语言支持
- 不修改Agent核心推理逻辑

## Decisions

### Decision 1: 使用Ora实现加载动画

**选择:** 使用`ora`库实现动态加载动画

**理由:**

- Ora是Node.js最流行的终端加载动画库,成熟稳定
- 提供多种内置spinner样式,开箱即用
- 支持动态更新文本内容,适合显示处理进度
- 轻量级,无额外依赖

**备选方案:**

- `cli-spinner`: 功能类似,但API不够现代,维护较少
- 手写实现: 可控性强,但需要处理跨平台兼容性,增加维护成本

### Decision 2: 使用Chalk和Cli-Boxes实现样式

**选择:** 使用`chalk`处理颜色,`cli-boxes`绘制背景框

**理由:**

- Chalk是Node.js事实上的标准终端颜色库,API简洁直观
- 支持自动检测终端颜色支持,优雅降级
- Cli-boxes提供轻量级的边框样式,适合创建背景块
- 两者结合可实现类似Claude Code的视觉效果

**备选方案:**

- `ink`: 基于React的终端UI框架,功能强大但过于重量级
- `blessed`: 完整的TUI库,学习曲线陡峭,不适合简单场景
- 纯ANSI转义码: 跨平台兼容性差,维护成本高

### Decision 3: 消息样式设计

**选择:** 为不同消息类型定义固定样式模板

**样式方案:**

```
用户输入:
┌─ 您的输入 ─────────────┐
│ [实际输入内容]           │
└────────────────────────┘

Agent响应:
┌─ Agent ────────────────┐
│ [响应内容]              │
└────────────────────────┘

错误信息:
┌─ 错误 ─────────────────┐
│ [错误信息]              │
└────────────────────────┘
```

**理由:**

- 统一的框样式提供一致的视觉体验
- 不同颜色区分消息类型(蓝色=用户,绿色=Agent,红色=错误)
- 背景块使段落清晰可辨,便于阅读长文本

### Decision 4: 实现架构

**选择:** 创建新的`DisplayManager`类封装显示逻辑

**架构:**

```
CLIInterface
  ├─ DisplayManager (新增)
  │   ├─ showUserInput()
  │   ├─ showAgentResponse()
  │   ├─ showError()
  │   └─ startLoading() / stopLoading()
  └─ AgentCore (不变)
```

**理由:**

- 关注点分离,显示逻辑与交互逻辑解耦
- 便于单元测试和未来扩展
- 不影响现有Agent核心代码

## Risks / Trade-offs

**Risk: 终端兼容性问题**

- 不同终端对ANSI转义码的支持程度不同
- **Mitigation:** 使用成熟的库(ora, chalk)处理跨平台兼容性,在旧终端上优雅降级

**Risk: 长文本换行处理**

- 终端宽度有限,长文本需要自动换行
- **Mitigation:** 使用`wrap-ansi`库处理自动换行,确保框内文本正确显示

**Trade-off: 性能开销**

- 新增依赖和渲染逻辑会带来轻微性能开销
- **Acceptable:** 加载动画和样式渲染的性能影响远小于Agent推理时间,用户体验收益远大于性能损失

**Trade-off: 代码复杂度**

- 新增DisplayManager类和依赖库增加代码量
- **Acceptable:** 换来更好的可维护性和可扩展性,符合软件工程最佳实践
