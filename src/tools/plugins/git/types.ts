/**
 * Git 操作工具类型定义
 */

/**
 * Git 状态结果
 */
export interface GitStatusResult {
  branch: string;
  modified: string[];
  staged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

/**
 * Git 分支信息
 */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: string;
}

/**
 * Git 提交信息
 */
export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

/**
 * Git 克隆选项
 */
export interface GitCloneOptions {
  url: string;
  directory?: string;
  branch?: string;
  depth?: number;
  cwd?: string;
  timeout?: number;
}

/**
 * Git 状态选项
 */
export interface GitStatusOptions {
  cwd?: string;
}

/**
 * Git 分支选项
 */
export interface GitBranchOptions {
  action: 'list' | 'create' | 'delete' | 'switch';
  name?: string;
  force?: boolean;
  cwd?: string;
}

/**
 * Git 提交选项
 */
export interface GitCommitOptions {
  message: string;
  files?: string[];
  all?: boolean;
  cwd?: string;
}

/**
 * Git 推送选项
 */
export interface GitPushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
  cwd?: string;
  confirmed?: boolean;
}

/**
 * Git 拉取选项
 */
export interface GitPullOptions {
  remote?: string;
  branch?: string;
  cwd?: string;
}

/**
 * Git 日志选项
 */
export interface GitLogOptions {
  limit?: number;
  cwd?: string;
}

/**
 * Git 重置选项
 */
export interface GitResetOptions {
  target?: string;
  mode: 'soft' | 'mixed' | 'hard';
  cwd?: string;
  confirmed?: boolean;
}

/**
 * Git 清理选项
 */
export interface GitCleanOptions {
  force?: boolean;
  directories?: boolean;
  dryRun?: boolean;
  cwd?: string;
  confirmed?: boolean;
}
