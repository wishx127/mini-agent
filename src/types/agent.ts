/**
 * 错误类型枚举
 */
export const ErrorType = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  PARAMETER: 'parameter',
  UNKNOWN: 'unknown',
} as const;

export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

/**
 * 网络错误
 */
export class NetworkError extends Error {
  public readonly type = ErrorType.NETWORK;
  constructor(
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends Error {
  public readonly type = ErrorType.TIMEOUT;
  constructor(
    message: string,
    public readonly timeout: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * 参数错误
 */
export class ParameterError extends Error {
  public readonly type = ErrorType.PARAMETER;
  constructor(
    message: string,
    public readonly parameter?: string
  ) {
    super(message);
    this.name = 'ParameterError';
  }
}

/**
 * 未知错误
 */
export class UnknownError extends Error {
  public readonly type = ErrorType.UNKNOWN;
  constructor(
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'UnknownError';
  }
}

/**
 * Agent 错误类型联合
 */
export type AgentError =
  | NetworkError
  | TimeoutError
  | ParameterError
  | UnknownError;

/**
 * 工具调用详情
 */
export interface ToolCallDetail {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  result: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 重试次数 */
  retryCount?: number;
  /** 最后错误信息 */
  lastError?: string;
}

/**
 * Token 状态
 */
export interface TokenStatus {
  /** 当前 Token 数量 */
  total: number;
  /** Token 上限 */
  limit: number;
  /** 使用百分比 */
  percentage: number;
  /** 是否超过限制 */
  exceeded: boolean;
  /** 是否接近阈值 */
  nearThreshold: boolean;
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  /** 是否需要使用工具 */
  needsTool: boolean;
  /** 工具调用列表 */
  toolCalls: ToolCallDetail[];
  /** 规划推理说明 */
  reasoning?: string;
  /** 是否支持并行执行 */
  parallelExecution?: boolean;
}

/**
 * 控制配置
 */
export interface ControlConfig {
  /** 最大 Token 数量 */
  maxTokens: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 超时时间（毫秒） */
  timeout: number;
  /** Token 预警阈值 */
  tokenThreshold: number;
  /** 单个工具执行超时（毫秒） */
  toolTimeout: number;
  /** 结果最大长度 */
  maxResultLength: number;
}

/**
 * 默认控制配置
 */
export const DEFAULT_CONTROL_CONFIG: ControlConfig = {
  maxTokens: 6000,
  maxIterations: 3,
  timeout: 30000,
  tokenThreshold: 0.9,
  toolTimeout: 30000,
  maxResultLength: 4000,
};

/**
 * 执行指标
 */
export interface ExecutionMetrics {
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 总执行时间（毫秒） */
  totalDuration?: number;
  /** 当前迭代次数 */
  iterationCount: number;
  /** Token 状态 */
  tokenStatus?: TokenStatus;
  /** 工具执行成功次数 */
  toolSuccessCount: number;
  /** 工具执行失败次数 */
  toolFailureCount: number;
  /** 工具执行结果列表 */
  toolResults: ToolExecutionResult[];
}

/**
 * 执行状态
 */
export type ExecutionState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

/**
 * 执行状态信息
 */
export interface ExecutionStatus {
  /** 当前状态 */
  state: ExecutionState;
  /** 当前阶段 */
  phase: 'planning' | 'executing' | 'finalizing' | 'done';
  /** 执行指标 */
  metrics: ExecutionMetrics;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 规划上下文
 */
export interface PlanningContext {
  /** 用户提示 */
  prompt: string;
  /** 对话历史 */
  conversationHistory: ConversationMessage[];
  /** 可用工具 */
  availableTools: ToolInfo[];
}

/**
 * 对话消息
 */
export interface ConversationMessage {
  /** 消息角色 */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 消息内容 */
  content: string;
  /** 工具调用 ID（仅 tool 角色） */
  toolCallId?: string;
  /** 工具名称（仅 tool 角色） */
  toolName?: string;
}

/**
 * 工具信息
 */
export interface ToolInfo {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 参数 Schema */
  parameters?: Record<string, unknown>;
}

/**
 * 重试策略
 */
export interface RetryStrategy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 延迟策略 */
  delays: number[];
}

/**
 * 默认重试策略
 */
export const DEFAULT_RETRY_STRATEGIES: Record<ErrorType, RetryStrategy> = {
  [ErrorType.NETWORK]: {
    maxRetries: 3,
    delays: [1000, 2000, 4000], // 指数退避
  },
  [ErrorType.TIMEOUT]: {
    maxRetries: 2,
    delays: [1000, 1000], // 固定延迟
  },
  [ErrorType.PARAMETER]: {
    maxRetries: 0,
    delays: [], // 不重试
  },
  [ErrorType.UNKNOWN]: {
    maxRetries: 1,
    delays: [1000], // 重试一次
  },
};

/**
 * 兜底策略结果
 */
export interface FallbackResult {
  /** 是否触发兜底 */
  triggered: boolean;
  /** 兜底原因 */
  reason:
    | 'token_exceeded'
    | 'timeout'
    | 'iteration_exceeded'
    | 'all_tools_failed'
    | 'planner_error'
    | 'executor_error';
  /** 部分结果 */
  partialResult?: string;
  /** 用户提示消息 */
  message: string;
}
