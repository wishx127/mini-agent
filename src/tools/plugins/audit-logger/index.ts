/**
 * 审计日志模块
 * 记录命令执行活动，支持日志轮转和敏感信息脱敏
 */

import { appendFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'security';
  category: 'git' | 'bash' | 'security';
  operation: string;
  command?: string;
  cwd?: string;
  success: boolean;
  duration?: number;
  error?: string;
  confirmationProvided?: boolean;
  details?: Record<string, unknown>;
}

/**
 * 日志配置
 */
interface LoggerConfig {
  logDir: string;
  retentionDays: number;
}

/**
 * 审计日志类
 */
export class AuditLogger {
  private config: LoggerConfig;
  private currentDate: string = '';
  private currentLogFile: string = '';

  constructor() {
    const defaultLogDir =
      process.env.MINI_AGENT_LOG_DIR || join(homedir(), '.mini-agent', 'logs');
    this.config = {
      logDir: defaultLogDir,
      retentionDays: 7,
    };
  }

  /**
   * 初始化日志目录
   */
  async initialize(): Promise<void> {
    try {
      await access(this.config.logDir, constants.F_OK);
    } catch {
      await mkdir(this.config.logDir, { recursive: true });
    }
  }

  /**
   * 获取当前日志文件路径
   */
  private getLogFilePath(): string {
    const today = new Date().toISOString().split('T')[0];

    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentLogFile = join(this.config.logDir, `audit-${today}.log`);
    }

    return this.currentLogFile;
  }

  /**
   * 脱敏处理敏感信息
   */
  private sanitize(entry: AuditLogEntry): AuditLogEntry {
    const sanitized = { ...entry };

    // 脱敏 URL 中的 token
    if (sanitized.command) {
      sanitized.command = sanitized.command.replace(
        /(https?:\/\/)[^@]+@/g,
        '$1***@'
      );
    }

    // 脱敏 SSH key 路径
    if (sanitized.details?.sshKeyPath) {
      sanitized.details = {
        ...sanitized.details,
        sshKeyPath: '[REDACTED]',
      };
    }

    // 脱敏密码
    if (sanitized.details?.password) {
      sanitized.details = {
        ...sanitized.details,
        password: '[REDACTED]',
      };
    }

    return sanitized;
  }

  /**
   * 安全序列化日志条目
   */
  private serialize(entry: AuditLogEntry): string {
    // 使用 JSON.stringify 进行安全序列化
    // 防止日志注入攻击
    const sanitized = this.sanitize(entry);

    try {
      return JSON.stringify(sanitized);
    } catch {
      // 如果序列化失败，返回简化版本
      return JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        category: entry.category,
        operation: entry.operation,
        success: entry.success,
        error: 'Failed to serialize log entry',
      });
    }
  }

  /**
   * 写入日志
   */
  async log(entry: AuditLogEntry): Promise<void> {
    await this.initialize();

    const logFile = this.getLogFilePath();
    const logLine = this.serialize(entry) + '\n';

    try {
      await appendFile(logFile, logLine, 'utf-8');
    } catch (error) {
      // 日志写入失败不应影响主流程
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * 记录命令执行
   */
  async logCommandExecution(
    category: 'git' | 'bash',
    operation: string,
    command: string,
    cwd: string | undefined,
    success: boolean,
    duration: number,
    error?: string
  ): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: success ? 'info' : 'error',
      category,
      operation,
      command,
      cwd,
      success,
      duration,
      error,
    });
  }

  /**
   * 记录安全事件
   */
  async logSecurityEvent(
    operation: string,
    command: string,
    reason: string,
    blocked: boolean
  ): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'security',
      category: 'security',
      operation,
      command,
      success: !blocked,
      error: reason,
    });
  }

  /**
   * 记录确认操作
   */
  async logConfirmation(
    category: 'git' | 'bash',
    operation: string,
    command: string,
    confirmed: boolean
  ): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      category,
      operation,
      command,
      success: confirmed,
      confirmationProvided: confirmed,
    });
  }
}

// 导出单例实例
export const auditLogger = new AuditLogger();
