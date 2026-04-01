/* eslint-disable camelcase */
import { rm, stat } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { getProjectRoot, isPathWithinProject } from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';
import { getAuthManager, buildAuthKey } from './auth.js';

/**
 * Delete 工具 - 删除文件或文件夹
 */
@registerTool()
export class DeleteTool extends BaseTool {
  readonly name = 'delete';

  readonly description =
    '【⚠️ 危险操作】删除指定文件或文件夹。支持删除文件和目录（包括非空目录）。【重要】删除操作需要用户授权，无论目标路径在项目内还是项目外。系统会自动询问用户确认，你绝对不能自行设置require_auth参数，必须等待用户确认。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    file_path: z.string().describe('要删除的文件或文件夹路径'),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe('是否递归删除目录及其内容，删除文件夹时建议设为 true'),
    require_auth: z
      .boolean()
      .optional()
      .describe('【系统设置，勿手动设置】是否已获取用户授权'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const { file_path, recursive, require_auth } = params as {
      file_path: string;
      recursive?: boolean;
      require_auth?: boolean;
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('🗑️ delete:')} ${chalk.dim(file_path)}`);

    // 1. 解析完整路径
    const resolvedPath = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(getProjectRoot(), file_path);

    // 2. 检查是否需要用户授权（项目内外都需要授权）
    const authManager = getAuthManager();
    const authKey = buildAuthKey('delete', { filePath: resolvedPath });
    let userGranted = false;
    if (authManager) {
      const isAuthorized = authManager.isAuthorized(authKey);

      if (!isAuthorized) {
        const granted = await authManager.askForAuth('delete', {
          filePath: resolvedPath,
          isDirectory: false, // 暂时设为 false，后面会重新检查
        });

        if (!granted) {
          throw new ToolError(
            FileOperationErrorCode.UNAUTHORIZED_OPERATION,
            `用户拒绝了删除操作授权: ${file_path}`,
            { path: file_path }
          );
        }
        userGranted = true;
      } else {
        userGranted = true;
      }
    }

    // 3. 检查目标路径是否在项目范围内（项目外需要用户授权或require_auth标记）
    if (!isPathWithinProject(resolvedPath) && !require_auth && !userGranted) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `无法删除文件/文件夹，因为目标路径超出了项目允许的范围，操作被拒绝。如需删除项目外的内容，请先获取用户授权。`,
        {
          operation: '删除文件/文件夹',
          path: file_path,
          projectRoot: getProjectRoot(),
        }
      );
    }

    // 3. 检查文件/目录是否存在
    let statsResult;
    try {
      statsResult = await stat(resolvedPath);
    } catch {
      throw new ToolError(
        FileOperationErrorCode.PATH_NOT_FOUND,
        `File or directory not found: ${file_path}`,
        { path: file_path }
      );
    }

    const isDirectory = statsResult.isDirectory();

    // 4. 执行删除
    try {
      await rm(resolvedPath, { recursive: isDirectory || recursive });
    } catch (error) {
      throw new ToolError(
        FileOperationErrorCode.DELETE_ERROR,
        `Failed to delete: ${file_path}`,
        { path: file_path, error: String(error) }
      );
    }

    const itemType = isDirectory ? '文件夹' : '文件';
    return `🗑️ 删除操作完成\n${itemType}已成功删除: ${file_path}\n\n重要提示: 该${itemType}已被永久删除，不再存在于文件系统中。后续操作不应再引用此${itemType}。`;
  }
}
