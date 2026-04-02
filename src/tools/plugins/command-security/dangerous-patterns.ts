/**
 * 危险命令模式检测
 */

import {
  ErrorCode,
  ErrorType,
  ToolError,
  DangerousPattern,
  ConfirmationDetails,
} from './types.js';

/**
 * 危险命令黑名单
 */
const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // 递归删除
  {
    pattern: /rm\s+-rf?\s+\/($|\s)/i,
    description: 'Recursive deletion of root directory',
  },
  {
    pattern: /rm\s+-rf?\s+\*($|\s)/i,
    description: 'Recursive deletion of current directory',
  },
  // 格式化文件系统
  {
    pattern: /mkfs/i,
    description: 'File system formatting',
  },
  // 裸磁盘操作
  {
    pattern: /dd\s+if=/i,
    description: 'Raw disk operation',
  },
  // Fork 炸弹
  {
    pattern: /:\(\)\s*\{\s*:\s*\|:\s*&\s*\}\s*;\s*:/,
    description: 'Fork bomb',
  },
  // 直接写入磁盘
  {
    pattern: />\s*\/dev\/(sda|hda|disk)/i,
    description: 'Direct disk write',
  },
  // 删除系统目录
  {
    pattern: /rm\s+.*\/(bin|sbin|usr|etc|lib|var)(\/|\s|$)/i,
    description: 'Deletion of system directories',
  },
];

/**
 * 需要确认的操作模式
 */
const CONFIRMATION_PATTERNS: DangerousPattern[] = [
  // Git force push
  {
    pattern: /git\s+push\s+.*--force/i,
    description: 'Force push will overwrite remote history',
    requiresConfirmation: true,
  },
  {
    pattern: /git\s+push\s+.*-f\s/i,
    description: 'Force push will overwrite remote history',
    requiresConfirmation: true,
  },
  // Git hard reset
  {
    pattern: /git\s+reset\s+.*--hard/i,
    description: 'Hard reset will discard all uncommitted changes',
    requiresConfirmation: true,
  },
  // Git clean
  {
    pattern: /git\s+clean\s+.*-f/i,
    description: 'Git clean will permanently delete untracked files',
    requiresConfirmation: true,
  },
];

/**
 * 解释器危险用法模式
 */
const INTERPRETER_DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Node.js 危险用法
  {
    pattern: /node\s+.*-e\s+.*require\s*\(\s*['"]child_process['"]\s*\)/i,
    description: 'Node.js child_process usage detected',
    requiresConfirmation: true,
  },
  {
    pattern: /node\s+.*-e\s+.*exec\s*\(/i,
    description: 'Node.js exec usage detected',
    requiresConfirmation: true,
  },
  // Python 危险用法
  {
    pattern: /python\d*\s+.*-c\s+.*import\s+subprocess/i,
    description: 'Python subprocess usage detected',
    requiresConfirmation: true,
  },
  {
    pattern: /python\d*\s+.*-c\s+.*os\.system/i,
    description: 'Python os.system usage detected',
    requiresConfirmation: true,
  },
  {
    pattern: /python\d*\s+.*-c\s+.*eval\s*\(/i,
    description: 'Python eval usage detected',
    requiresConfirmation: true,
  },
  {
    pattern: /python\d*\s+.*-c\s+.*exec\s*\(/i,
    description: 'Python exec usage detected',
    requiresConfirmation: true,
  },
];

/**
 * 检测危险命令
 */
export function detectDangerousCommand(command: string): {
  dangerous: boolean;
  error?: ToolError;
} {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        error: {
          code: ErrorCode.SECURITY_DANGEROUS_PATTERN,
          message: `Dangerous pattern detected: ${description}`,
          type: ErrorType.SECURITY,
          retryable: false,
          details: {
            command,
            pattern: pattern.toString(),
            description,
          },
        },
      };
    }
  }

  return { dangerous: false };
}

/**
 * 检测需要确认的操作
 */
export function detectConfirmationRequired(command: string): {
  requiresConfirmation: boolean;
  details?: ConfirmationDetails;
} {
  const allPatterns = [
    ...CONFIRMATION_PATTERNS,
    ...INTERPRETER_DANGEROUS_PATTERNS,
  ];

  for (const { pattern, description, requiresConfirmation } of allPatterns) {
    if (pattern.test(command) && requiresConfirmation) {
      const details = getConfirmationDetails(command, description);
      return {
        requiresConfirmation: true,
        details,
      };
    }
  }

  return { requiresConfirmation: false };
}

/**
 * 获取确认详情
 */
function getConfirmationDetails(
  command: string,
  description: string
): ConfirmationDetails {
  // Git force push
  if (/git\s+push\s+.*(--force|-f)/i.test(command)) {
    return {
      operation: 'git push --force',
      command,
      risks: [
        'Will overwrite remote branch history',
        'Other collaborators may lose commits',
        'Cannot be undone',
      ],
      alternatives: [
        'Use regular push after pulling changes',
        'Use git reflog to recover lost commits',
      ],
    };
  }

  // Git hard reset
  if (/git\s+reset\s+.*--hard/i.test(command)) {
    return {
      operation: 'git reset --hard',
      command,
      risks: [
        'Will discard all uncommitted changes',
        'Will discard all untracked files',
        'Cannot be undone',
      ],
      alternatives: [
        'Use git stash to save changes temporarily',
        'Use git reset --soft to keep changes staged',
        'Use git reset --mixed to keep changes unstaged',
      ],
    };
  }

  // Git clean
  if (/git\s+clean\s+.*-f/i.test(command)) {
    return {
      operation: 'git clean -fd',
      command,
      risks: [
        'Will permanently delete untracked files',
        'Will permanently delete untracked directories',
        'Cannot be undone',
      ],
      alternatives: [
        'Use git clean -n (dry run) to preview files first',
        'Manually backup important files before cleaning',
      ],
    };
  }

  // 解释器危险用法
  return {
    operation: 'Interpreter dangerous usage',
    command,
    risks: [
      description,
      'May execute arbitrary system commands',
      'Could compromise system security',
    ],
    alternatives: [
      'Review the command carefully',
      'Use safer alternatives if available',
      'Ensure you understand what the code does',
    ],
  };
}

/**
 * 检测危险 URL 协议
 */
export function detectDangerousProtocol(url: string): {
  dangerous: boolean;
  error?: ToolError;
} {
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:'];

  for (const protocol of dangerousProtocols) {
    if (url.toLowerCase().startsWith(protocol)) {
      return {
        dangerous: true,
        error: {
          code: ErrorCode.SECURITY_INVALID_PROTOCOL,
          message: `Dangerous URL protocol not allowed: ${protocol}`,
          type: ErrorType.SECURITY,
          retryable: false,
          details: { url },
        },
      };
    }
  }

  return { dangerous: false };
}

/**
 * 创建确认错误
 */
export function createConfirmationError(
  details: ConfirmationDetails
): ToolError {
  return {
    code: ErrorCode.CONFIRMATION_REQUIRED,
    message: `This operation requires confirmation: ${details.operation}`,
    type: ErrorType.CONFIRMATION,
    retryable: false,
    requiresConfirmation: true,
    details: {
      operation: details.operation,
      risks: details.risks,
      alternatives: details.alternatives,
      command: details.command,
    },
  };
}
