/**
 * 文件编辑工具的基础工具函数
 * 包含哈希计算、原子写入、编码处理等功能
 */

import { createHash, randomBytes } from 'crypto';
import {
  readFile,
  writeFile,
  rename,
  unlink,
  stat,
  lstat,
  realpath,
  copyFile,
} from 'fs/promises';

import iconv from 'iconv-lite';
import chardet from 'chardet';

import { FileOperationErrorCode } from './types.js';

/**
 * 二进制文件检测阈值（非打印字符占比超过此值认为是二进制文件）
 */
const BINARY_DETECTION_THRESHOLD = 0.1; // 10%

/**
 * 受影响的行范围
 */
export interface AffectedRange {
  startLine: number;
  endLine: number;
}

/**
 * 编辑操作结果接口
 */
export interface EditResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  changes?: number;
  affectedRanges?: AffectedRange[];
  executionTime?: number;
  diff?: string;
  authorized?: boolean;
}

/**
 * 文件路径解析选项
 */
export interface ResolvePathOptions {
  followSymlinks?: boolean;
}

/**
 * 解析文件路径，处理软链接
 * @param filePath 原始文件路径
 * @param options 解析选项
 * @returns 解析后的路径信息
 */
export async function resolveFilePath(
  filePath: string,
  options: ResolvePathOptions = {}
): Promise<{
  resolvedPath: string;
  isSymlink: boolean;
  linkTarget?: string;
  exists: boolean;
}> {
  const { followSymlinks = true } = options;

  try {
    // 获取文件状态（不跟随软链接）
    const lstatResult = await lstat(filePath).catch(() => null);

    if (!lstatResult) {
      return {
        resolvedPath: filePath,
        isSymlink: false,
        exists: false,
      };
    }

    const isSymlink = lstatResult.isSymbolicLink();

    if (isSymlink) {
      // 获取软链接指向的真实路径
      const linkTarget = await realpath(filePath);

      if (followSymlinks) {
        return {
          resolvedPath: linkTarget,
          isSymlink: true,
          linkTarget,
          exists: true,
        };
      } else {
        return {
          resolvedPath: filePath,
          isSymlink: true,
          linkTarget,
          exists: true,
        };
      }
    }

    return {
      resolvedPath: filePath,
      isSymlink: false,
      exists: true,
    };
  } catch {
    return {
      resolvedPath: filePath,
      isSymlink: false,
      exists: false,
    };
  }
}

/**
 * 检查路径是否为软链接
 * @param filePath 文件路径
 * @returns 是否为软链接
 */
export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const lstatResult = await lstat(filePath);
    return lstatResult.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 获取软链接的目标路径
 * @param filePath 软链接路径
 * @returns 目标路径，如果不是软链接则返回 null
 */
export async function getSymlinkTarget(
  filePath: string
): Promise<string | null> {
  try {
    const target = await realpath(filePath);
    const isLink = await isSymlink(filePath);
    return isLink ? target : null;
  } catch {
    return null;
  }
}

/**
 * 计算文件内容的 SHA-256 哈希值
 * @param content 文件内容
 * @returns SHA-256 哈希值
 */
export function calculateHash(content: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(
    typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  );
  return hash.digest('hex');
}

/**
 * 获取文件的 SHA-256 哈希值
 * @param filePath 文件路径
 * @param _encoding 文件编码（保留参数以兼容接口）
 * @returns 哈希值结果
 */
export async function getFileHash(
  filePath: string,
  _encoding: string = 'utf8'
): Promise<{
  success: boolean;
  hash?: string;
  error?: { code: string; message: string };
}> {
  try {
    const content = await readFile(filePath);
    const hash = calculateHash(content);

    return {
      success: true,
      hash,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PATH_NOT_FOUND,
          message: `File not found: ${filePath}`,
        },
      };
    }
    if (
      (error as NodeJS.ErrnoException).code === 'EACCES' ||
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PERMISSION_DENIED,
          message: `Permission denied: ${filePath}`,
        },
      };
    }
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Failed to read file for hash calculation: ${(error as Error).message}`,
      },
    };
  }
}

/**
 * 原子写入文件（临时文件 + 重命名）
 * @param filePath 目标文件路径
 * @param content 文件内容
 * @param encoding 文件编码
 * @returns 写入结果
 */
export async function writeAtomically(
  filePath: string,
  content: string | Buffer,
  encoding: string = 'utf8'
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  // 生成临时文件名
  const tempSuffix = randomBytes(8).toString('hex');
  const tempPath = `${filePath}.tmp.${tempSuffix}`;

  try {
    // 写入临时文件
    const contentBuffer =
      typeof content === 'string' ? iconv.encode(content, encoding) : content;

    await writeFile(tempPath, contentBuffer);
  } catch (error) {
    // 清理临时文件
    try {
      await unlink(tempPath);
    } catch {
      // 忽略清理错误
    }

    return {
      success: false,
      error: {
        code: FileOperationErrorCode.WRITE_TEMP_FAILED,
        message: `Failed to write temporary file: ${(error as Error).message}`,
      },
    };
  }

  try {
    // 原子重命名
    await rename(tempPath, filePath);
    return { success: true };
  } catch (error) {
    // 在 Windows 上，rename 可能因权限或文件占用而失败
    // 尝试使用 copyFile + unlink 作为回退方案
    if (process.platform === 'win32') {
      try {
        // 先尝试删除目标文件（如果存在）
        try {
          await unlink(filePath);
        } catch {
          // 目标文件可能不存在，忽略错误
        }
        // 复制临时文件到目标位置
        await copyFile(tempPath, filePath);
        // 删除临时文件
        await unlink(tempPath);
        return { success: true };
      } catch (copyError) {
        // 清理临时文件
        try {
          await unlink(tempPath);
        } catch {
          // 忽略清理错误
        }

        return {
          success: false,
          error: {
            code: FileOperationErrorCode.RENAME_FAILED,
            message: `Failed to rename temporary file on Windows: ${(copyError as Error).message}`,
          },
        };
      }
    }

    // 清理临时文件
    try {
      await unlink(tempPath);
    } catch {
      // 忽略清理错误
    }

    return {
      success: false,
      error: {
        code: FileOperationErrorCode.RENAME_FAILED,
        message: `Failed to rename temporary file: ${(error as Error).message}`,
      },
    };
  }
}

/**
 * 检测文件编码
 * @param filePath 文件路径
 * @returns 检测到的编码
 */
export async function detectFileEncoding(filePath: string): Promise<string> {
  try {
    const detected = await chardet.detectFile(filePath);
    return detected || 'utf8';
  } catch {
    return 'utf8';
  }
}

/**
 * 读取文件内容（支持编码转换）
 * @param filePath 文件路径
 * @param encoding 文件编码（'auto' 表示自动检测）
 * @returns 文件内容
 */
export async function readFileWithEncoding(
  filePath: string,
  encoding: string = 'utf8'
): Promise<{
  success: boolean;
  content?: string;
  error?: { code: string; message: string };
}> {
  try {
    const buffer = await readFile(filePath);

    let actualEncoding = encoding;
    if (encoding === 'auto') {
      actualEncoding = await detectFileEncoding(filePath);
    }

    // 检测 BOM
    let bomLength = 0;
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      bomLength = 3; // UTF-8 BOM
    } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      bomLength = 2; // UTF-16 LE BOM
      actualEncoding = 'utf16le';
    } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      bomLength = 2; // UTF-16 BE BOM
      actualEncoding = 'utf16be';
    }

    const contentBuffer = buffer.subarray(bomLength);
    const content = iconv.decode(contentBuffer, actualEncoding);

    return { success: true, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PATH_NOT_FOUND,
          message: `File not found: ${filePath}`,
        },
      };
    }
    if (
      (error as NodeJS.ErrnoException).code === 'EACCES' ||
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PERMISSION_DENIED,
          message: `Permission denied: ${filePath}`,
        },
      };
    }
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Failed to read file: ${(error as Error).message}`,
      },
    };
  }
}

/**
 * 检测换行符类型
 * @param content 文件内容
 * @returns 换行符类型
 */
export function detectLineEnding(
  content: string
): 'crlf' | 'lf' | 'mixed' | 'none' {
  const hasCRLF = content.includes('\r\n');
  const hasLF = content.includes('\n') && !content.includes('\r\n');

  if (hasCRLF && hasLF) return 'mixed';
  if (hasCRLF) return 'crlf';
  if (hasLF) return 'lf';
  return 'none';
}

/**
 * 规范化换行符
 * @param content 文件内容
 * @param lineEnding 目标换行符类型
 * @returns 规范化后的内容
 */
export function normalizeLineEnding(
  content: string,
  lineEnding: 'crlf' | 'lf' = 'lf'
): string {
  if (lineEnding === 'crlf') {
    return content.replace(/\r?\n/g, '\r\n');
  }
  return content.replace(/\r\n/g, '\n');
}

/**
 * 保留原始换行符风格
 * @param originalContent 原始内容
 * @param newContent 新内容
 * @returns 使用原始换行符风格的新内容
 */
export function preserveLineEnding(
  originalContent: string,
  newContent: string
): string {
  const lineEnding = detectLineEnding(originalContent);

  if (lineEnding === 'crlf' || lineEnding === 'mixed') {
    return normalizeLineEnding(newContent, 'crlf');
  }
  return normalizeLineEnding(newContent, 'lf');
}

/**
 * 验证文件大小
 * @param filePath 文件路径
 * @param maxSizeBytes 最大大小（字节）
 * @returns 验证结果
 */
export async function validateFileSizeBytes(
  filePath: string,
  maxSizeBytes: number | null
): Promise<{ success: boolean; error?: { code: string; message: string } }> {
  if (maxSizeBytes === null) {
    return { success: true };
  }

  try {
    const stats = await stat(filePath);
    if (stats.size > maxSizeBytes) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.FILE_TOO_LARGE,
          message: `File too large: ${filePath} (size: ${stats.size} bytes, max: ${maxSizeBytes} bytes)`,
        },
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Failed to check file size: ${(error as Error).message}`,
      },
    };
  }
}

/**
 * 检测是否为二进制文件
 * @param content 文件内容
 * @returns 是否为二进制文件
 */
export function isBinaryContent(content: Buffer): boolean {
  // 检查 null 字节
  if (content.includes(0)) {
    return true;
  }

  // 检查是否包含过多的非打印字符
  const sampleSize = Math.min(content.length, 1024);
  let nonPrintableCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = content[i];
    // 允许的控制字符：tab (9), LF (10), CR (13)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintableCount++;
    }
  }

  // 如果超过阈值的字符是非打印字符，认为是二进制文件
  return nonPrintableCount / sampleSize > BINARY_DETECTION_THRESHOLD;
}
