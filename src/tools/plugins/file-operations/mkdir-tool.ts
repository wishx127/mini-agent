/* eslint-disable camelcase */
import { mkdir, access } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { getProjectRoot, isPathWithinProject } from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';

/**
 * Mkdir 工具 - 创建新目录
 */
@registerTool()
export class MkdirTool extends BaseTool {
  readonly name = 'mkdir';

  readonly description =
    '创建新目录。支持自动创建父目录，默认不覆盖已存在目录。注意：使用相对路径（如"folder/name"）表示在项目根目录下创建。重要：如果目标路径在项目目录外，系统会自动询问用户授权，你绝对不能自行设置require_auth参数，必须等待用户确认。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    dir_path: z.string().describe('要创建的目录路径'),
    recursive: z.boolean().optional().describe('是否递归创建父目录，默认true'),
    require_auth: z
      .boolean()
      .optional()
      .describe('【系统自动设置，请勿手动设置】是否已获取用户授权'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      dir_path,
      recursive = true,
      require_auth = false,
    } = params as {
      dir_path: string;
      recursive?: boolean;
      require_auth?: boolean;
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📁 mkdir:')} ${chalk.dim(dir_path)}`);

    // 1. 解析完整路径
    // 如果用户输入的是绝对路径，直接使用；否则相对于项目根目录解析
    const resolvedPath = path.isAbsolute(dir_path)
      ? dir_path
      : path.resolve(getProjectRoot(), dir_path);

    // 2. 检查路径是否在项目目录内
    const isWithinProject = isPathWithinProject(resolvedPath);

    // 3. 如果路径在项目外且未授权，抛出错误
    if (!isWithinProject && !require_auth) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `无法创建目录，因为目标路径超出了项目允许的范围，操作被拒绝。如需在项目外创建目录，请先获取用户授权（设置 require_auth 为 true）。`,
        { operation: '创建目录', path: dir_path, projectRoot: getProjectRoot() }
      );
    }

    // 4. 检查目录是否已存在
    const dirExists = await this.checkDirExists(resolvedPath);
    if (dirExists) {
      throw new ToolError(
        FileOperationErrorCode.FILE_ALREADY_EXISTS,
        `Directory already exists: ${dir_path}`,
        { path: dir_path }
      );
    }

    // 5. 创建目录
    try {
      await mkdir(resolvedPath, { recursive });
    } catch (error) {
      throw new ToolError(
        FileOperationErrorCode.WRITE_ERROR,
        `Failed to create directory: ${dir_path}`,
        { path: dir_path, error: String(error) }
      );
    }

    return `📁 创建目录操作完成\n目录已创建: ${dir_path}`;
  }

  /**
   * 检查目录是否存在
   */
  private async checkDirExists(dirPath: string): Promise<boolean> {
    try {
      await access(dirPath);
      return true;
    } catch {
      return false;
    }
  }
}
