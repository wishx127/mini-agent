/**
 * 授权管理模块
 * 提供文件操作的授权管理功能
 */

import path from 'node:path';

/**
 * 授权管理器接口
 */
export interface AuthManager {
  askForAuth(operation: string, details: unknown): Promise<boolean>;
  isAuthorized(operation: string): boolean;
  clearAuth(operation: string): void;
}

/**
 * 授权详情字段
 */
export interface AuthDetailsFields {
  filePath?: string;
  dirPath?: string;
  path?: string;
  sourcePath?: string;
  targetPath?: string;
}

/**
 * 规范化路径
 * - 转换为绝对路径
 * - 规范化路径格式
 * @param rawPath 原始路径
 * @returns 规范化后的绝对路径
 */
export function normalizeAuthPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return '';
  }
  const normalized = path.normalize(rawPath);
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized);
}

/**
 * 生成授权key
 * 格式: <operation>:<normalizedAbsolutePath>
 * 对于move操作: move:<src> => <dst>
 *
 * @param operation 操作类型
 * @param details 授权详情字段
 * @returns 授权key
 */
export function buildAuthKey(
  operation: string,
  details: AuthDetailsFields
): string {
  // 处理move操作（双路径）
  if (operation === 'move') {
    const sourcePath = normalizeAuthPath(details.sourcePath);
    const targetPath = normalizeAuthPath(details.targetPath);
    if (sourcePath && targetPath) {
      return `move:${sourcePath} => ${targetPath}`;
    }
    // 如果只有一个路径，退化为单路径格式
    const singlePath = sourcePath || targetPath;
    if (singlePath) {
      return `move:${singlePath}`;
    }
    return operation;
  }

  // 单路径操作：按优先级查找路径字段
  const pathCandidates = [
    details.filePath,
    details.path,
    details.dirPath,
    details.sourcePath,
    details.targetPath,
  ];

  const normalizedPath = pathCandidates
    .map((candidate) => normalizeAuthPath(candidate))
    .find((candidate) => candidate.length > 0);

  return normalizedPath ? `${operation}:${normalizedPath}` : operation;
}

/**
 * 从任意对象中提取授权详情字段
 * @param details 任意对象
 * @returns 授权详情字段
 */
export function extractAuthDetailsFields(details: unknown): AuthDetailsFields {
  if (!details || typeof details !== 'object') {
    return {};
  }
  const d = details as Record<string, unknown>;
  return {
    filePath: typeof d.filePath === 'string' ? d.filePath : undefined,
    dirPath: typeof d.dirPath === 'string' ? d.dirPath : undefined,
    path: typeof d.path === 'string' ? d.path : undefined,
    sourcePath: typeof d.sourcePath === 'string' ? d.sourcePath : undefined,
    targetPath: typeof d.targetPath === 'string' ? d.targetPath : undefined,
  };
}

/**
 * 带缓存的授权管理器实现
 */
export class CachedAuthManager implements AuthManager {
  private authorizedOperations: Map<string, number> = new Map();
  private rejectedOperations: Set<string> = new Set();
  private cacheDurationMs: number;

  /**
   * @param cacheDurationMs 授权缓存有效期（毫秒），默认 5 分钟
   */
  constructor(cacheDurationMs: number = 5 * 60 * 1000) {
    this.cacheDurationMs = cacheDurationMs;
  }

  /**
   * 生成操作唯一键
   */
  private getOperationKey(operation: string, details: unknown): string {
    const fields = extractAuthDetailsFields(details);
    return buildAuthKey(operation, fields);
  }

  /**
   * 检查是否已授权（带缓存检查）
   */
  isAuthorized(operation: string): boolean {
    const timestamp = this.authorizedOperations.get(operation);
    if (!timestamp) {
      return false;
    }

    // 检查缓存是否过期
    if (Date.now() - timestamp > this.cacheDurationMs) {
      this.authorizedOperations.delete(operation);
      return false;
    }

    return true;
  }

  /**
   * 请求授权
   */
  async askForAuth(operation: string, details: unknown): Promise<boolean> {
    const key = this.getOperationKey(operation, details);

    // 检查是否已被拒绝
    if (this.rejectedOperations.has(key)) {
      return false;
    }

    // 检查是否已授权且未过期
    if (this.isAuthorized(key)) {
      return true;
    }

    // 这里应该调用实际的授权 UI
    // 由于这是一个基础实现，返回 false 表示需要外部处理
    // 外部应该通过 setAuthManager 设置一个实际的实现
    return await Promise.resolve(false);
  }

  /**
   * 授予授权（用于外部确认后调用）
   */
  grantAuth(operation: string, details?: unknown): void {
    const key = details ? this.getOperationKey(operation, details) : operation;
    this.authorizedOperations.set(key, Date.now());
    this.rejectedOperations.delete(key);
  }

  /**
   * 拒绝授权
   */
  rejectAuth(operation: string, details?: unknown): void {
    const key = details ? this.getOperationKey(operation, details) : operation;
    this.rejectedOperations.add(key);
    this.authorizedOperations.delete(key);
  }

  /**
   * 清除授权
   */
  clearAuth(operation: string): void {
    this.authorizedOperations.delete(operation);
    this.rejectedOperations.delete(operation);
  }

  /**
   * 清除所有授权和拒绝记录
   */
  clearAll(): void {
    this.authorizedOperations.clear();
    this.rejectedOperations.clear();
  }

  /**
   * 获取缓存的授权数量
   */
  getCachedAuthCount(): number {
    // 清理过期的缓存
    const now = Date.now();
    for (const [key, timestamp] of this.authorizedOperations.entries()) {
      if (now - timestamp > this.cacheDurationMs) {
        this.authorizedOperations.delete(key);
      }
    }
    return this.authorizedOperations.size;
  }

  /**
   * 获取被拒绝的操作数量
   */
  getRejectedCount(): number {
    return this.rejectedOperations.size;
  }
}

// 全局授权管理器（需要外部注入）
let globalAuthManager: AuthManager | null = null;

/**
 * 设置授权管理器
 * @param authManager 授权管理器实例
 */
export function setAuthManager(authManager: AuthManager): void {
  globalAuthManager = authManager;
}

/**
 * 获取授权管理器
 * @returns 授权管理器实例
 */
export function getAuthManager(): AuthManager | null {
  return globalAuthManager;
}
