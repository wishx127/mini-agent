/**
 * 路径验证器
 * 验证所有文件路径访问是否在允许范围内
 */

import { realpathSync } from 'fs';
import { resolve, isAbsolute, normalize } from 'path';

import { ErrorCode, ErrorType, ToolError } from './types.js';

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  // 从当前工作目录开始向上查找
  const cwd = process.cwd();
  return cwd;
}

/**
 * 验证路径是否在项目目录内
 */
export function validatePath(
  targetPath: string,
  cwd?: string
): { valid: boolean; error?: ToolError; resolvedPath?: string } {
  try {
    // 解析为绝对路径
    let absolutePath: string;

    if (isAbsolute(targetPath)) {
      absolutePath = normalize(targetPath);
    } else {
      absolutePath = resolve(cwd || process.cwd(), targetPath);
    }

    // 使用 realpath 解析符号链接
    let realPath: string;
    try {
      realPath = realpathSync.native(absolutePath);
    } catch {
      // 如果路径不存在，使用规范化后的路径
      realPath = absolutePath;
    }

    // 获取项目根目录
    const projectRoot = getProjectRoot();

    // 验证路径在项目目录内
    const normalizedProjectRoot = normalize(projectRoot);
    const normalizedRealPath = normalize(realPath);

    if (!normalizedRealPath.startsWith(normalizedProjectRoot)) {
      return {
        valid: false,
        error: {
          code: ErrorCode.SECURITY_ACCESS_DENIED,
          message: `Access denied: path outside project directory`,
          type: ErrorType.SECURITY,
          retryable: false,
          details: {
            path: targetPath,
            resolvedPath: realPath,
            projectRoot,
          },
        },
      };
    }

    return {
      valid: true,
      resolvedPath: realPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: {
        code: ErrorCode.SECURITY_ACCESS_DENIED,
        message: `Path validation failed: ${error instanceof Error ? error.message : String(error)}`,
        type: ErrorType.SECURITY,
        retryable: false,
        details: { path: targetPath },
      },
    };
  }
}

/**
 * 检测路径遍历攻击
 */
export function detectPathTraversal(args: string[]): {
  detected: boolean;
  error?: ToolError;
} {
  for (const arg of args) {
    // 检测 ../ 模式
    if (arg.includes('../') || arg.includes('..\\')) {
      return {
        detected: true,
        error: {
          code: ErrorCode.SECURITY_PATH_TRAVERSAL,
          message: 'Path traversal not allowed',
          type: ErrorType.SECURITY,
          retryable: false,
          details: { argument: arg },
        },
      };
    }
  }

  return { detected: false };
}

/**
 * 验证工作目录
 */
export function validateWorkingDirectory(cwd?: string): {
  valid: boolean;
  error?: ToolError;
  resolvedPath?: string;
} {
  if (!cwd) {
    return { valid: true, resolvedPath: process.cwd() };
  }

  return validatePath(cwd);
}
