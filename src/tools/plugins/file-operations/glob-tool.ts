import { stat } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';
import fastGlob from 'fast-glob';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { getProjectRoot } from './path-validator.js';
import { ToolError, FileOperationErrorCode } from './types.js';

/**
 * Glob 工具 - 文件模式匹配
 */
@registerTool()
export class GlobTool extends BaseTool {
  readonly name = 'glob';

  readonly description =
    '根据 glob 模式查找匹配的文件。支持限制搜索深度、排除模式、结果排序和数量限制。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z.object({
    pattern: z.string().describe('glob 模式，如 "**/*.ts" 或 "src/**/*.js"'),
    cwd: z.string().optional().describe('搜索的起始目录，默认为项目根目录'),
    maxDepth: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe('最大搜索深度（1-20，默认 10）'),
    exclude: z
      .array(z.string())
      .optional()
      .describe('排除模式数组，如 ["node_modules/**", "*.test.ts"]'),
    limit: z
      .number()
      .min(1)
      .max(10000)
      .optional()
      .describe('最大结果数量（1-10000，默认 1000）'),
    sortBy: z
      .enum(['mtime', 'name'])
      .optional()
      .describe('排序方式：mtime（修改时间）或 name（文件名）'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('排序顺序：asc（升序）或 desc（降序，默认）'),
  });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      pattern,
      cwd,
      maxDepth = 10,
      exclude = [],
      limit = 1000,
      sortBy = 'mtime',
      order = 'desc',
    } = params as {
      pattern: string;
      cwd?: string;
      maxDepth?: number;
      exclude?: string[];
      limit?: number;
      sortBy?: 'mtime' | 'name';
      order?: 'asc' | 'desc';
    };

    // 输出操作通知
    console.log(`  ${chalk.gray('📁 glob:')} ${chalk.dim(pattern)}`);

    // 1. 确定搜索目录
    const projectRoot = getProjectRoot();
    const searchCwd = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

    // 2. 验证搜索目录在项目内
    if (!this.isPathWithinProject(searchCwd, projectRoot)) {
      throw new ToolError(
        FileOperationErrorCode.PATH_ACCESS_DENIED,
        `Access denied: ${cwd || '.'} is outside project directory`,
        { path: cwd || '.', projectRoot }
      );
    }

    // 3. 构建 fast-glob 选项
    const globOptions: fastGlob.Options = {
      cwd: searchCwd,
      dot: true,
      followSymbolicLinks: true,
      deep: maxDepth,
      ignore: exclude,
      absolute: true,
      onlyFiles: true,
      markDirectories: false,
    };

    // 4. 执行 glob 搜索
    let results: string[];
    try {
      results = await fastGlob(pattern, globOptions);
    } catch {
      throw new ToolError(
        FileOperationErrorCode.INVALID_GLOB_PATTERN,
        `Invalid glob pattern: ${pattern}`,
        { pattern }
      );
    }

    // 5. 过滤结果（确保所有结果都在项目目录内）
    results = results.filter((filePath) =>
      this.isPathWithinProject(filePath, projectRoot)
    );

    // 6. 排序
    results = await this.sortResults(results, sortBy, order);

    // 7. 限制结果数量
    results = results.slice(0, limit);

    // 8. 返回格式化的结果
    if (results.length === 0) {
      return 'No files found matching the pattern.';
    }

    return results.join('\n');
  }

  /**
   * 检查路径是否在项目目录内
   */
  private isPathWithinProject(
    targetPath: string,
    projectRoot: string
  ): boolean {
    const normalizedTarget = path.normalize(targetPath);
    const normalizedRoot = path.normalize(projectRoot);

    const targetWithSep = normalizedTarget.endsWith(path.sep)
      ? normalizedTarget
      : normalizedTarget + path.sep;
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;

    return (
      targetWithSep.startsWith(rootWithSep) ||
      normalizedTarget === normalizedRoot
    );
  }

  /**
   * 对结果进行排序
   */
  private async sortResults(
    results: string[],
    sortBy: 'mtime' | 'name',
    order: 'asc' | 'desc'
  ): Promise<string[]> {
    if (sortBy === 'mtime') {
      // 按修改时间排序
      const withStats = await Promise.all(
        results.map(async (filePath) => {
          try {
            const stats = await stat(filePath);
            return { path: filePath, mtime: stats.mtime.getTime() };
          } catch {
            return { path: filePath, mtime: 0 };
          }
        })
      );

      withStats.sort((a, b) => {
        return order === 'desc' ? b.mtime - a.mtime : a.mtime - b.mtime;
      });

      return withStats.map((item) => item.path);
    } else {
      // 按文件名排序
      results.sort((a, b) => {
        const nameA = path.basename(a);
        const nameB = path.basename(b);
        return order === 'desc'
          ? nameB.localeCompare(nameA)
          : nameA.localeCompare(nameB);
      });
      return results;
    }
  }
}
