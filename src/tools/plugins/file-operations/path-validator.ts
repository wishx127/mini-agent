import { realpath, stat, open, mkdir, access } from 'fs/promises';
import path from 'path';

import { ToolError, FileOperationErrorCode } from './types.js';

/**
 * 项目根目录（从环境变量获取或默认当前工作目录）
 */
const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

/**
 * 规范化项目根目录路径
 */
const normalizedProjectRoot = path.resolve(PROJECT_ROOT);

/**
 * 路径安全验证结果
 */
export interface PathValidationResult {
  /** 原始请求路径 */
  originalPath: string;
  /** 解析后的绝对路径 */
  resolvedPath: string;
  /** 软链接解析后的真实路径 */
  realPath: string;
  /** 文件状态信息 */
  stats?: Awaited<ReturnType<typeof stat>>;
}

/**
 * 验证路径是否在项目目录内
 * @param targetPath 要验证的路径
 * @returns 验证结果
 * @throws ToolError 路径不安全时抛出错误
 */
export async function validatePath(
  targetPath: string
): Promise<PathValidationResult> {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new ToolError(
      FileOperationErrorCode.PATH_NOT_FOUND,
      'Path is required',
      { path: targetPath }
    );
  }

  // 1. 使用 path.resolve() 将相对路径转换为绝对路径
  const resolvedPath = path.resolve(normalizedProjectRoot, targetPath);

  // 2. 检查路径是否在项目根目录内（初步检查）
  if (!isPathWithinProject(resolvedPath)) {
    throw new ToolError(
      FileOperationErrorCode.PATH_ACCESS_DENIED,
      `Access denied: ${targetPath} is outside project directory`,
      { path: targetPath, projectRoot: normalizedProjectRoot }
    );
  }

  // 3. 检查文件/目录是否存在
  let statsResult: Awaited<ReturnType<typeof stat>>;
  try {
    statsResult = await stat(resolvedPath);
  } catch {
    throw new ToolError(
      FileOperationErrorCode.PATH_NOT_FOUND,
      `File not found: ${targetPath}`,
      { path: targetPath }
    );
  }

  // 4. 使用 fs.realpath() 解析软链接获取真实路径
  let realPath: string;
  try {
    realPath = await realpath(resolvedPath);
  } catch {
    // 如果 realpath 失败，使用 resolvedPath
    realPath = resolvedPath;
  }

  // 5. 再次验证真实路径是否在项目根目录内
  if (!isPathWithinProject(realPath)) {
    throw new ToolError(
      FileOperationErrorCode.PATH_ACCESS_DENIED,
      `Access denied: ${targetPath} resolves to path outside project directory`,
      { path: targetPath, realPath, projectRoot: normalizedProjectRoot }
    );
  }

  return {
    originalPath: targetPath,
    resolvedPath,
    realPath,
    stats: statsResult,
  };
}

/**
 * 检查路径是否在项目根目录内
 * @param targetPath 要检查的路径
 * @returns 是否在项目目录内
 */
export function isPathWithinProject(targetPath: string): boolean {
  // 使用 getProjectRoot() 确保与工具使用相同的项目根目录
  const root = getProjectRoot();

  // 规范化路径，确保分隔符一致
  const normalizedTarget = path.normalize(targetPath);
  const normalizedRoot = path.normalize(root);

  // 使用 startsWith 检查路径前缀
  // 添加路径分隔符确保精确匹配（防止 /project-foo 匹配 /project）
  const targetWithSep = normalizedTarget.endsWith(path.sep)
    ? normalizedTarget
    : normalizedTarget + path.sep;
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  return (
    targetWithSep.startsWith(rootWithSep) || normalizedTarget === normalizedRoot
  );
}

/**
 * 验证文件大小是否在限制内
 * @param filePath 文件路径
 * @param maxSizeMB 最大大小（MB，默认 1MB）
 * @throws ToolError 文件过大时抛出错误
 */
export async function validateFileSize(
  filePath: string,
  maxSizeMB: number = 1
): Promise<void> {
  const stats = await stat(filePath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB > maxSizeMB) {
    throw new ToolError(
      FileOperationErrorCode.FILE_TOO_LARGE,
      `File too large: ${filePath} (size: ${sizeMB.toFixed(2)} MB, max: ${maxSizeMB} MB)`,
      { path: filePath, size: sizeMB, maxSize: maxSizeMB }
    );
  }
}

/**
 * 检测文件是否为文本文件
 * @param filePath 文件路径
 * @returns 是否为文本文件
 * @throws ToolError 不是有效文本文件时抛出错误
 */
export async function validateTextFile(filePath: string): Promise<void> {
  const fd = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024);
    const result = await fd.read(buffer, 0, 1024, 0);
    const bytesRead = result.bytesRead;

    if (bytesRead === 0) {
      return; // 空文件视为文本文件
    }

    const sample = buffer.subarray(0, bytesRead);

    // 1. 检测 null 字节（二进制文件特征）
    if (sample.includes(0)) {
      throw new ToolError(
        FileOperationErrorCode.INVALID_ENCODING,
        `File is not valid text: ${filePath}`,
        { path: filePath }
      );
    }

    // 2. 检测 BOM
    if (hasBOM(sample)) {
      return; // 有 BOM 的 Unicode 文件
    }

    // 3. 检查是否为有效的 UTF-8
    if (isValidUTF8(sample)) {
      return;
    }

    // 4. 检查是否为 ASCII
    if (isValidASCII(sample)) {
      return;
    }

    throw new ToolError(
      FileOperationErrorCode.INVALID_ENCODING,
      `File is not valid text: ${filePath}`,
      { path: filePath }
    );
  } finally {
    await fd.close();
  }
}

/**
 * 检测是否有 BOM
 */
function hasBOM(buffer: Buffer): boolean {
  // UTF-8 BOM: EF BB BF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return true;
  }
  // UTF-16 LE BOM: FF FE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return true;
  }
  // UTF-16 BE BOM: FE FF
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return true;
  }
  return false;
}

/**
 * 检查是否为有效的 UTF-8
 */
function isValidUTF8(buffer: Buffer): boolean {
  try {
    buffer.toString('utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查是否为有效的 ASCII（只包含 0-127 字节）
 */
function isValidASCII(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] > 127) {
      return false;
    }
  }
  return true;
}

/**
 * 获取项目根目录
 */
export function getProjectRoot(): string {
  return normalizedProjectRoot;
}

/**
 * 确保父目录存在，如果不存在则自动创建
 * 项目目录内默认可创建，项目外需要授权
 * @param filePath 文件路径
 * @param requireAuth 是否需要用户授权（用于项目外目录创建）
 * @throws ToolError 项目外目录创建且未授权时抛出错误
 */
export async function ensureDirectoryExists(
  filePath: string,
  requireAuth: boolean = false
): Promise<void> {
  const parentDir = path.dirname(filePath);
  try {
    await access(parentDir);
  } catch {
    // 目录不存在，需要创建
    // 检查路径是否在项目目录内
    if (!isPathWithinProject(parentDir)) {
      if (!requireAuth) {
        throw new ToolError(
          FileOperationErrorCode.PATH_ACCESS_DENIED,
          `无法创建目录，因为目标路径超出了项目允许的范围，操作被拒绝。如需在项目外创建目录，请先获取用户授权。`,
          { path: parentDir, projectRoot: normalizedProjectRoot }
        );
      }
      // 已授权，允许在项目外创建
    }
    // 递归创建目录
    await mkdir(parentDir, { recursive: true });
  }
}

/**
 * 检查路径是否为目录
 * @param targetPath 要检查的路径
 * @returns 是否为目录
 */
export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 检查源路径是否存在（用于 Move 工具）
 * @param sourcePath 源路径
 * @returns 是否存在
 */
export async function sourcePathExists(sourcePath: string): Promise<boolean> {
  try {
    await access(sourcePath);
    return true;
  } catch {
    return false;
  }
}
