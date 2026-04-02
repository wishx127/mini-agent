/**
 * 文件操作工具统一入口
 */
export { ReadTool } from './read-tool.js';
export { GlobTool } from './glob-tool.js';
export { GrepTool } from './grep-tool.js';
export { LSTool } from './ls-tool.js';
export { CreateTool } from './create-tool.js';
export { WriteTool } from './write-tool.js';
export { DeleteTool } from './delete-tool.js';
export { MoveTool } from './move-tool.js';
export { MkdirTool } from './mkdir-tool.js';
export {
  DiffTool,
  diffFiles,
  diffStrings,
  diffLargeFiles,
  readFileInChunks,
  getChunkedFileInfo,
} from './diff-tool.js';
export { PatchTool, applyPatch } from './patch-tool.js';
export {
  setAuthManager,
  getAuthManager,
  CachedAuthManager,
  normalizeAuthPath,
  buildAuthKey,
  extractAuthDetailsFields,
} from './auth.js';
export { EditTool, editFile, editLines } from './edit-tool.js';

// 导出工具函数
export {
  validatePath,
  validateFileSize,
  validateTextFile,
  getProjectRoot,
  ensureDirectoryExists,
  isDirectory,
  sourcePathExists,
  isPathWithinProject,
} from './path-validator.js';

// 导出类型和错误
export { ToolError, FileOperationErrorCode } from './types.js';
export type {
  EditResult,
  AffectedRange,
  ResolvePathOptions,
} from './edit-utils.js';
export { resolveFilePath, isSymlink, getSymlinkTarget } from './edit-utils.js';
export type {
  DiffOptions,
  DiffResult,
  DiffStringsOptions,
  ChunkedReadOptions,
  ChunkedFileInfo,
} from './diff-tool.js';
export type { ApplyPatchOptions, ApplyPatchResult } from './patch-tool.js';
export type { AuthManager, AuthDetailsFields } from './auth.js';
export type {
  EditFileOptions,
  EditFileResult,
  LineEditOptions,
} from './edit-tool.js';
