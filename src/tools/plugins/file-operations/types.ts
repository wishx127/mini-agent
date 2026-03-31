/* eslint-disable no-unused-vars */
/**
 * 文件操作错误码枚举
 */
export enum FileOperationErrorCode {
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_ACCESS_DENIED = 'PATH_ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_ENCODING = 'INVALID_ENCODING',
  INVALID_REGEX = 'INVALID_REGEX',
  INVALID_GLOB_PATTERN = 'INVALID_GLOB_PATTERN',
  WRITE_ERROR = 'WRITE_ERROR',
  FILE_ALREADY_EXISTS = 'FILE_ALREADY_EXISTS',
  IS_DIRECTORY = 'IS_DIRECTORY',
  DELETE_ERROR = 'DELETE_ERROR',
  MOVE_ERROR = 'MOVE_ERROR',
  SOURCE_NOT_FOUND = 'SOURCE_NOT_FOUND',
  USER_CANCELLED = 'USER_CANCELLED',
}

/**
 * 文件操作工具错误类
 */
export class ToolError extends Error {
  code: FileOperationErrorCode;

  details?: Record<string, unknown>;

  constructor(
    code: FileOperationErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'ToolError';
  }
}
