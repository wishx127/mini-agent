# 命令系统架构文档

本文档详细介绍 Mini Agent 的交互式命令系统，包括系统架构、工作原理、开发指南和扩展方法。

## 目录

- [概述](#概述)
- [系统架构](#系统架构)
- [核心组件](#核心组件)
- [工作流程](#工作流程)
- [开发指南](#开发指南)
- [技术细节](#技术细节)

## 概述

Mini Agent 的命令系统是一个可扩展的交互式命令框架，允许用户在对话过程中通过 `/` 前缀执行各种命令。系统采用模块化设计，支持命令自动发现、别名映射、交互式选择器和动态过滤等功能。

### 主要特性

- **交互式命令选择器**：输入 `/` 后显示可用命令列表，支持键盘导航
- **智能过滤**：根据输入自动过滤匹配的命令
- **别名支持**：每个命令可以配置多个别名
- **可扩展架构**：通过简单的文件添加即可注册新命令
- **上下文感知**：命令可以访问 CLI 接口和相关功能

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIInterface                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Command    │  │   Command    │  │   CommandSelector │  │
│  │   Registry   │  │   Loader     │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                      Command Modules                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  help.ts │ │ clear.ts │ │  exit.ts │ │memory.ts │  ...  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 架构层次

1. **CLIInterface**：命令系统的入口，协调各个组件
2. **CommandRegistry**：命令注册中心，管理命令的生命周期
3. **CommandLoader**：命令加载器，自动发现和加载命令模块
4. **CommandSelector**：交互式选择器，处理用户输入和显示
5. **Command Modules**：具体的命令实现

## 核心组件

### 1. 类型定义 (types.ts)

```typescript
// 命令接口
interface Command {
  name: string; // 命令名称（不含斜杠）
  description: string; // 命令描述
  aliases?: string[]; // 命令别名
  action: () => void | Promise<void>; // 执行函数
}

// 命令定义接口（用于自动注册）
interface CommandDefinition {
  name: string;
  description: string;
  aliases?: string[];
  execute: (context: CommandContext) => void | Promise<void>;
}

// 命令上下文
interface CommandContext {
  cli: CLIInterface; // CLI接口实例
  showPrompt: () => void; // 显示提示符
  clearScreen: () => void; // 清屏
  quit: () => void; // 退出程序
}
```

### 2. 命令注册器 (registry.ts)

`CommandRegistry` 是命令的核心管理类：

```typescript
class CommandRegistry {
  // 注册单个命令
  register(command: Command): void;

  // 批量注册命令
  registerAll(commands: Command[]): void;

  // 根据名称获取命令（支持别名解析）
  get(name: string): Command | undefined;

  // 获取所有命令
  getAll(): Command[];

  // 根据前缀过滤命令
  filterByPrefix(prefix: string): Command[];

  // 检查命令是否存在
  has(name: string): boolean;
}
```

**特点**：

- 使用 `Map` 存储命令，保证 O(1) 查找效率
- 独立的别名映射表，支持别名到真实名称的转换
- 前缀过滤支持名称和别名的模糊匹配

### 3. 命令加载器 (loader.ts)

`CommandLoader` 负责自动发现和加载命令：

```typescript
class CommandLoader {
  // 加载所有内置命令
  static loadBuiltInCommands(): CommandDefinition[];

  // 将定义绑定到上下文
  static bindContext(
    definition: CommandDefinition,
    context: CommandContext
  ): Command;

  // 批量绑定上下文
  static bindAllContext(
    definitions: CommandDefinition[],
    context: CommandContext
  ): Command[];
}
```

**自动发现机制**：

```typescript
// 同步导入所有命令模块
import * as helpModule from './cmd/help.js';
import * as clearModule from './cmd/clear.js';
import * as exitModule from './cmd/exit.js';
import * as memoryModule from './cmd/memory.js';

const modules = [helpModule, clearModule, exitModule, memoryModule];
```

### 4. 命令选择器 (command-selector.ts)

`CommandSelector` 提供交互式命令选择界面：

```typescript
class CommandSelector {
  // 激活命令选择模式
  activate(): void;

  // 停用命令选择模式
  deactivate(): void;

  // 处理输入字符
  handleInput(char: string): void;

  // 选择上移
  selectUp(): void;

  // 选择下移
  selectDown(): void;

  // 获取当前选中的命令
  getSelectedCommand(): Command | undefined;
}
```

**交互特性**：

- 支持上下箭头键导航
- 实时过滤命令列表
- 自动滚动显示（当命令数量超过显示区域）
- 使用 ANSI 转义序列控制终端显示

## 工作流程

### 命令执行流程

```
用户输入 '/'
    ↓
激活 CommandSelector
    ↓
显示命令列表（默认显示前3个）
    ↓
用户输入过滤字符（如 'h'）
    ↓
实时过滤显示匹配的命令（help）
    ↓
用户按 Enter
    ↓
执行选中的命令 action()
    ↓
返回正常输入模式
```

### 输入模式状态机

```
┌──────────────┐
│  Normal Mode │
└──────┬───────┘
       │ 输入 '/'
       ▼
┌──────────────┐
│ Command Mode │◄─────┐
└──────┬───────┘      │
       │              │
   ┌───┴───┐          │
   ▼       ▼          │
 Enter   Esc          │
   │       │          │
   ▼       ▼          │
执行命令  返回Normal   │
   │                  │
   └──────────────────┘
```

### 键盘事件处理

| 按键     | 正常模式         | 命令模式       |
| -------- | ---------------- | -------------- |
| `/`      | 进入命令模式     | 添加到过滤文本 |
| `↑/↓`    | -                | 选择命令       |
| `Enter`  | 发送消息         | 执行命令       |
| `Esc`    | -                | 退出命令模式   |
| `Ctrl+C` | 退出程序         | 退出程序       |
| 其他字符 | 添加到输入缓冲区 | 过滤命令       |

## 开发指南

### 如何开发一个新命令

#### 步骤 1：创建命令文件

在 `src/cli/commands/cmd/` 目录下创建新的命令文件，例如 `echo.ts`：

```typescript
import type { CommandDefinition, CommandContext } from '../types.js';

/**
 * Echo 命令 - 回显输入内容
 */
export const command: CommandDefinition = {
  name: 'echo',
  description: '回显输入的内容',
  aliases: ['e'], // 可选：设置别名
  execute: ({ cli, showPrompt }: CommandContext) => {
    console.log('Echo: Hello from command!');
    showPrompt();
  },
};
```

#### 步骤 2：注册命令

在 `src/cli/commands/loader.ts` 中导入并注册新命令：

```typescript
// 导入新命令模块
import * as echoModule from './cmd/echo.js';

// 添加到模块数组
const modules = [
  helpModule,
  clearModule,
  exitModule,
  memoryModule,
  echoModule, // 添加到这里
];
```

#### 步骤 3：使用命令

启动 CLI 后，输入 `/echo` 或 `/e` 即可执行新命令。

### 命令开发最佳实践

1. **命令名称规范**：
   - 使用小写字母
   - 简洁明了（如 `clear` 而非 `clearScreen`）
   - 避免与现有命令冲突

2. **描述规范**：
   - 简短描述命令功能
   - 使用中文（与现有命令保持一致）
   - 示例：`清屏`、`显示帮助信息`

3. **别名设置**：
   - 常用命令设置简短别名（如 `exit` → `e`）
   - 避免与其他命令别名冲突

4. **上下文使用**：

   ```typescript
   execute: (context: CommandContext) => {
     // 访问 CLI 接口
     context.cli.showHelp();

     // 显示提示符
     context.showPrompt();

     // 清屏
     context.clearScreen();

     // 退出程序
     context.quit();
   };
   ```

5. **异步命令**：
   ```typescript
   export const command: CommandDefinition = {
     name: 'fetch',
     description: '获取远程数据',
     execute: async ({ showPrompt }: CommandContext) => {
       const data = await fetchData();
       console.log(data);
       showPrompt();
     },
   };
   ```

### 扩展示例：带参数的命令

如果需要开发带参数的命令，可以通过 CLIInterface 扩展：

```typescript
// types.ts - 扩展上下文
interface CommandContext {
  cli: CLIInterface;
  showPrompt: () => void;
  clearScreen: () => void;
  quit: () => void;
  getInputBuffer: () => string; // 新增：获取输入缓冲区
}

// echo.ts - 使用参数
export const command: CommandDefinition = {
  name: 'echo',
  description: '回显内容',
  execute: ({ getInputBuffer, showPrompt }: CommandContext) => {
    const args = getInputBuffer().slice(5); // 移除 '/echo '
    console.log(args);
    showPrompt();
  },
};
```

## 技术细节

### 使用的技术栈

- **TypeScript**：类型安全的命令定义
- **Node.js Readline**：原始模式下的键盘输入捕获
- **ANSI 转义序列**：终端光标控制和清屏
- **chalk**：终端颜色输出
- **ES Modules**：模块化导入导出

### ANSI 转义序列

命令选择器使用以下 ANSI 序列控制终端：

```typescript
const ANSI = {
  CLEAR_LINE: '\r\x1b[K', // 清除当前行
  CLEAR_SCREEN_DOWN: '\x1b[0J', // 清除光标到屏幕底部
  CURSOR_UP: '\x1b[1A', // 光标上移一行
  CURSOR_DOWN: '\x1b[1B', // 光标下移一行
  CURSOR_SHOW: '\x1b[?25h', // 显示光标
  CURSOR_HIDE: '\x1b[?25l', // 隐藏光标
};

// 移动到指定列
function cursorToColumn(n: number): string {
  return `\x1b[${n}G`;
}
```

### 原始输入模式

为了捕获单个按键（包括方向键），CLI 使用原始输入模式：

```typescript
// 设置 stdin 为 raw mode
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding('utf8');

// 处理按键输入
process.stdin.on('data', (key: string) => {
  void this.handleKeyPress(key);
});
```

### 方向键编码

方向键在终端中发送特殊的转义序列：

| 按键   | 转义序列 |
| ------ | -------- |
| 上箭头 | `\x1b[A` |
| 下箭头 | `\x1b[B` |
| 右箭头 | `\x1b[C` |
| 左箭头 | `\x1b[D` |

### 性能优化

1. **增量渲染**：只重新渲染变更的部分，避免全屏刷新
2. **防抖过滤**：输入时实时过滤，使用高效的字符串匹配
3. **懒加载**：命令模块按需加载，减少启动时间

### 错误处理

```typescript
// 命令执行错误处理
try {
  await selectedCommand.action();
} catch (error) {
  console.error('命令执行失败:', error);
  showPrompt();
}
```

## 总结

Mini Agent 的命令系统采用分层架构设计，具有高度的可扩展性和良好的用户体验。通过简单的文件添加即可扩展新命令，无需修改核心逻辑。交互式选择器提供了现代化的命令行体验，支持键盘导航和实时过滤。

---

**相关文档**：

- [CLI 接口实现](../src/cli/interface.ts)
- [命令类型定义](../src/cli/commands/types.ts)
- [命令注册器](../src/cli/commands/registry.ts)
- [命令加载器](../src/cli/commands/loader.ts)
