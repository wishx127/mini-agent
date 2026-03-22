/**
 * 异步读写锁实现
 * 提供线程安全的并发控制机制
 */

export type LockMode = 'read' | 'write';

export interface LockOptions {
  timeout?: number;
  priority?: 'read' | 'write';
}

export interface LockResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  waitTime: number;
}

/**
 * 异步读写锁类
 * 支持并发读操作，互斥写操作
 */
export class AsyncLock {
  private readers: number = 0;
  private writer: boolean = false;
  private readQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId?: NodeJS.Timeout;
  }> = [];
  private writeQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId?: NodeJS.Timeout;
  }> = [];
  private priority: 'read' | 'write' = 'read';
  private maxWaitTime: number = 30000; // 最大等待时间30秒

  constructor(options?: LockOptions) {
    if (options?.priority) {
      this.priority = options.priority;
    }
    if (options?.timeout) {
      this.maxWaitTime = options.timeout;
    }
  }

  /**
   * 获取锁并执行操作
   * @param mode 锁模式：'read' 或 'write'
   * @param operation 要执行的操作
   * @param options 锁选项
   * @returns 操作结果
   */
  async acquire<T>(
    mode: LockMode,
    operation: () => Promise<T>,
    options?: LockOptions
  ): Promise<LockResult<T>> {
    const startTime = Date.now();
    const timeout = options?.timeout ?? this.maxWaitTime;

    try {
      // 等待获取锁
      await this.waitLock(mode, timeout);
      const waitTime = Date.now() - startTime;

      try {
        // 执行操作
        const result = await operation();
        return {
          success: true,
          result,
          waitTime,
        };
      } finally {
        // 释放锁
        this.release(mode);
      }
    } catch (error) {
      const waitTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        waitTime,
      };
    }
  }

  /**
   * 尝试获取锁（非阻塞）
   * @param mode 锁模式
   * @returns 是否成功获取锁
   */
  tryAcquire(mode: LockMode): boolean {
    if (mode === 'read') {
      if (!this.writer) {
        this.readers++;
        return true;
      }
      return false;
    } else {
      if (!this.writer && this.readers === 0) {
        this.writer = true;
        return true;
      }
      return false;
    }
  }

  /**
   * 等待获取锁
   * @param mode 锁模式
   * @param timeout 超时时间
   */
  private async waitLock(mode: LockMode, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // 从队列中移除
        this.removeFromQueue(mode, waiter);
        reject(new Error(`Lock acquisition timeout after ${timeout}ms`));
      }, timeout);

      const waiter = {
        resolve: () => {
          clearTimeout(timeoutId);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        timeoutId,
      };

      // 尝试立即获取锁
      if (this.tryAcquire(mode)) {
        clearTimeout(timeoutId);
        resolve();
        return;
      }

      // 加入等待队列
      if (mode === 'read') {
        this.readQueue.push(waiter);
      } else {
        this.writeQueue.push(waiter);
      }
    });
  }

  /**
   * 从队列中移除等待者
   */
  private removeFromQueue(
    mode: LockMode,
    waiter: {
      resolve: () => void;
      reject: (error: Error) => void;
      timeoutId?: NodeJS.Timeout;
    }
  ): void {
    if (mode === 'read') {
      const index = this.readQueue.indexOf(waiter);
      if (index > -1) {
        this.readQueue.splice(index, 1);
      }
    } else {
      const index = this.writeQueue.indexOf(waiter);
      if (index > -1) {
        this.writeQueue.splice(index, 1);
      }
    }
  }

  /**
   * 释放锁
   * @param mode 锁模式
   */
  private release(mode: LockMode): void {
    if (mode === 'read') {
      this.readers--;
      if (this.readers === 0) {
        this.processNextWriter();
      }
    } else {
      this.writer = false;
      this.processNext();
    }
  }

  /**
   * 处理下一个等待者
   */
  private processNext(): void {
    // 根据优先级处理
    if (this.priority === 'write') {
      // 优先处理写请求
      if (this.writeQueue.length > 0) {
        this.processNextWriter();
      } else if (this.readQueue.length > 0) {
        this.processNextReaders();
      }
    } else {
      // 优先处理读请求
      if (this.readQueue.length > 0) {
        this.processNextReaders();
      } else if (this.writeQueue.length > 0) {
        this.processNextWriter();
      }
    }
  }

  /**
   * 处理下一个写请求
   */
  private processNextWriter(): void {
    if (this.writeQueue.length > 0 && !this.writer && this.readers === 0) {
      const nextWriter = this.writeQueue.shift();
      if (nextWriter) {
        this.writer = true;
        nextWriter.resolve();
      }
    }
  }

  /**
   * 处理所有等待的读请求
   */
  private processNextReaders(): void {
    if (!this.writer && this.readQueue.length > 0) {
      // 释放所有等待的读请求
      while (this.readQueue.length > 0) {
        const nextReader = this.readQueue.shift();
        if (nextReader) {
          this.readers++;
          nextReader.resolve();
        }
      }
    }
  }

  /**
   * 获取当前锁状态
   */
  getStatus(): {
    readers: number;
    writer: boolean;
    readQueueLength: number;
    writeQueueLength: number;
  } {
    return {
      readers: this.readers,
      writer: this.writer,
      readQueueLength: this.readQueue.length,
      writeQueueLength: this.writeQueue.length,
    };
  }

  /**
   * 检查是否有等待者
   */
  hasWaiters(): boolean {
    return this.readQueue.length > 0 || this.writeQueue.length > 0;
  }

  /**
   * 清空所有等待者（用于测试或紧急情况）
   */
  clearWaiters(): void {
    // 拒绝所有等待的读请求
    for (const waiter of this.readQueue) {
      if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }
      waiter.reject(new Error('Lock cleared'));
    }
    this.readQueue = [];

    // 拒绝所有等待的写请求
    for (const waiter of this.writeQueue) {
      if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }
      waiter.reject(new Error('Lock cleared'));
    }
    this.writeQueue = [];
  }

  /**
   * 重置锁状态
   */
  reset(): void {
    this.clearWaiters();
    this.readers = 0;
    this.writer = false;
  }
}

/**
 * 创建互斥锁（只允许写操作）
 */
export class Mutex {
  private lock: AsyncLock;

  constructor(timeout?: number) {
    this.lock = new AsyncLock({ priority: 'write', timeout });
  }

  /**
   * 获取互斥锁并执行操作
   */
  async acquire<T>(operation: () => Promise<T>): Promise<LockResult<T>> {
    return this.lock.acquire('write', operation);
  }

  /**
   * 尝试获取互斥锁
   */
  tryAcquire(): boolean {
    return this.lock.tryAcquire('write');
  }

  /**
   * 释放互斥锁
   */
  release(): void {
    // 通过内部方法释放锁
    (this.lock as unknown as { release: (mode: LockMode) => void }).release(
      'write'
    );
  }

  /**
   * 获取锁状态
   */
  getStatus() {
    return this.lock.getStatus();
  }
}

/**
 * 创建读写锁工厂
 */
export class LockFactory {
  private locks: Map<string, AsyncLock> = new Map();

  /**
   * 获取或创建锁
   */
  getLock(name: string, options?: LockOptions): AsyncLock {
    if (!this.locks.has(name)) {
      this.locks.set(name, new AsyncLock(options));
    }
    return this.locks.get(name)!;
  }

  /**
   * 移除锁
   */
  removeLock(name: string): boolean {
    const lock = this.locks.get(name);
    if (lock) {
      lock.reset();
      this.locks.delete(name);
      return true;
    }
    return false;
  }

  /**
   * 获取所有锁的状态
   */
  getAllStatus(): Record<string, ReturnType<AsyncLock['getStatus']>> {
    const status: Record<string, ReturnType<AsyncLock['getStatus']>> = {};
    for (const [name, lock] of this.locks) {
      status[name] = lock.getStatus();
    }
    return status;
  }

  /**
   * 清空所有锁
   */
  clearAll(): void {
    for (const lock of this.locks.values()) {
      lock.reset();
    }
    this.locks.clear();
  }
}

// 默认锁工厂实例
export const defaultLockFactory = new LockFactory();

/**
 * 装饰器：为方法添加读锁
 */
export function withReadLock(lockName?: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const lock = lockName
      ? defaultLockFactory.getLock(lockName)
      : new AsyncLock();

    descriptor.value = async function (
      this: object,
      ...args: unknown[]
    ): Promise<unknown> {
      const result = await lock.acquire('read', () =>
        originalMethod.apply(this, args)
      );
      if (!result.success) {
        throw result.error ?? new Error('Lock acquisition failed');
      }
      return result.result;
    };

    return descriptor;
  };
}

/**
 * 装饰器：为方法添加写锁
 */
export function withWriteLock(lockName?: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const lock = lockName
      ? defaultLockFactory.getLock(lockName)
      : new AsyncLock();

    descriptor.value = async function (
      this: object,
      ...args: unknown[]
    ): Promise<unknown> {
      const result = await lock.acquire('write', () =>
        originalMethod.apply(this, args)
      );
      if (!result.success) {
        throw result.error ?? new Error('Lock acquisition failed');
      }
      return result.result;
    };

    return descriptor;
  };
}
