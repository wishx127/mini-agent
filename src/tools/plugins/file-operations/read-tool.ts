/* eslint-disable camelcase */
import { readFile, stat, realpath } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import {
  validateFileSize,
  validateTextFile,
  getProjectRoot,
  isPathWithinProject,
} from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';

/**
 * Read 工具 - 读取文件内容
 */
@registerTool()
export class ReadTool extends BaseTool {
  readonly name = 'read';

  readonly description =
    '读取指定文件的文本内容。支持读取指定行范围（offset/limit），自动限制文件大小（最大 1MB）。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    file_path: z
      .string()
      .describe('要读取的文件路径，可以是相对路径或绝对路径'),
    offset: z.number().optional().describe('起始行号（从 1 开始，包含该行）'),
    limit: z.number().optional().describe('最多读取的行数'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { file_path, offset, limit } = params as {
      file_path: string;
      offset?: number;
      limit?: number;
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📄 read:')} ${chalk.dim(file_path)}`);

    // 1. 解析完整路径（支持项目外路径）
    const resolvedPath = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(getProjectRoot(), file_path);

    // 2. 检查路径是否在项目范围内
    if (!isPathWithinProject(resolvedPath)) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `Cannot read file outside project directory: ${file_path}`,
        {
          operation: '读取文件',
          path: file_path,
          projectRoot: getProjectRoot(),
        }
      );
    }

    // 3. 检查文件是否存在
    try {
      await stat(resolvedPath);
    } catch {
      throw new ToolError(
        FileOperationErrorCode.PATH_NOT_FOUND,
        `File not found: ${file_path}`,
        { path: file_path }
      );
    }

    // 3. 使用 fs.realpath() 解析软链接获取真实路径
    let realPath: string;
    try {
      realPath = await realpath(resolvedPath);
    } catch {
      realPath = resolvedPath;
    }

    // 4. 验证文件大小（最大 1MB）
    await validateFileSize(realPath, 1);

    // 5. 验证是否为文本文件
    await validateTextFile(realPath);

    // 6. 读取文件内容
    const content = await readFile(realPath, 'utf-8');

    // 7. 处理行范围
    let resultContent: string;
    if (offset !== undefined || limit !== undefined) {
      resultContent = this.extractLines(content, offset, limit);
    } else {
      resultContent = content;
    }

    // 8. 添加 LLM 上下文集成 - 文件路径标识
    return this.formatWithPathHeader(realPath, resultContent);
  }

  /**
   * 格式化输出内容，添加文件路径标识头
   * @param filePath 文件路径
   * @param content 文件内容
   * @returns 带路径标识的内容
   */
  private formatWithPathHeader(filePath: string, content: string): string {
    return `[File: ${filePath}]\n\n${content}`;
  }

  /**
   * 提取指定范围的行
   * @param content 文件内容
   * @param offset 起始行号（从 1 开始）
   * @param limit 最大行数
   * @returns 提取的行内容
   */
  private extractLines(
    content: string,
    offset?: number,
    limit?: number
  ): string {
    const lines = content.split('\n');

    const startIndex = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const endIndex =
      limit !== undefined
        ? Math.min(lines.length, startIndex + limit)
        : lines.length;

    if (startIndex >= lines.length) {
      return '';
    }

    return lines.slice(startIndex, endIndex).join('\n');
  }
}
