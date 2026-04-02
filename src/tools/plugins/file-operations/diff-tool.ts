/**
 * Diff 工具 - 文件和字符串差异比较
 */

import { readFile, stat, readdir, open } from 'fs/promises';
import path from 'path';

import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { FileOperationErrorCode } from './types.js';
import {
  readFileWithEncoding,
  validateFileSizeBytes,
  isBinaryContent,
  EditResult,
} from './edit-utils.js';

/**
 * 分块读取选项
 */
export interface ChunkedReadOptions {
  chunkSize?: number;
  maxChunks?: number;
}

/**
 * 大文件分块信息
 */
export interface ChunkedFileInfo {
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  isChunked: boolean;
}

/**
 * Diff 选项
 */
export interface DiffOptions {
  contextLines?: number;
  maxFileSize?: number | null;
  encoding?: string;
  recursive?: boolean;
  exclude?: string[];
  ignoreLineEndings?: boolean;
}

/**
 * Diff 结果
 */
export interface DiffResult extends EditResult {
  diff?: string;
  addedLines?: number;
  removedLines?: number;
  hunks?: number;
  filesCompared?: number;
  filesAdded?: number;
  filesRemoved?: number;
  filesModified?: number;
}

/**
 * 字符串 Diff 选项
 */
export interface DiffStringsOptions {
  contextLines?: number;
  ignoreLineEndings?: boolean;
}

/**
 * 默认 Diff 选项
 */
const DEFAULT_DIFF_OPTIONS: Required<DiffOptions> = {
  contextLines: 3,
  maxFileSize: 1024 * 1024, // 1MB
  encoding: 'utf8',
  recursive: true,
  exclude: [],
  ignoreLineEndings: false,
};

/**
 * 比较两个文件并生成差异
 * @param fileA 第一个文件路径
 * @param fileB 第二个文件路径
 * @param options Diff 选项
 * @returns Diff 结果
 */
export async function diffFiles(
  fileA: string,
  fileB: string,
  options: DiffOptions = {}
): Promise<DiffResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_DIFF_OPTIONS, ...options };

  try {
    // 检查路径是否为目录
    const [statA, statB] = await Promise.all([
      stat(fileA).catch(() => null),
      stat(fileB).catch(() => null),
    ]);

    // 如果两个都是目录，进行目录比较
    if (statA?.isDirectory() && statB?.isDirectory()) {
      return diffDirectories(fileA, fileB, opts, startTime);
    }

    // 如果一个是目录一个不是，返回错误
    if (statA?.isDirectory() || statB?.isDirectory()) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PATH_NOT_DIRECTORY,
          message: 'Both paths must be directories or both must be files',
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 文件比较
    return diffTwoFiles(fileA, fileB, opts, startTime);
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Diff operation failed: ${(error as Error).message}`,
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * 比较两个文件
 */
async function diffTwoFiles(
  fileA: string,
  fileB: string,
  opts: Required<DiffOptions>,
  startTime: number
): Promise<DiffResult> {
  // 检查文件存在性
  const [contentA, contentB] = await Promise.all([
    readFileWithEncoding(fileA, opts.encoding),
    readFileWithEncoding(fileB, opts.encoding),
  ]);

  if (!contentA.success) {
    return {
      success: false,
      error: contentA.error,
      executionTime: Date.now() - startTime,
    };
  }

  if (!contentB.success) {
    return {
      success: false,
      error: contentB.error,
      executionTime: Date.now() - startTime,
    };
  }

  // 检查文件大小
  if (opts.maxFileSize !== null) {
    const [sizeCheckA, sizeCheckB] = await Promise.all([
      validateFileSizeBytes(fileA, opts.maxFileSize),
      validateFileSizeBytes(fileB, opts.maxFileSize),
    ]);

    if (!sizeCheckA.success) {
      return {
        success: false,
        error: sizeCheckA.error,
        executionTime: Date.now() - startTime,
      };
    }

    if (!sizeCheckB.success) {
      return {
        success: false,
        error: sizeCheckB.error,
        executionTime: Date.now() - startTime,
      };
    }
  }

  // 检查二进制文件
  const [bufferA, bufferB] = await Promise.all([
    readFile(fileA).catch(() => Buffer.alloc(0)),
    readFile(fileB).catch(() => Buffer.alloc(0)),
  ]);

  if (isBinaryContent(bufferA) || isBinaryContent(bufferB)) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.VALIDATION_ERROR,
        message: 'Binary files are not supported for diff',
      },
      executionTime: Date.now() - startTime,
    };
  }

  // 执行 diff
  return performDiff(
    contentA.content!,
    contentB.content!,
    fileA,
    fileB,
    opts,
    startTime
  );
}

/**
 * 递归比较两个目录
 */
async function diffDirectories(
  dirA: string,
  dirB: string,
  opts: Required<DiffOptions>,
  startTime: number
): Promise<DiffResult> {
  const diffs: string[] = [];
  let filesCompared = 0;
  let filesAdded = 0;
  let filesRemoved = 0;
  let filesModified = 0;
  let totalAddedLines = 0;
  let totalRemovedLines = 0;
  let totalHunks = 0;

  // 获取两个目录的文件列表
  const [filesA, filesB] = await Promise.all([
    getDirectoryFiles(dirA, opts.recursive, opts.exclude),
    getDirectoryFiles(dirB, opts.recursive, opts.exclude),
  ]);

  // 比较文件
  const allFiles = new Set([...Object.keys(filesA), ...Object.keys(filesB)]);

  for (const relativePath of allFiles) {
    const fullPathA = filesA[relativePath];
    const fullPathB = filesB[relativePath];

    if (!fullPathA) {
      // 文件在 B 中新增
      filesAdded++;
      const contentB = await readFileWithEncoding(fullPathB, opts.encoding);
      if (contentB.success && contentB.content) {
        const lines = contentB.content.split('\n');
        totalAddedLines += lines.length;
        diffs.push(`diff --git a/${relativePath} b/${relativePath}`);
        diffs.push(`new file mode 100644`);
        diffs.push(`--- /dev/null`);
        diffs.push(`+++ b/${relativePath}`);
        diffs.push(`@@ -0,0 +1,${lines.length} @@`);
        for (const line of lines) {
          diffs.push(`+${line}`);
        }
        diffs.push('');
      }
    } else if (!fullPathB) {
      // 文件在 A 中被删除
      filesRemoved++;
      const contentA = await readFileWithEncoding(fullPathA, opts.encoding);
      if (contentA.success && contentA.content) {
        const lines = contentA.content.split('\n');
        totalRemovedLines += lines.length;
        diffs.push(`diff --git a/${relativePath} b/${relativePath}`);
        diffs.push(`deleted file mode 100644`);
        diffs.push(`--- a/${relativePath}`);
        diffs.push(`+++ /dev/null`);
        diffs.push(`@@ -1,${lines.length} +0,0 @@`);
        for (const line of lines) {
          diffs.push(`-${line}`);
        }
        diffs.push('');
      }
    } else {
      // 文件存在，比较内容
      filesCompared++;
      const result = await diffTwoFiles(fullPathA, fullPathB, opts, startTime);

      if (result.success && result.diff && result.diff.trim()) {
        filesModified++;
        totalAddedLines += result.addedLines || 0;
        totalRemovedLines += result.removedLines || 0;
        totalHunks += result.hunks || 0;
        diffs.push(`diff --git a/${relativePath} b/${relativePath}`);
        diffs.push(result.diff);
      }
    }
  }

  return {
    success: true,
    diff: diffs.join('\n'),
    addedLines: totalAddedLines,
    removedLines: totalRemovedLines,
    hunks: totalHunks,
    filesCompared,
    filesAdded,
    filesRemoved,
    filesModified,
    executionTime: Date.now() - startTime,
  };
}

/**
 * 获取目录中的所有文件
 */
async function getDirectoryFiles(
  dir: string,
  recursive: boolean,
  exclude: string[]
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function scan(currentDir: string, relativePrefix: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativePrefix
        ? `${relativePrefix}/${entry.name}`
        : entry.name;

      // 检查排除模式
      if (shouldExclude(entry.name, exclude)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          await scan(fullPath, relativePath);
        }
      } else {
        files[relativePath] = fullPath;
      }
    }
  }

  await scan(dir, '');
  return files;
}

/**
 * 检查是否应该排除
 */
function shouldExclude(name: string, exclude: string[]): boolean {
  for (const pattern of exclude) {
    // 简单的通配符匹配
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(name)) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * 比较两个字符串
 * @param strA 第一个字符串
 * @param strB 第二个字符串
 * @param options Diff 选项
 * @returns Diff 结果
 */
export function diffStrings(
  strA: string,
  strB: string,
  options: DiffStringsOptions = {}
): DiffResult {
  const startTime = Date.now();
  const opts = {
    contextLines: options.contextLines ?? 3,
    ignoreLineEndings: options.ignoreLineEndings ?? false,
  };

  return performDiff(
    strA,
    strB,
    'stringA',
    'stringB',
    {
      ...DEFAULT_DIFF_OPTIONS,
      ...opts,
    },
    startTime
  );
}

/**
 * 执行实际的 diff 操作
 */
function performDiff(
  contentA: string,
  contentB: string,
  labelA: string,
  labelB: string,
  opts: Required<DiffOptions>,
  startTime: number
): DiffResult {
  // 处理换行符
  let normalizedA = contentA;
  let normalizedB = contentB;

  if (opts.ignoreLineEndings) {
    normalizedA = contentA.replace(/\r\n/g, '\n');
    normalizedB = contentB.replace(/\r\n/g, '\n');
  }

  // 生成统一差异格式
  const patch = createTwoFilesPatch(
    labelA,
    labelB,
    normalizedA,
    normalizedB,
    '',
    '',
    { context: opts.contextLines }
  );

  // 统计行数变化
  const lines = patch.split('\n');
  let addedLines = 0;
  let removedLines = 0;
  let hunks = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      hunks++;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines++;
    }
  }

  return {
    success: true,
    diff: patch,
    addedLines,
    removedLines,
    hunks,
    executionTime: Date.now() - startTime,
  };
}

/**
 * 默认分块读取配置
 */
const DEFAULT_CHUNKED_OPTIONS: Required<ChunkedReadOptions> = {
  chunkSize: 1024 * 1024, // 1MB 每块
  maxChunks: 100, // 最多读取 100 块（100MB）
};

/**
 * 获取文件分块信息
 * @param filePath 文件路径
 * @param options 分块选项
 * @returns 分块信息
 */
export async function getChunkedFileInfo(
  filePath: string,
  options: ChunkedReadOptions = {}
): Promise<ChunkedFileInfo> {
  const opts = { ...DEFAULT_CHUNKED_OPTIONS, ...options };
  const stats = await stat(filePath);
  const totalSize = stats.size;

  const totalChunks = Math.ceil(totalSize / opts.chunkSize);
  const isChunked = totalChunks > 1;

  return {
    totalSize,
    chunkSize: opts.chunkSize,
    totalChunks: Math.min(totalChunks, opts.maxChunks),
    isChunked,
  };
}

/**
 * 分块读取文件内容
 * @param filePath 文件路径
 * @param options 分块选项
 * @returns 文件内容（如果文件过大，只返回前 maxChunks 块）
 */
export async function readFileInChunks(
  filePath: string,
  options: ChunkedReadOptions = {}
): Promise<{
  success: boolean;
  content?: string;
  isPartial?: boolean;
  chunksRead?: number;
  totalChunks?: number;
  error?: { code: string; message: string };
}> {
  const opts = { ...DEFAULT_CHUNKED_OPTIONS, ...options };

  try {
    const fileHandle = await open(filePath, 'r');

    try {
      const stats = await fileHandle.stat();
      const totalSize = stats.size;
      const totalChunks = Math.ceil(totalSize / opts.chunkSize);

      // 如果文件不大，直接读取
      if (totalChunks <= 1) {
        const buffer = await readFile(filePath);
        return {
          success: true,
          content: buffer.toString('utf8'),
          isPartial: false,
          chunksRead: 1,
          totalChunks: 1,
        };
      }

      // 分块读取
      const chunksToRead = Math.min(totalChunks, opts.maxChunks);
      const buffers: Buffer[] = [];

      for (let i = 0; i < chunksToRead; i++) {
        const offset = i * opts.chunkSize;
        const remainingBytes = totalSize - offset;
        const bytesToRead = Math.min(opts.chunkSize, remainingBytes);

        const buffer = Buffer.alloc(bytesToRead);
        await fileHandle.read(buffer, 0, bytesToRead, offset);
        buffers.push(buffer);
      }

      const combinedBuffer = Buffer.concat(buffers);
      const isPartial = chunksToRead < totalChunks;

      return {
        success: true,
        content: combinedBuffer.toString('utf8'),
        isPartial,
        chunksRead: chunksToRead,
        totalChunks,
      };
    } finally {
      await fileHandle.close();
    }
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
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Failed to read file in chunks: ${(error as Error).message}`,
      },
    };
  }
}

/**
 * 使用分块读取比较两个大文件
 * @param fileA 第一个文件路径
 * @param fileB 第二个文件路径
 * @param options 分块选项和 Diff 选项
 * @returns Diff 结果
 */
export async function diffLargeFiles(
  fileA: string,
  fileB: string,
  options: ChunkedReadOptions & DiffOptions = {}
): Promise<DiffResult> {
  const startTime = Date.now();
  const { chunkSize, maxChunks, ...diffOptions } = options;
  const chunkOpts = { chunkSize, maxChunks };
  const opts = { ...DEFAULT_DIFF_OPTIONS, ...diffOptions };

  try {
    // 并行读取两个文件
    const [resultA, resultB] = await Promise.all([
      readFileInChunks(fileA, chunkOpts),
      readFileInChunks(fileB, chunkOpts),
    ]);

    if (!resultA.success) {
      return {
        success: false,
        error: resultA.error,
        executionTime: Date.now() - startTime,
      };
    }

    if (!resultB.success) {
      return {
        success: false,
        error: resultB.error,
        executionTime: Date.now() - startTime,
      };
    }

    // 检查是否为部分读取
    const isPartial = resultA.isPartial || resultB.isPartial;

    // 执行 diff
    const diffResult = performDiff(
      resultA.content!,
      resultB.content!,
      fileA,
      fileB,
      opts,
      startTime
    );

    // 如果是部分读取，添加提示信息
    if (isPartial && diffResult.success) {
      diffResult.diff =
        `# Note: Large files were partially read for comparison\n` +
        `# File A: ${resultA.chunksRead}/${resultA.totalChunks} chunks (${resultA.chunksRead}MB+)\n` +
        `# File B: ${resultB.chunksRead}/${resultB.totalChunks} chunks (${resultB.chunksRead}MB+)\n\n` +
        diffResult.diff;
    }

    return diffResult;
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Diff operation failed: ${(error as Error).message}`,
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * Diff 工具类（用于工具注册）
 */
@registerTool()
export class DiffTool extends BaseTool {
  readonly name = 'diff';

  readonly description =
    'Compare two files or directories and generate a unified diff. Supports recursive directory comparison and file exclusion patterns.';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    pathA: z.string().describe('First file or directory path to compare'),
    pathB: z.string().describe('Second file or directory path to compare'),
    contextLines: z
      .number()
      .optional()
      .describe('Number of context lines in the diff output (default: 3)'),
    recursive: z
      .boolean()
      .optional()
      .describe('Whether to compare directories recursively (default: true)'),
    exclude: z
      .array(z.string())
      .optional()
      .describe('Array of file patterns to exclude from comparison'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { pathA, pathB, contextLines, recursive, exclude } = params as {
      pathA: string;
      pathB: string;
      contextLines?: number;
      recursive?: boolean;
      exclude?: string[];
    };

    const result = await diffFiles(pathA, pathB, {
      contextLines,
      recursive,
      exclude,
    });

    if (!result.success) {
      throw new Error(result.error?.message || 'Diff operation failed');
    }

    return JSON.stringify(result, null, 2);
  }
}
