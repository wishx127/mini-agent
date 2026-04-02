/* eslint-disable camelcase */
import { rename, access } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import {
  ensureDirectoryExists,
  isDirectory,
  getProjectRoot,
  isPathWithinProject,
} from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';
import { getAuthManager, buildAuthKey } from './auth.js';

/**
 * Move 工具 - 移动/重命名文件
 */
@registerTool()
export class MoveTool extends BaseTool {
  readonly name = 'move';

  readonly description =
    '移动或重命名文件。支持跨目录移动、重命名，自动创建目标父目录，默认不覆盖已存在文件。重要：如果目标路径在项目目录外，系统会自动询问用户授权，你绝对不能自行设置require_auth参数，必须等待用户确认。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    source_path: z.string().describe('源文件路径'),
    target_path: z.string().describe('目标路径（可以是目录或完整文件路径）'),
    overwrite: z
      .boolean()
      .optional()
      .describe('如果目标已存在是否覆盖，默认false'),
    require_auth: z
      .boolean()
      .optional()
      .describe('【系统设置，勿手动设置】是否已获取用户授权'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      source_path,
      target_path,
      overwrite = false,
      require_auth = false,
    } = params as {
      source_path: string;
      target_path: string;
      overwrite?: boolean;
      require_auth?: boolean;
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(
      `  ${chalk.gray('📦 move:')} ${chalk.dim(source_path)} ${chalk.gray('→')} ${chalk.dim(target_path)}`
    );

    // 1. 解析源路径
    // 如果用户输入的是绝对路径，直接使用；否则相对于项目根目录解析
    const sourceResolved = path.isAbsolute(source_path)
      ? source_path
      : path.resolve(getProjectRoot(), source_path);
    const sourceExists = await this.checkPathExists(sourceResolved);
    if (!sourceExists) {
      throw new ToolError(
        FileOperationErrorCode.SOURCE_NOT_FOUND,
        `Source file not found: ${source_path}`,
        { sourcePath: source_path }
      );
    }

    // 2. 验证源路径在项目目录内
    if (!isPathWithinProject(sourceResolved)) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `Source path is outside project directory: ${source_path}`,
        {
          operation: '移动文件',
          path: source_path,
          projectRoot: getProjectRoot(),
        }
      );
    }

    // 3. 检查源路径是否为目录
    if (await isDirectory(sourceResolved)) {
      throw new ToolError(
        FileOperationErrorCode.IS_DIRECTORY,
        `Source path is a directory: ${source_path}. Only files can be moved.`,
        { sourcePath: source_path }
      );
    }

    // 4. 确定最终目标路径
    // 如果用户输入的是绝对路径，直接使用；否则相对于项目根目录解析
    let finalTargetPath = path.isAbsolute(target_path)
      ? target_path
      : path.resolve(getProjectRoot(), target_path);
    const targetIsDirectory = await isDirectory(finalTargetPath);

    if (targetIsDirectory) {
      // 目标是目录，将文件移动到该目录下，保持原文件名
      const sourceFileName = path.basename(source_path);
      finalTargetPath = path.join(finalTargetPath, sourceFileName);
    }

    // 5. 检查是否需要用户授权（项目内外都需要授权）
    const authManager = getAuthManager();
    const authKey = buildAuthKey('move', {
      sourcePath: sourceResolved,
      targetPath: finalTargetPath,
    });
    let userGranted = false;
    if (authManager) {
      const isAuthorized = authManager.isAuthorized(authKey);

      if (!isAuthorized) {
        const granted = await authManager.askForAuth('move', {
          sourcePath: sourceResolved,
          targetPath: finalTargetPath,
        });

        if (!granted) {
          throw new ToolError(
            FileOperationErrorCode.UNAUTHORIZED_OPERATION,
            `用户拒绝了移动操作授权: ${source_path} → ${target_path}`,
            { sourcePath: source_path, targetPath: target_path }
          );
        }
        userGranted = true;
      } else {
        userGranted = true;
      }
    }

    // 6. 检查目标路径是否在项目目录内（项目外需要用户授权或require_auth标记）
    if (
      !isPathWithinProject(finalTargetPath) &&
      !require_auth &&
      !userGranted
    ) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `无法移动文件，因为目标路径超出了项目允许的范围，操作被拒绝。如需移动到项目外，请先获取用户授权。`,
        {
          operation: '移动文件',
          path: target_path,
          projectRoot: getProjectRoot(),
        }
      );
    }

    // 7. 检查目标文件是否已存在
    const targetExists = await this.checkPathExists(finalTargetPath);
    if (targetExists && !overwrite) {
      throw new ToolError(
        FileOperationErrorCode.FILE_ALREADY_EXISTS,
        `Target file already exists: ${target_path}`,
        { targetPath: target_path }
      );
    }

    // 8. 确保目标父目录存在（项目内默认可创建，项目外需要授权）
    await ensureDirectoryExists(finalTargetPath, require_auth);

    // 9. 执行移动
    try {
      await rename(sourceResolved, finalTargetPath);
    } catch (error) {
      throw new ToolError(
        FileOperationErrorCode.MOVE_ERROR,
        `Failed to move file: ${source_path} → ${target_path}`,
        {
          sourcePath: source_path,
          targetPath: target_path,
          error: String(error),
        }
      );
    }

    return `📦 移动文件操作完成\n文件已移动: ${source_path} → ${target_path}`;
  }

  /**
   * 检查路径是否存在
   */
  private async checkPathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
