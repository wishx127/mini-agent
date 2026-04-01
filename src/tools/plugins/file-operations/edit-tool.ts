/**
 * Edit 工具 - 文件编辑（搜索替换、行级编辑）
 */

import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { FileOperationErrorCode } from './types.js';
import {
  readFileWithEncoding,
  writeAtomically,
  calculateHash,
  preserveLineEnding,
  EditResult,
  AffectedRange,
} from './edit-utils.js';
import { setAuthManager, getAuthManager, buildAuthKey } from './auth.js';

/**
 * Edit 文件选项
 */
export interface EditFileOptions {
  search?: string;
  replace?: string;
  replaceAll?: boolean;
  matchOptions?: {
    ignoreWhitespace?: boolean;
    caseInsensitive?: boolean;
    wholeWord?: boolean;
  };
  encoding?: string;
  expectedHash?: string;
  requireAuth?: boolean;
}

/**
 * 行编辑选项
 */
export interface LineEditOptions {
  operation: 'insert' | 'delete' | 'replace';
  lineNumber: number;
  endLineNumber?: number;
  content?: string;
  encoding?: string;
  expectedHash?: string;
  requireAuth?: boolean;
}

/**
 * Edit 结果
 */
export interface EditFileResult extends EditResult {
  affectedRanges?: AffectedRange[];
}

/**
 * 默认选项
 */
const DEFAULT_EDIT_OPTIONS: Omit<
  EditFileOptions,
  'search' | 'replace' | 'matchOptions' | 'expectedHash'
> = {
  replaceAll: false,
  encoding: 'utf8',
  requireAuth: true,
};

/**
 * 编辑文件（搜索替换）
 * @param filePath 目标文件路径
 * @param options 编辑选项
 * @returns 编辑结果
 */
export async function editFile(
  filePath: string,
  options: EditFileOptions
): Promise<EditFileResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_EDIT_OPTIONS, ...options };

  try {
    // 验证必需参数
    if (!opts.search) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.VALIDATION_ERROR,
          message: 'Search pattern cannot be empty',
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 读取文件内容
    const readResult = await readFileWithEncoding(filePath, opts.encoding);

    if (!readResult.success) {
      if (readResult.error?.code === FileOperationErrorCode.PATH_NOT_FOUND) {
        return {
          success: false,
          error: {
            code: FileOperationErrorCode.PATH_NOT_FOUND,
            message: `File not found: ${filePath}`,
          },
          executionTime: Date.now() - startTime,
        };
      }
      return {
        success: false,
        error: readResult.error,
        executionTime: Date.now() - startTime,
      };
    }

    const originalContent = readResult.content!;

    // 乐观锁检查
    if (opts.expectedHash) {
      const currentHash = calculateHash(originalContent);
      if (currentHash !== opts.expectedHash) {
        return {
          success: false,
          error: {
            code: FileOperationErrorCode.CONCURRENT_MODIFICATION,
            message:
              'File has been modified concurrently. Expected hash does not match.',
            details: { expected: opts.expectedHash, actual: currentHash },
          },
          executionTime: Date.now() - startTime,
        };
      }
    }

    // 执行搜索替换
    const searchResult = performSearchReplace(
      originalContent,
      opts.search,
      opts.replace || '',
      opts.replaceAll ?? false,
      opts.matchOptions
    );

    if (!searchResult.found) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.VALIDATION_ERROR,
          message: `Search pattern not found: "${opts.search}"`,
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 用户授权检查
    if (opts.requireAuth) {
      const authManager = getAuthManager();
      const authKey = buildAuthKey('edit', { filePath });
      if (authManager) {
        const isAuthorized = authManager.isAuthorized(authKey);

        if (!isAuthorized) {
          const granted = await authManager.askForAuth('edit', {
            filePath,
            search: opts.search,
            replace: opts.replace,
            occurrences: searchResult.occurrences,
          });

          if (!granted) {
            return {
              success: false,
              error: {
                code: FileOperationErrorCode.UNAUTHORIZED_OPERATION,
                message: 'User denied authorization for edit operation',
              },
              authorized: false,
              executionTime: Date.now() - startTime,
            };
          }
        }
      }
    }

    // 保留原始换行符风格
    const finalContent = preserveLineEnding(
      originalContent,
      searchResult.content
    );

    // 原子写入
    const writeResult = await writeAtomically(
      filePath,
      finalContent,
      opts.encoding
    );

    if (!writeResult.success) {
      return {
        success: false,
        error: writeResult.error,
        executionTime: Date.now() - startTime,
      };
    }

    // 生成 diff 预览
    const { diffStrings } = await import('./diff-tool.js');
    const diffResult = diffStrings(originalContent, finalContent);

    return {
      success: true,
      changes: searchResult.occurrences,
      affectedRanges: searchResult.affectedRanges,
      diff: diffResult.diff,
      authorized: true,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Edit operation failed: ${(error as Error).message}`,
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * 执行搜索替换
 */
function performSearchReplace(
  content: string,
  search: string,
  replace: string,
  replaceAll: boolean,
  matchOptions?: EditFileOptions['matchOptions']
): {
  found: boolean;
  content: string;
  occurrences: number;
  affectedRanges: AffectedRange[];
} {
  let processedContent = content;
  let occurrences = 0;
  const affectedRanges: AffectedRange[] = [];

  // 构建搜索模式
  let searchPattern = search;

  // 处理匹配选项
  if (matchOptions?.ignoreWhitespace) {
    // 忽略空白字符 - 先转义特殊字符，再将空白替换为 \s+ 模式
    searchPattern = escapeRegExp(search).replace(/\s+/g, '\\s+');
  }

  // 使用正则表达式进行匹配
  const flags = matchOptions?.caseInsensitive ? 'gi' : 'g';

  try {
    let regex: RegExp;

    if (matchOptions?.wholeWord) {
      // 全词匹配
      const escapedSearch = escapeRegExp(searchPattern);
      regex = new RegExp(`\\b${escapedSearch}\\b`, flags);
    } else if (matchOptions?.ignoreWhitespace) {
      // 忽略空白
      regex = new RegExp(searchPattern, flags);
    } else {
      // 精确匹配
      regex = new RegExp(escapeRegExp(search), flags);
    }

    if (replaceAll) {
      // 替换所有匹配
      const matches: Array<{ index: number; length: number }> = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        matches.push({ index: match.index, length: match[0].length });
        occurrences++;
        // 防止零长度匹配导致无限循环
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      if (occurrences > 0) {
        // 从后向前替换，避免索引偏移问题
        let result = content;
        for (let i = matches.length - 1; i >= 0; i--) {
          const { index, length } = matches[i];
          result =
            result.substring(0, index) +
            replace +
            result.substring(index + length);

          // 计算受影响的行范围
          const linesBefore = content.substring(0, index).split('\n').length;
          const linesAfter = result
            .substring(0, index + replace.length)
            .split('\n').length;
          affectedRanges.push({ startLine: linesBefore, endLine: linesAfter });
        }
        processedContent = result;
      }
    } else {
      // 只替换第一个匹配
      const match = regex.exec(content);
      if (match) {
        processedContent =
          content.substring(0, match.index) +
          replace +
          content.substring(match.index + match[0].length);
        occurrences = 1;

        // 计算受影响的行范围
        const linesBefore = content
          .substring(0, match.index)
          .split('\n').length;
        const linesAfter = processedContent
          .substring(0, match.index + replace.length)
          .split('\n').length;
        affectedRanges.push({ startLine: linesBefore, endLine: linesAfter });
      }
    }
  } catch {
    // 正则表达式失败，使用简单字符串替换
    if (replaceAll) {
      const parts = content.split(search);
      occurrences = parts.length - 1;
      if (occurrences > 0) {
        processedContent = parts.join(replace);
        // 简化处理：假设影响整个文件
        affectedRanges.push({
          startLine: 1,
          endLine: processedContent.split('\n').length,
        });
      }
    } else {
      const index = content.indexOf(search);
      if (index !== -1) {
        processedContent =
          content.substring(0, index) +
          replace +
          content.substring(index + search.length);
        occurrences = 1;

        // 计算受影响的行范围
        const linesBefore = content.substring(0, index).split('\n').length;
        const linesAfter = processedContent
          .substring(0, index + replace.length)
          .split('\n').length;
        affectedRanges.push({ startLine: linesBefore, endLine: linesAfter });
      }
    }
  }

  return {
    found: occurrences > 0,
    content: processedContent,
    occurrences,
    affectedRanges,
  };
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 行级编辑
 * @param filePath 目标文件路径
 * @param options 行编辑选项
 * @returns 编辑结果
 */
export async function editLines(
  filePath: string,
  options: LineEditOptions
): Promise<EditFileResult> {
  const startTime = Date.now();

  try {
    // 读取文件内容
    const readResult = await readFileWithEncoding(
      filePath,
      options.encoding || 'utf8'
    );

    if (!readResult.success) {
      if (readResult.error?.code === FileOperationErrorCode.PATH_NOT_FOUND) {
        return {
          success: false,
          error: {
            code: FileOperationErrorCode.PATH_NOT_FOUND,
            message: `File not found: ${filePath}`,
          },
          executionTime: Date.now() - startTime,
        };
      }
      return {
        success: false,
        error: readResult.error,
        executionTime: Date.now() - startTime,
      };
    }

    const originalContent = readResult.content!;
    const lines = originalContent.split('\n');

    // 乐观锁检查
    if (options.expectedHash) {
      const currentHash = calculateHash(originalContent);
      if (currentHash !== options.expectedHash) {
        return {
          success: false,
          error: {
            code: FileOperationErrorCode.CONCURRENT_MODIFICATION,
            message:
              'File has been modified concurrently. Expected hash does not match.',
            details: { expected: options.expectedHash, actual: currentHash },
          },
          executionTime: Date.now() - startTime,
        };
      }
    }

    // 验证行号
    const lineNumber = options.lineNumber;
    const endLineNumber = options.endLineNumber || lineNumber;

    if (lineNumber < 1 || lineNumber > lines.length + 1) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.VALIDATION_ERROR,
          message: `Line number out of range: ${lineNumber} (file has ${lines.length} lines)`,
        },
        executionTime: Date.now() - startTime,
      };
    }

    if (endLineNumber < lineNumber) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.VALIDATION_ERROR,
          message: `End line number must be greater than or equal to start line number`,
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 用户授权检查
    if (options.requireAuth !== false) {
      const authManager = getAuthManager();
      if (authManager) {
        const isAuthorized = authManager.isAuthorized(`edit:${filePath}`);

        if (!isAuthorized) {
          const granted = await authManager.askForAuth('editLines', {
            filePath,
            operation: options.operation,
            lineNumber,
            endLineNumber,
          });

          if (!granted) {
            return {
              success: false,
              error: {
                code: FileOperationErrorCode.UNAUTHORIZED_OPERATION,
                message: 'User denied authorization for edit operation',
              },
              authorized: false,
              executionTime: Date.now() - startTime,
            };
          }
        }
      }
    }

    // 执行行编辑操作
    let modifiedLines: string[];
    let changes = 0;

    switch (options.operation) {
      case 'insert':
        if (!options.content || options.content.length === 0) {
          return {
            success: false,
            error: {
              code: FileOperationErrorCode.VALIDATION_ERROR,
              message: 'Content is required for insert operation',
            },
            executionTime: Date.now() - startTime,
          };
        }
        modifiedLines = [
          ...lines.slice(0, lineNumber - 1),
          ...options.content.split('\n'),
          ...lines.slice(lineNumber - 1),
        ];
        changes = options.content.split('\n').length;
        break;

      case 'delete':
        if (endLineNumber > lines.length) {
          return {
            success: false,
            error: {
              code: FileOperationErrorCode.VALIDATION_ERROR,
              message: `End line number out of range: ${endLineNumber} (file has ${lines.length} lines)`,
            },
            executionTime: Date.now() - startTime,
          };
        }
        modifiedLines = [
          ...lines.slice(0, lineNumber - 1),
          ...lines.slice(endLineNumber),
        ];
        changes = endLineNumber - lineNumber + 1;
        break;

      case 'replace':
        if (endLineNumber > lines.length) {
          return {
            success: false,
            error: {
              code: FileOperationErrorCode.VALIDATION_ERROR,
              message: `End line number out of range: ${endLineNumber} (file has ${lines.length} lines)`,
            },
            executionTime: Date.now() - startTime,
          };
        }
        modifiedLines = [
          ...lines.slice(0, lineNumber - 1),
          ...(options.content ? options.content.split('\n') : []),
          ...lines.slice(endLineNumber),
        ];
        changes = endLineNumber - lineNumber + 1;
        break;

      default: {
        const _exhaustiveCheck: never = options.operation;
        return {
          success: false,
          error: {
            code: FileOperationErrorCode.VALIDATION_ERROR,
            message: `Unknown operation: ${_exhaustiveCheck as string}`,
          },
          executionTime: Date.now() - startTime,
        };
      }
    }

    const newContent = modifiedLines.join('\n');

    // 保留原始换行符风格
    const finalContent = preserveLineEnding(originalContent, newContent);

    // 原子写入
    const writeResult = await writeAtomically(
      filePath,
      finalContent,
      options.encoding || 'utf8'
    );

    if (!writeResult.success) {
      return {
        success: false,
        error: writeResult.error,
        executionTime: Date.now() - startTime,
      };
    }

    // 生成 diff 预览
    const { diffStrings } = await import('./diff-tool.js');
    const diffResult = diffStrings(originalContent, finalContent);

    return {
      success: true,
      changes,
      affectedRanges: [{ startLine: lineNumber, endLine: endLineNumber }],
      diff: diffResult.diff,
      authorized: true,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Line edit operation failed: ${(error as Error).message}`,
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * Edit 工具类（用于工具注册）
 */
@registerTool()
export class EditTool extends BaseTool {
  readonly name = 'edit';

  readonly description =
    '【修改现有文件首选】通过搜索替换或行级操作编辑文件内容。用于修改已存在文件的部分内容，支持文本搜索替换（search/replace）和行级操作（insert/delete/replace）。当需要修改现有文件时，优先使用此工具而不是 write 工具。支持模式匹配选项和乐观锁。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    filePath: z.string().describe('Path to the file to edit'),
    search: z
      .string()
      .optional()
      .describe('Search pattern for text replacement'),
    replace: z.string().optional().describe('Replacement text'),
    replaceAll: z
      .boolean()
      .optional()
      .describe('Replace all occurrences (default: false)'),
    lineNumber: z
      .number()
      .optional()
      .describe('Line number for line-based operations'),
    operation: z
      .enum(['insert', 'delete', 'replace'])
      .optional()
      .describe('Line operation type'),
    content: z
      .string()
      .optional()
      .describe('Content for insert/replace operations'),
    expectedHash: z
      .string()
      .optional()
      .describe('Expected SHA-256 hash for optimistic locking'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      filePath,
      search,
      replace,
      replaceAll,
      lineNumber,
      operation,
      content,
      expectedHash,
    } = params as {
      filePath: string;
      search?: string;
      replace?: string;
      replaceAll?: boolean;
      lineNumber?: number;
      operation?: 'insert' | 'delete' | 'replace';
      content?: string;
      expectedHash?: string;
    };

    let result: EditFileResult;

    if (operation && lineNumber !== undefined) {
      result = await editLines(filePath, {
        operation,
        lineNumber,
        content,
        expectedHash,
        requireAuth: true,
      });
    } else {
      result = await editFile(filePath, {
        search,
        replace,
        replaceAll,
        expectedHash,
        requireAuth: true,
      });
    }

    if (!result.success) {
      throw new Error(result.error?.message || 'Edit operation failed');
    }

    return JSON.stringify(result, null, 2);
  }
}

export { setAuthManager, getAuthManager };
