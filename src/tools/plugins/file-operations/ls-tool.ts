/* eslint-disable camelcase */
import { readdir, stat } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { getProjectRoot } from './path-validator.js';
import { FileOperationErrorCode, ToolError } from './types.js';

interface LSEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  mtime: Date;
}

/**
 * LS 工具 - 列出目录内容
 */
@registerTool()
export class LSTool extends BaseTool {
  readonly name = 'ls';

  readonly description =
    '列出指定目录中的文件和子目录。支持递归遍历、按类型筛选、隐藏文件控制和排序。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    path: z.string().optional().describe('要列出的目录路径，默认为当前目录'),
    type: z
      .enum(['files', 'dirs', 'all'])
      .optional()
      .describe('筛选类型：files=仅文件, dirs=仅目录, all=全部（默认）'),
    show_hidden: z
      .boolean()
      .optional()
      .describe('是否显示隐藏文件（以.开头的文件），默认false'),
    recursive: z.boolean().optional().describe('是否递归遍历子目录，默认false'),
    max_depth: z
      .number()
      .optional()
      .describe('最大递归深度（仅在recursive=true时有效）'),
    sort_by: z
      .enum(['name', 'time'])
      .optional()
      .describe('排序方式：name=按名称, time=按修改时间'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      path: dirPath = '.',
      type = 'all',
      show_hidden = false,
      recursive = false,
      max_depth,
      sort_by,
    } = params as {
      path?: string;
      type?: 'files' | 'dirs' | 'all';
      show_hidden?: boolean;
      recursive?: boolean;
      max_depth?: number;
      sort_by?: 'name' | 'time';
    };

    // 输出操作通知（清除当前行并换行，避免与 spinner 重叠）
    process.stdout.write('\r\x1b[K\n');
    console.log(`  ${chalk.gray('📂 ls:')} ${chalk.dim(dirPath)}`);

    // 1. 解析完整路径（支持项目外路径）
    const resolvedPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.resolve(getProjectRoot(), dirPath);

    // 2. 检查路径是否存在且为目录
    let statsResult;
    try {
      statsResult = await stat(resolvedPath);
    } catch {
      throw new ToolError(
        FileOperationErrorCode.PATH_NOT_FOUND,
        `Directory not found: ${dirPath}`,
        { path: dirPath }
      );
    }

    if (!statsResult.isDirectory()) {
      throw new ToolError(
        FileOperationErrorCode.PATH_NOT_FOUND,
        `Path is not a directory: ${dirPath}`,
        { path: dirPath }
      );
    }

    // 3. 收集目录内容
    const entries = await this.collectEntries(
      resolvedPath,
      recursive,
      max_depth,
      show_hidden,
      type
    );

    // 4. 排序
    if (sort_by) {
      this.sortEntries(entries, sort_by);
    }

    // 5. 格式化输出
    const output = this.formatOutput(entries, resolvedPath);
    return `📂 目录列表操作完成\n路径: ${dirPath}\n\n${output}`;
  }

  /**
   * 递归收集目录条目
   */
  private async collectEntries(
    dirPath: string,
    recursive: boolean,
    maxDepth: number | undefined,
    showHidden: boolean,
    type: 'files' | 'dirs' | 'all',
    currentDepth: number = 0
  ): Promise<LSEntry[]> {
    const entries: LSEntry[] = [];

    // 检查深度限制
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return entries;
    }

    const items = await readdir(dirPath);

    for (const name of items) {
      // 跳过隐藏文件
      if (!showHidden && name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dirPath, name);
      const stats = await stat(fullPath);
      const isDir = stats.isDirectory();

      // 根据类型筛选
      if (type === 'files' && isDir) continue;
      if (type === 'dirs' && !isDir) continue;

      entries.push({
        name,
        path: fullPath,
        isDirectory: isDir,
        mtime: stats.mtime,
      });

      // 递归处理子目录
      if (recursive && isDir) {
        const subEntries = await this.collectEntries(
          fullPath,
          recursive,
          maxDepth,
          showHidden,
          type,
          currentDepth + 1
        );
        entries.push(...subEntries);
      }
    }

    return entries;
  }

  /**
   * 排序条目
   */
  private sortEntries(entries: LSEntry[], sortBy: 'name' | 'time'): void {
    entries.sort((a, b) => {
      if (sortBy === 'name') {
        return a.path.localeCompare(b.path);
      } else {
        return b.mtime.getTime() - a.mtime.getTime();
      }
    });
  }

  /**
   * 格式化输出
   */
  private formatOutput(entries: LSEntry[], basePath: string): string {
    if (entries.length === 0) {
      return 'Directory is empty';
    }

    const lines: string[] = [];

    for (const entry of entries) {
      const relativePath = path.relative(basePath, entry.path);
      const depth = relativePath.split(path.sep).length - 1;
      const indent = '  '.repeat(depth);
      const icon = entry.isDirectory ? '📁' : '📄';
      const displayName = entry.name;

      lines.push(`${indent}${icon} ${displayName}`);
    }

    return lines.join('\n');
  }
}
