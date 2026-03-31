/* eslint-disable camelcase */
import { writeFile, access } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import {
  ensureDirectoryExists,
  getProjectRoot,
  isPathWithinProject,
} from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';

/**
 * Write 工具 - 写入文件内容
 */
@registerTool()
export class WriteTool extends BaseTool {
  readonly name = 'write';

  readonly description =
    '写入内容到文件。支持创建新文件或覆盖现有文件，自动创建父目录，默认覆盖已存在文件。重要：如果目标路径在项目目录外，系统会自动询问用户授权，你绝对不能自行设置require_auth参数，必须等待用户确认。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    file_path: z.string().describe('要写入的文件路径'),
    content: z.string().describe('要写入的内容'),
    overwrite: z.boolean().optional().describe('是否覆盖已存在文件，默认true'),
    require_auth: z
      .boolean()
      .optional()
      .describe('【系统设置，勿手动设置】是否已获取用户授权'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      file_path,
      content,
      overwrite = true,
      require_auth = false,
    } = params as {
      file_path: string;
      content: string;
      overwrite?: boolean;
      require_auth?: boolean;
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📝 write:')} ${chalk.dim(file_path)}`);

    // 1. 解析完整路径
    // 如果用户输入的是绝对路径，直接使用；否则相对于项目根目录解析
    const resolvedPath = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(getProjectRoot(), file_path);

    // 2. 检查目标路径是否在项目范围内
    // 如果路径在项目外且未获取授权，则拒绝操作
    if (!isPathWithinProject(resolvedPath) && !require_auth) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `无法写入文件，因为目标路径超出了项目允许的范围，操作被拒绝。如需在项目外创建文件，请先获取用户授权（设置 require_auth 为 true）。`,
        {
          operation: '写入文件',
          path: file_path,
          projectRoot: getProjectRoot(),
        }
      );
    }

    // 4. 检查文件是否已存在且不允许覆盖
    const fileExists = await this.checkFileExists(resolvedPath);
    if (fileExists && !overwrite) {
      throw new ToolError(
        FileOperationErrorCode.FILE_ALREADY_EXISTS,
        `File already exists: ${file_path}`,
        { path: file_path }
      );
    }

    // 5. 确保父目录存在（项目内默认可创建，项目外需要授权）
    await ensureDirectoryExists(resolvedPath, require_auth);

    // 5. 写入文件内容
    try {
      await writeFile(resolvedPath, content, 'utf-8');
    } catch (error) {
      throw new ToolError(
        FileOperationErrorCode.WRITE_ERROR,
        `Failed to write file: ${file_path}`,
        { path: file_path, error: String(error) }
      );
    }

    return `📝 写入文件操作完成\n文件已写入: ${file_path}`;
  }

  /**
   * 检查文件是否存在
   */
  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
