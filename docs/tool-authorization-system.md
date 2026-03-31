# 工具授权系统设计文档

## 概述

工具授权系统（Tool Authorization System）是 mini-agent 项目中用于保护用户文件安全的重要机制。当工具需要访问项目目录外的文件路径时，该系统会暂停当前操作并请求用户明确授权，确保用户对敏感的文件操作有完全的控制权。

## 技术选型

### 核心依赖

| 组件         | 技术选型                  | 说明                                 |
| ------------ | ------------------------- | ------------------------------------ |
| CLI 输入处理 | `readline` (Node.js 内置) | 提供 `question()` 方法实现交互式询问 |
| 错误传播     | `ToolError` 异常类        | 携带错误码和详情信息的自定义错误     |
| 状态管理     | `AuthManager` 单例        | 全局授权状态管理，避免状态污染       |

### 关键技术点

1. **单次响应模式**：使用 `rl.once('close', ...)` 确保每个问题只处理一次回答
2. **SIGINT 处理**：正确处理 Ctrl+C 中断，将其视为拒绝授权
3. **状态隔离**：每次询问创建新的 readline 接口，避免状态混淆
4. **回调机制**：通过回调与 CLI 界面协调 spinner 和输入监听的状态

## 核心组件

### 1. AuthManager（授权管理器）

**文件位置**：`src/tools/auth-manager.ts`

**核心职责**：

- 管理交互式授权流程
- 检测工具错误是否需要授权
- 从错误中提取授权详情

**关键方法**：

```typescript
// 设置回调函数（由 CLI 界面调用）
setCallbacks(callbacks: AuthCallbacks): void

// 执行交互式授权询问
askForAuth(details: AuthDetails): Promise<boolean>

// 判断错误是否需要授权
isAuthRequired(error: unknown): boolean

// 从错误提取授权详情
extractAuthDetails(error: unknown): AuthDetails
```

### 2. ToolError（工具错误类）

**文件位置**：`src/tools/plugins/file-operations/types.ts`

**错误码枚举**：

```typescript
enum FileOperationErrorCode {
  PATH_ACCESS_DENIED = 'PATH_ACCESS_DENIED', // 路径访问被拒绝（触发授权）
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  // ... 其他错误码
}
```

### 3. 路径验证器

**文件位置**：`src/tools/plugins/file-operations/path-validator.ts`

**核心函数**：

```typescript
// 判断路径是否在项目目录内
isPathWithinProject(targetPath: string): boolean

// 带软链接解析的完整路径验证
validatePath(targetPath: string): Promise<PathValidationResult>
```

**验证逻辑**：

1. 相对路径按项目根目录解析为绝对路径
2. 使用 `path.normalize()` 规范化路径分隔符
3. 通过 `startsWith()` 检查路径前缀是否在项目目录内
4. 使用 `fs.realpath()` 解析软链接后再次验证

## 工作流程

### 完整授权流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户执行文件操作工具                         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    工具检查路径是否在项目内                         │
│                    isPathWithinProject(path)                     │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              路径在项目内                  路径在项目外
                    │                         │
                    ▼                         ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│      正常执行文件操作       │   │  抛出 ToolError                  │
│                           │   │  code: PATH_ACCESS_DENIED       │
└───────────────────────────┘   └─────────────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────┐
                              │   executeTool 捕获错误      │
                              │   authManager.isAuthRequired() │
                              └───────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────┐
                              │  提取授权详情               │
                              │  extractAuthDetails()     │
                              └───────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────┐
                              │  调用 askForAuth()        │
                              │  暂停 spinner             │
                              │  暂停 CLI 输入监听        │
                              └───────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────┐
                              │  显示交互式提示             │
                              │  是否允许 [operation]?    │
                              │  (y/n):                   │
                              └───────────────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │                       │
                           用户输入 y              用户输入 n / Ctrl+C
                              │                       │
                              ▼                       ▼
┌─────────────────────────┐   │   ┌─────────────────────────────────┐
│  恢复 spinner           │   │   │  恢复 spinner                    │
│  恢复 CLI 输入监听       │   │   │  恢复 CLI 输入监听               │
│  返回 allowed=true     │   │   │  返回 allowed=false              │
│  重新执行工具            │   │   │  抛出拒绝访问错误                 │
│  (带 require_auth=true) │   │   └─────────────────────────────────┘
└─────────────────────────┘   │
                                ▼
                   ┌────────────────────────┐
                   │   工具检查 require_auth │
                   │   发现为 true，跳过路径  │
                   │   安全检查，执行操作     │
                   └────────────────────────┘
                                          │
                                          ▼
                         ┌────────────────────────────────┐
                         │         操作成功完成             │
                         └────────────────────────────────┘
```

### 关键步骤说明

#### 第一步：路径安全检查

文件操作工具在执行前调用 `isPathWithinProject()` 检查目标路径：

```typescript
// path-validator.ts
export function isPathWithinProject(targetPath: string): boolean {
  const root = getProjectRoot();
  const normalizedTarget = path.normalize(targetPath);
  const normalizedRoot = path.normalize(root);

  // 确保前缀匹配精确（防止 /project-foo 匹配 /project）
  const targetWithSep = normalizedTarget + path.sep;
  const rootWithSep = normalizedRoot + path.sep;

  return targetWithSep.startsWith(rootWithSep);
}
```

#### 第二步：抛出授权错误

当路径超出项目目录时，工具抛出 `ToolError`：

```typescript
// write-tool.ts (示例)
if (!isPathWithinProject(resolvedPath) && !require_auth) {
  throw new ToolError(
    FileOperationErrorCode.PATH_ACCESS_DENIED,
    `无法写入文件，因为目标路径超出了项目允许的范围`,
    { operation: '写入文件', path: file_path, projectRoot: getProjectRoot() }
  );
}
```

#### 第三步：捕获并处理授权

`ToolRegistry.executeTool()` 捕获工具错误，检查是否需要授权：

```typescript
// base.ts - executeTool()
try {
  return await tool.run(params);
} catch (error) {
  if (authManager.isAuthRequired(error)) {
    const details = authManager.extractAuthDetails(error);
    const allowed = await authManager.askForAuth(details);

    if (allowed) {
      // 用户授权，重新执行（带 require_auth 标志）
      return await tool.run({ ...params, require_auth: true });
    } else {
      // 用户拒绝
      throw new Error(`访问被拒绝：用户不允许 "${details.operation}"`);
    }
  }
  throw error;
}
```

#### 第四步：交互式授权询问

`AuthManager.askForAuth()` 使用 readline 实现同步等待的交互式询问：

```typescript
// auth-manager.ts
async askForAuth(details: AuthDetails): Promise<boolean> {
  this.callbacks?.pauseCliInput?.();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY,
  });

  return new Promise((resolve) => {
    let hasResponded = false;

    // Ctrl+C 处理
    rl.on('SIGINT', () => {
      if (!hasResponded) {
        hasResponded = true;
        rl.close();
        resolve(false);  // 视为拒绝
      }
    });

    rl.question(
      chalk.cyan(`是否允许 ${operation}? (y/n): `),
      (answer: string) => {
        hasResponded = true;
        const allowed = answer.trim().toLowerCase() === 'y' ||
                        answer.trim().toLowerCase() === 'yes';
        rl.close();
        resolve(allowed);
      }
    );
  });
}
```

#### 第五步：授权后重新执行

工具检测到 `require_auth: true` 后，跳过路径安全检查直接执行：

```typescript
// 工具执行时
if (!isPathWithinProject(resolvedPath) && !require_auth) {
  throw new Error('Access denied');
}

// require_auth 为 true 时，跳过检查直接执行
// ... 执行文件操作
```

## 涉及的受保护工具

以下文件操作工具已集成授权系统：

| 工具   | 文件             | 操作            |
| ------ | ---------------- | --------------- |
| Create | `create-tool.ts` | 创建新文件      |
| Write  | `write-tool.ts`  | 写入文件内容    |
| Mkdir  | `mkdir-tool.ts`  | 创建目录        |
| Move   | `move-tool.ts`   | 移动/重命名文件 |
| Delete | `delete-tool.ts` | 删除文件/目录   |

## CLI 界面集成

**文件位置**：`src/cli/interface.ts`

### stdin 和 Raw Mode 处理

CLI 界面在交互式授权前后需要正确处理 stdin 的状态，这是确保授权询问能正常接收用户输入的关键。

#### 初始化时的设置

在 CLI 启动时，会对 stdin 进行以下配置：

```typescript
// interface.ts - run() 方法中

// 1. 设置 stdin 为 raw mode 以捕获单个按键
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// 2. 恢复 stdin（确保可读）
process.stdin.resume();

// 3. 设置 UTF-8 编码
process.stdin.setEncoding('utf8');

// 4. 保存 stdin 处理器引用，以便暂停/恢复
this.stdinHandler = (data: string | Buffer) => {
  const key = typeof data === 'string' ? data : data.toString('utf8');
  void this.handleKeyPress(key);
};

// 5. 注册按键监听器
process.stdin.on('data', this.stdinHandler);
```

**关键概念解释**：

| 配置               | 作用                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `setRawMode(true)` | Raw mode 下，按键立即可用（不回显），每个按键作为单个 `data` 事件触发 |
| `resume()`         | 恢复被暂停的 stdin 流，使其能触发 `data` 事件                         |
| `pause()`          | 暂停 stdin 流，阻止 `data` 事件触发                                   |

#### stdin 与 Raw Mode 科普

**什么是 stdin？**

stdin（标准输入）是进程读取用户输入的通道。在 Node.js 中，`process.stdin` 是一个可读流，默认情况下：

- 连接着终端的输入
- 以**行**为单位发送数据（即按 Enter 后才触发 `data` 事件）
- 按键会回显到终端屏幕

**Cooked Mode（默认模式）**

终端默认运行在 **Cooked mode**（也称为 canonical mode）：

- 用户按下的按键首先被放入缓冲区
- 只有按下 Enter/Return 后，输入才被发送到程序
- 支持行编辑（Backspace 删除等）
- 按键不回显到终端（由终端处理）

```
用户输入: a → b → c → Enter
Cooked mode 发送: "abc\n" 到 stdin
```

**Raw Mode**

**Raw mode** 跳过行缓冲，按键立即发送到程序：

```
用户输入: a → b → c → Enter
Raw mode 发送: "a" → "b" → "c" → "\r" 每次按键都触发 data 事件
```

**为什么 CLI 需要 Raw Mode？**

CLI 应用（如本项目）需要捕获方向键、Ctrl+C 等特殊按键来实现：

- 命令历史上下翻页（↑↓）
- 命令自动补全提示
- 快捷键响应（Ctrl+C 中断等）

这些按键在 Cooked mode 下会被终端或行缓冲处理掉，应用无法收到。

**readline 与 stdin 的冲突**

当 readline 的 `question()` 显示提示时：

- readline 内部会将 stdin 切换到 Cooked mode（以便行缓冲输入）
- 同时接管按键回显和行编辑

此时如果 CLI 的 `stdinHandler`（在 Raw mode 下工作）也在监听：

- 两者都会收到按键事件
- 造成数据混乱或重复处理

**解决方案：暂停 + 恢复**

```
┌──────────────────────────────────────────────────────────────┐
│ Raw Mode CLI 工作时                                          │
│ stdinHandler 捕获每个按键，处理命令选择等                      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 授权询问开始 - pauseCliInput()                               │
│ 1. 移除 stdinHandler（停止 Raw mode 按键处理）               │
│ 2. stdin.pause()（暂停流）                                   │
│ 3. readline 接管 stdin（切换到 Cooked mode）                 │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ readline.question() 工作中                                    │
│ 用户输入 y/n → Enter                                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 授权询问结束 - resumeCliInput()                               │
│ 1. readline 关闭 stdin恢复原始状态                            │
│ 2. stdin.resume()（恢复流）                                   │
│ 3. stdin.setRawMode(true)（重新启用 Raw mode）               │
│ 4. 重新注册 stdinHandler（恢复按键处理）                       │
└──────────────────────────────────────────────────────────────┘
```

#### 授权询问前的处理（pauseCliInput）

当 `AuthManager.askForAuth()` 被调用前，CLI 会暂停 stdin 监听：

```typescript
pauseCliInput: () => {
  // 1. 移除 stdin 的 data 事件监听器
  if (this.stdinHandler) {
    process.stdin.removeListener('data', this.stdinHandler);
  }

  // 2. 暂停 stdin 流，防止按键事件干扰 readline
  if (!process.stdin.isPaused()) {
    process.stdin.pause();
  }
};
```

**为什么要暂停**：

- CLI 的 `stdinHandler` 在 raw mode 下捕获按键用于命令选择、快捷键等
- readline 在工作时也需要读取 stdin
- 如果两者同时监听，会造成冲突和数据混乱

#### 授权询问后的处理（resumeCliInput）

用户完成授权输入后（回答 y/n 或 Ctrl+C），CLI 需要恢复状态：

```typescript
resumeCliInput: () => {
  try {
    // 1. 重新注册 stdin 监听器
    if (this.stdinHandler) {
      process.stdin.removeListener('data', this.stdinHandler);
      process.stdin.on('data', this.stdinHandler);
    }

    // 2. 恢复 stdin 流
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }

    // 3. 重新设置 raw mode（关键！确保按键被正确捕获）
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    // 4. 重置输入状态
    this.normalInputBuffer = '';
    this.inputMode = 'normal';
    this.commandSelector.deactivate();

    // 5. 重新显示命令提示符
    this.showPrompt();
  } catch (error) {
    // 错误恢复逻辑...
  }
};
```

**为什么要重新设置 raw mode**：

- readline 内部可能会修改 stdin 的 mode 设置
- readline 关闭后，stdin 可能已不在 raw mode
- 必须重新调用 `setRawMode(true)` 恢复原始行为

### 完整回调流程图

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI 初始化                              │
│  setRawMode(true) → resume() → 注册 stdinHandler            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              用户触发项目外文件操作                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 AuthManager.askForAuth()                    │
│                                                             │
│  pauseCliInput() 执行：                                     │
│    - 移除 stdinHandler 监听器                               │
│    - stdin.pause()                                         │
│                                                             │
│  readline.createInterface() 创建新接口                      │
│  rl.question() 显示提示并等待输入                           │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       用户输入 y/n                   Ctrl+C 中断
              │                               │
              ▼                               ▼
    rl.close() 正常关闭            SIGINT 事件触发
              │                               │
              ▼                               ▼
┌─────────────────────────┐    ┌─────────────────────────────┐
│ resumeCliInput() 执行：  │    │  rl.close()                 │
│                         │    │  resolve(false) 视为拒绝   │
│  - 重新注册 stdinHandler │    │                             │
│  - stdin.resume()       │    │  resumeCliInput() 执行      │
│  - setRawMode(true)     │    │  （同上，恢复原始状态）      │
│  - showPrompt()         │    └─────────────────────────────┘
└─────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│    返回授权结果         │
│    重新执行或抛出错误    │
└─────────────────────────┘
```

## 安全特性

1. **路径黑盒验证**：工具无法自行设置 `require_auth`，必须通过用户交互授权
2. **软链接解析**：使用 `realpath()` 解析软链接后二次验证，防止绕过
3. **精确前缀匹配**：通过添加路径分隔符确保 `/project-foo` 不会匹配 `/project`
4. **单次回答**：使用 `once('close')` 防止重复处理用户输入
5. **优雅中断**：Ctrl+C 被正确识别为拒绝授权

## 设计优点

1. **最小侵入**：授权逻辑集中在 `AuthManager`，工具只需检查路径并抛出错误
2. **状态隔离**：每次询问创建新的 readline 接口，避免状态污染
3. **可扩展**：新工具只需继承路径检查逻辑即可获得授权保护
4. **用户体验**：与 CLI spinner 无缝集成，不中断用户操作流程
