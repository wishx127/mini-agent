# Memory Worker 架构与实现原理

本文档深入探讨了 `memory-worker` 子进程监控方案的技术架构、实现细节以及各模块间的协作机制。

## 1. 核心架构设计

系统采用 **父子进程 (Parent-Child Process)** 模型，将计算密集型的长期记忆处理逻辑从主进程中分离，以确保主进程的响应速度和稳定性。

```text
┌───────────────────────────┐          ┌───────────────────────────┐
│      父进程 (CLI/Main)     │          │      子进程 (Worker)      │
│ ┌───────────────────────┐ │  spawn   │ ┌───────────────────────┐ │
│ │    WorkerMonitor      ├─┼──────────> │    MemoryConsumer     │ │
│ └──────────┬────────────┘ │          │ └──────────┬────────────┘ │
│            │              │          │            │              │
│ ┌──────────▼────────────┐ │          │ ┌──────────▼────────────┐ │
│ │      Status CLI       │ │          │ │ LongTermMemoryManager │ │
│ └──────────┬────────────┘ │          │ └───────────────────────┘ │
└────────────┼──────────────┘          └────────────┬──────────────┘
             │                                      │
             │           通信与持久化层             │
             │   ┌──────────────────────────────┐   │
             └───>      状态文件 (.json)        <───┘
                 │   (心跳、PID、队列积压)      │
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
                 │      日志文件 (.log)         <─── 子进程输出重定向
                 └──────────────────────────────┘
                 ┌──────────────────────────────┐
                 │      IPC Channel (可选)      <─── 状态主动上报
                 └──────────────────────────────┘
```

### 关键组件

- **[WorkerMonitor](mini-agent/src/worker/worker-monitor.ts)**: 运行于父进程，负责子进程的生命周期管理、健康检查和容错处理。
- **[MemoryConsumer](mini-agent/src/worker/memory-consumer.ts)**: 独立的 Worker 进程，封装了长期记忆的队列消费逻辑。
- **[WorkerMonitorUtils](mini-agent/src/worker/worker-monitor-utils.ts)**: 跨进程共享的状态读取与进程探测工具集。

---

## 2. 技术实现细节

### 2.1 进程生命周期管理

`WorkerMonitor` 使用 Node.js 的 `child_process.spawn` 启动 Worker。

- **启动策略**: `spawn` 配置为非分离模式 (`detached: false`)，确保主进程退出时能较好地管理子进程。
- **存活探测**: 通过 `process.kill(pid, 0)` 发送空信号来检测进程是否存在。这是一种极低开销的跨平台探测方式。
- **容错与重启**: 监听子进程的 `exit` 事件。若非正常退出（code !== 0），监控器会根据配置的 `maxRestarts` 和 `restartDelay` 触发指数退避（或固定延迟）的重启机制。

### 2.2 多维监控机制

系统不依赖单一的监控手段，而是结合了以下三种方式：

1.  **文件系统心跳 (Robust Heartbeat)**:
    Worker 每 5 秒将自身状态（PID、队列积压、运行时间等）序列化为 JSON 写入 `{tmpdir}/mini-agent/worker-{pid}.json`。这种方式不依赖 Node.js 事件循环的空闲，即使 Worker 处于高负载，文件系统操作通常也能完成。
2.  **IPC 通道 (Optional IPC)**:
    如果父子进程间存在 IPC 通道，Worker 会通过 `process.send` 推送实时状态，降低监控延迟。
3.  **标准流重定向 (Log Streaming)**:
    监控器在 `spawn` 时将子进程的 `stdout` 和 `stderr` 管道连接到 `createWriteStream` 创建的持久化日志文件中，实现日志的统一收集。

### 2.3 状态数据模型

状态文件包含以下核心指标，用于评估 Worker 的健康度：

```typescript
interface WorkerStatus {
  pid: number; // 进程 ID
  timestamp: string; // 最后一次心跳的 ISO 时间戳
  pendingJobs: number; // 向量数据库队列中待处理的任务数
  parentPid: number; // 记录父进程，用于双向监控
  uptime: number; // 累计运行时间（秒）
}
```

---

## 3. 模块协作逻辑

### 3.1 监控器与 Worker 的交互

- **初始化**: 监控器准备好日志流和临时目录，注入父进程 PID 作为启动参数。
- **心跳更新**: Worker 内部的 `setInterval` 驱动状态写入；监控器内部的 `heartbeatTimer` 定期检查文件的修改时间戳，若超过 `heartbeatTimeout` 则标记为超时。

### 3.2 Worker 与父进程的解耦

Worker 并不直接调用父进程的逻辑，而是通过 `LongTermMemoryManager` 与向量数据库交互。

- **孤儿进程保护**: Worker 定期检查 `parentPid` 是否存活。若父进程意外终止，Worker 可配置为 `drain-on-parent-exit` 模式，即处理完当前队列后再优雅退出，防止数据丢失。

### 3.3 状态检查工具

`check-worker-status.ts` 利用 `WorkerMonitorUtils` 遍历临时目录。其核心逻辑包括：

1.  **自动清理**: 发现状态文件存在但 PID 已不存在（`isProcessAlive` 为 false）时，自动删除残留文件。
2.  **延迟计算**: 计算 `Date.now() - timestamp`，若超过 15 秒则在 UI 上标记为“心跳超时”。

---

## 4. 设计考量与权衡

- **为什么使用临时文件存储状态？**
  相比于纯 IPC，文件系统更具持久性且易于被第三方工具（如 `check-worker-status.js`）在不接入父进程的情况下直接读取。
- **为什么不使用 PM2？**
  作为嵌入式 Agent，我们希望减少外部依赖。`WorkerMonitor` 实现了一个轻量级的、针对特定任务流优化的进程守护器。
- **并发处理**:
  系统设计支持多个 Worker 实例共存，每个实例通过 PID 区分状态文件。

---

## 5. 源码导航

- [worker-monitor.ts](mini-agent/src/worker/worker-monitor.ts): 核心监控逻辑、重启算法。
- [memory-consumer.ts](mini-agent/src/worker/memory-consumer.ts): Worker 任务循环、心跳上报实现。
- [worker-monitor-utils.ts](mini-agent/src/worker/worker-monitor-utils.ts): 状态文件解析、进程状态探测工具。
