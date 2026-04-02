/**
 * Patch 工具 - 应用统一差异格式补丁
 */

import { access } from 'fs/promises';

import { parsePatch, applyPatch as diffApplyPatch } from 'diff';
import type { StructuredPatch, StructuredPatchHunk } from 'diff';
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
} from './edit-utils.js';
import { getAuthManager, buildAuthKey } from './auth.js';

/**
 * Apply Patch 选项
 */
export interface ApplyPatchOptions {
  dryRun?: boolean;
  encoding?: string;
  expectedHash?: string;
  requireAuth?: boolean;
}

/**
 * Apply Patch 结果
 */
export interface ApplyPatchResult extends EditResult {
  hunks?: number;
  hunksValid?: number;
}

/**
 * 默认选项
 */
const DEFAULT_PATCH_OPTIONS: Required<ApplyPatchOptions> = {
  dryRun: true,
  encoding: 'utf8',
  expectedHash: '',
  requireAuth: true,
};

/**
 * 应用补丁到文件
 * @param filePath 目标文件路径
 * @param patch 统一差异格式补丁
 * @param options 选项
 * @returns 应用结果
 */
export async function applyPatch(
  filePath: string,
  patch: string,
  options: ApplyPatchOptions = {}
): Promise<ApplyPatchResult> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_PATCH_OPTIONS, ...options };

  try {
    // 1. 验证补丁格式
    const parsedPatches = parsePatch(patch);
    if (!parsedPatches || parsedPatches.length === 0) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.VALIDATION_ERROR,
          message: 'Invalid or malformed patch format',
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 2. 检查文件是否存在
    let fileExists = false;
    try {
      await access(filePath);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    // 3. 读取文件内容
    let originalContent = '';
    if (fileExists) {
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
      originalContent = readResult.content!;
    }

    // 4. 乐观锁检查
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

    // 5. 验证所有 hunk
    const validationResult = validatePatch(parsedPatches, originalContent);
    if (!validationResult.valid) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PATCH_MISMATCH,
          message:
            validationResult.message ||
            'Patch context does not match file content',
          details: validationResult.details,
        },
        hunks: validationResult.totalHunks,
        hunksValid: validationResult.validHunks,
        executionTime: Date.now() - startTime,
      };
    }

    // 6. 如果是 dryRun，直接返回成功
    if (opts.dryRun) {
      return {
        success: true,
        hunks: validationResult.totalHunks,
        hunksValid: validationResult.validHunks,
        executionTime: Date.now() - startTime,
      };
    }

    // 7. 用户授权检查
    const authManager = getAuthManager();
    const authKey = buildAuthKey('patch', { filePath });
    if (opts.requireAuth && authManager) {
      const isAuthorized = authManager.isAuthorized(authKey);

      if (!isAuthorized) {
        const granted = await authManager.askForAuth('patch', {
          filePath,
          hunks: validationResult.totalHunks,
        });

        if (!granted) {
          return {
            success: false,
            error: {
              code: FileOperationErrorCode.UNAUTHORIZED_OPERATION,
              message: 'User denied authorization for patch operation',
            },
            authorized: false,
            executionTime: Date.now() - startTime,
          };
        }
      }
    }

    // 8. 应用补丁
    const patchedContent = diffApplyPatch(originalContent, patch);

    if (patchedContent === false) {
      return {
        success: false,
        error: {
          code: FileOperationErrorCode.PATCH_MISMATCH,
          message: 'Failed to apply patch',
        },
        executionTime: Date.now() - startTime,
      };
    }

    // 9. 保留原始换行符风格
    const finalContent = preserveLineEnding(
      originalContent,
      String(patchedContent)
    );

    // 10. 原子写入
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

    // 11. 生成 diff 预览
    const { diffStrings } = await import('./diff-tool.js');
    const diffResult = diffStrings(originalContent, finalContent);

    return {
      success: true,
      hunks: validationResult.totalHunks,
      hunksValid: validationResult.validHunks,
      changes: countChanges(finalContent, originalContent),
      diff: diffResult.diff,
      authorized: true,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: FileOperationErrorCode.IO_ERROR,
        message: `Patch operation failed: ${(error as Error).message}`,
      },
      executionTime: Date.now() - startTime,
    };
  }
}

/**
 * 验证补丁
 */
function validatePatch(
  parsedPatches: StructuredPatch[],
  originalContent: string
): {
  valid: boolean;
  message?: string;
  details?: unknown;
  totalHunks: number;
  validHunks: number;
} {
  let totalHunks = 0;
  let validHunks = 0;

  const lines = originalContent.split('\n');

  for (const parsedPatch of parsedPatches) {
    if (!parsedPatch.hunks) continue;

    for (const hunk of parsedPatch.hunks) {
      totalHunks++;

      // 验证 hunk 的上下文是否匹配
      if (validateHunk(hunk, lines)) {
        validHunks++;
      } else {
        return {
          valid: false,
          message: `Hunk at line ${hunk.oldStart} does not match file content`,
          details: { hunk },
          totalHunks,
          validHunks,
        };
      }
    }
  }

  return {
    valid: validHunks === totalHunks,
    totalHunks,
    validHunks,
  };
}

/**
 * 验证单个 hunk
 * 按照统一diff格式规范验证：
 * - ' ' 上下文行：必须匹配文件内容，推进oldIndex
 * - '-' 删除行：必须匹配文件内容，推进oldIndex
 * - '+' 新增行：不推进oldIndex，仅校验补丁结构
 */
function validateHunk(hunk: StructuredPatchHunk, fileLines: string[]): boolean {
  let oldIndex = hunk.oldStart - 1; // 转换为 0-based 索引

  for (const line of hunk.lines) {
    if (line.length === 0) {
      // 空行视为上下文行
      continue;
    }

    const lineType = line[0];
    const lineContent = line.substring(1);

    switch (lineType) {
      case ' ': {
        // 上下文行：必须匹配文件内容
        if (oldIndex < 0 || oldIndex >= fileLines.length) {
          return false;
        }
        if (fileLines[oldIndex] !== lineContent) {
          return false;
        }
        oldIndex++;
        break;
      }
      case '-': {
        // 删除行：必须匹配文件内容
        if (oldIndex < 0 || oldIndex >= fileLines.length) {
          return false;
        }
        if (fileLines[oldIndex] !== lineContent) {
          return false;
        }
        oldIndex++;
        break;
      }
      case '+': {
        // 新增行：不推进oldIndex，仅校验结构（非空）
        // 新增行不需要匹配现有文件内容
        break;
      }
      case '\\': {
        // "\ No newline at end of file" 特殊标记，跳过
        break;
      }
      default: {
        // 未知行类型，视为错误
        return false;
      }
    }
  }

  return true;
}

/**
 * 计算变更数量
 */
function countChanges(newContent: string, oldContent: string): number {
  const newLines = newContent.split('\n');
  const oldLines = oldContent.split('\n');

  let changes = 0;

  // 简单的行数差异计算
  const maxLines = Math.max(newLines.length, oldLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (newLines[i] !== oldLines[i]) {
      changes++;
    }
  }

  return changes;
}

/**
 * Patch 工具类（用于工具注册）
 */
@registerTool()
export class PatchTool extends BaseTool {
  readonly name = 'patch';

  readonly description =
    '【修改现有文件】应用统一差异格式（unified diff）补丁到文件。用于通过标准补丁格式修改已存在文件的部分内容，支持 dry-run 验证模式和乐观锁。当需要精确控制文件变更或应用生成的补丁时，使用此工具而不是 write 工具。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    filePath: z.string().describe('Path to the file to patch'),
    patch: z.string().describe('Unified diff format patch to apply'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'If true, only validate the patch without applying (default: true)'
      ),
    expectedHash: z
      .string()
      .optional()
      .describe('Expected SHA-256 hash of the file for optimistic locking'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { filePath, patch, dryRun, expectedHash } = params as {
      filePath: string;
      patch: string;
      dryRun?: boolean;
      expectedHash?: string;
    };

    const result = await applyPatch(filePath, patch, {
      dryRun,
      expectedHash,
      requireAuth: true,
    });

    if (!result.success) {
      throw new Error(result.error?.message || 'Patch operation failed');
    }

    return JSON.stringify(result, null, 2);
  }
}
