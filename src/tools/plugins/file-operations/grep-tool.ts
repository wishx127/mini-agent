import { readFile, stat } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';
import { z } from 'zod';
import fastGlob from 'fast-glob';

import { BaseTool, ToolCategories } from '../../base.js';
import { registerTool } from '../../registry.js';

import { validatePath, getProjectRoot } from './path-validator.js';
import { ToolError, FileOperationErrorCode } from './types.js';

/**
 * Grep 匹配结果
 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
}

/**
 * Grep 工具 - 文件内容搜索
 */
@registerTool()
export class GrepTool extends BaseTool {
  readonly name = 'grep';

  readonly description =
    '使用正则表达式搜索文件内容。支持单文件或多文件搜索，上下文显示，忽略大小写等选项。';

  readonly category = ToolCategories.FILE_SYSTEM;

  readonly paramsSchema = z
    .object({
      pattern: z.string().describe('正则表达式模式'),
      path: z
        .string()
        .optional()
        .describe('要搜索的文件路径（与 glob 二选一）'),
      glob: z
        .string()
        .optional()
        .describe('glob 模式，用于搜索多个文件（与 path 二选一）'),
      cwd: z.string().optional().describe('搜索的起始目录，默认为项目根目录'),
      contextLines: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe('显示的上下文行数（0-10，默认 0）'),
      caseInsensitive: z
        .boolean()
        .optional()
        .describe('是否忽略大小写，默认 false'),
      multiline: z
        .boolean()
        .optional()
        .describe('是否启用多行模式，默认 false'),
      maxFiles: z
        .number()
        .min(1)
        .max(10000)
        .optional()
        .describe('最大搜索文件数（1-10000，默认 1000）'),
    })
    .refine((data) => data.path || data.glob, {
      message: '必须提供 path 或 glob 参数之一',
    });

  async execute(params: Record<string, unknown>): Promise<string> {
    const {
      pattern,
      path: filePath,
      glob,
      cwd,
      contextLines = 0,
      caseInsensitive = false,
      multiline = false,
      maxFiles = 1000,
    } = params as {
      pattern: string;
      path?: string;
      glob?: string;
      cwd?: string;
      contextLines?: number;
      caseInsensitive?: boolean;
      multiline?: boolean;
      maxFiles?: number;
    };

    // 输出操作通知
    const target = filePath || glob || '.';
    console.log(
      `  ${chalk.gray('🔍 grep:')} ${chalk.dim(pattern)} ${chalk.gray('in')} ${chalk.dim(target)}`
    );

    // 1. 编译正则表达式
    const regex = this.compileRegex(pattern, caseInsensitive, multiline);

    // 2. 获取要搜索的文件列表
    const files = await this.getFilesToSearch(filePath, glob, cwd, maxFiles);

    if (files.length === 0) {
      return 'No files found to search.';
    }

    // 3. 搜索每个文件
    const allMatches: GrepMatch[] = [];
    const binarySkipped: string[] = [];

    for (const file of files) {
      try {
        const matches = await this.searchFile(file, regex, contextLines);
        allMatches.push(...matches);
      } catch (error) {
        if (
          error instanceof ToolError &&
          error.code === FileOperationErrorCode.INVALID_ENCODING
        ) {
          binarySkipped.push(file);
        }
        // 其他错误继续处理下一个文件
      }
    }

    // 4. 格式化结果
    return this.formatResults(allMatches, binarySkipped);
  }

  /**
   * 编译正则表达式
   */
  private compileRegex(
    pattern: string,
    caseInsensitive: boolean,
    multiline: boolean
  ): RegExp {
    try {
      const flags = [caseInsensitive ? 'i' : '', multiline ? 'm' : ''].join('');
      return new RegExp(pattern, flags);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      throw new ToolError(
        FileOperationErrorCode.INVALID_REGEX,
        `Invalid regex pattern: ${pattern} - ${reason}`,
        { pattern, reason }
      );
    }
  }

  /**
   * 获取要搜索的文件列表
   */
  private async getFilesToSearch(
    filePath?: string,
    globPattern?: string,
    cwd?: string,
    maxFiles: number = 1000
  ): Promise<string[]> {
    const projectRoot = getProjectRoot();

    if (filePath) {
      // 单文件模式
      const validation = await validatePath(filePath);
      if (validation.stats?.isFile()) {
        return [validation.realPath];
      }
      return [];
    }

    if (globPattern) {
      // Glob 模式
      // 确定搜索目录：优先使用传入的 cwd，否则使用项目根目录
      const searchCwd = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

      // 验证搜索目录在项目内
      if (!this.isPathWithinProject(searchCwd, projectRoot)) {
        throw new ToolError(
          FileOperationErrorCode.PATH_ACCESS_DENIED,
          `Access denied: ${cwd} is outside project directory`,
          { path: cwd, projectRoot }
        );
      }

      const globOptions: fastGlob.Options = {
        cwd: searchCwd,
        dot: true,
        followSymbolicLinks: true,
        absolute: true,
        onlyFiles: true,
        markDirectories: false,
      };

      try {
        const results = await fastGlob(globPattern, globOptions);
        // 过滤在项目目录内的文件
        return results
          .filter((f) => this.isPathWithinProject(f, projectRoot))
          .slice(0, maxFiles);
      } catch {
        throw new ToolError(
          FileOperationErrorCode.INVALID_GLOB_PATTERN,
          `Invalid glob pattern: ${globPattern}`,
          { pattern: globPattern }
        );
      }
    }

    return [];
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
   * 在单个文件中搜索
   */
  private async searchFile(
    filePath: string,
    regex: RegExp,
    contextLines: number
  ): Promise<GrepMatch[]> {
    // 验证文件大小（最大 1MB）
    const stats = await stat(filePath);
    if (stats.size > 1024 * 1024) {
      return []; // 跳过大于 1MB 的文件
    }

    // 读取文件内容
    let content: string;
    try {
      const buffer = await readFile(filePath);
      // 检测二进制文件（包含 null 字节）
      if (buffer.includes(0)) {
        throw new ToolError(
          FileOperationErrorCode.INVALID_ENCODING,
          `Binary file detected: ${filePath}`,
          { path: filePath }
        );
      }
      content = buffer.toString('utf-8');
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      return []; // 无法读取的文件跳过
    }

    // 搜索匹配
    const lines = content.split('\n');
    const matches: GrepMatch[] = [];

    // 如果启用多行模式，对整个内容搜索
    if (regex.multiline) {
      let match: RegExpExecArray | null;
      const globalRegex = new RegExp(
        regex.source,
        regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
      );

      while ((match = globalRegex.exec(content)) !== null) {
        const beforeContent = content.substring(0, match.index);
        const lineNumber = beforeContent.split('\n').length;

        // 获取匹配行的内容
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const lineEnd = content.indexOf('\n', match.index);
        const lineContent = content.substring(
          lineStart,
          lineEnd === -1 ? undefined : lineEnd
        );

        const grepMatch: GrepMatch = {
          filePath,
          lineNumber,
          content: lineContent,
        };

        // 添加上下文
        if (contextLines > 0) {
          grepMatch.context = {
            before: lines.slice(
              Math.max(0, lineNumber - contextLines - 1),
              lineNumber - 1
            ),
            after: lines.slice(
              lineNumber,
              Math.min(lines.length, lineNumber + contextLines)
            ),
          };
        }

        matches.push(grepMatch);

        // 防止无限循环
        if (match.index === globalRegex.lastIndex) {
          globalRegex.lastIndex++;
        }
      }
    } else {
      // 逐行搜索
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          const grepMatch: GrepMatch = {
            filePath,
            lineNumber: i + 1,
            content: line,
          };

          // 添加上下文
          if (contextLines > 0) {
            grepMatch.context = {
              before: lines.slice(Math.max(0, i - contextLines), i),
              after: lines.slice(
                i + 1,
                Math.min(lines.length, i + 1 + contextLines)
              ),
            };
          }

          matches.push(grepMatch);
        }
      }
    }

    return matches;
  }

  /**
   * 格式化搜索结果
   */
  private formatResults(matches: GrepMatch[], binarySkipped: string[]): string {
    if (matches.length === 0 && binarySkipped.length === 0) {
      return 'No matches found.';
    }

    const lines: string[] = [];

    // 按文件分组
    const groupedByFile = new Map<string, GrepMatch[]>();
    for (const match of matches) {
      const existing = groupedByFile.get(match.filePath) || [];
      existing.push(match);
      groupedByFile.set(match.filePath, existing);
    }

    // 输出每个文件的匹配
    for (const [filePath, fileMatches] of groupedByFile) {
      lines.push(`\n${filePath}:`);

      for (const match of fileMatches) {
        // 输出上文
        if (match.context?.before.length) {
          for (let i = 0; i < match.context.before.length; i++) {
            const lineNum = match.lineNumber - match.context.before.length + i;
            lines.push(`${lineNum}: ${match.context.before[i]}`);
          }
        }

        // 输出行内容
        lines.push(`${match.lineNumber}: ${match.content}`);

        // 输出下文
        if (match.context?.after.length) {
          for (let i = 0; i < match.context.after.length; i++) {
            const lineNum = match.lineNumber + 1 + i;
            lines.push(`${lineNum}: ${match.context.after[i]}`);
          }
        }
      }
    }

    // 输出跳过的二进制文件
    if (binarySkipped.length > 0) {
      lines.push(`\n[Binary files skipped: ${binarySkipped.length}]`);
    }

    // 输出统计
    lines.push(`\n---`);
    lines.push(
      `Found ${matches.length} matches in ${groupedByFile.size} files`
    );

    return lines.join('\n');
  }
}
