/**
 * 计划验证器 - 实现Plan Critic校验机制
 * 用于验证计划的完整性和有效性
 */

import { Plan, PlanStep, ToolInfo } from './types.js';

/**
 * 计划问题类型
 */
export type PlanIssueType =
  | 'empty_steps'
  | 'invalid_tool'
  | 'missing_termination'
  | 'circular_dependency'
  | 'too_many_steps'
  | 'missing_success_criteria'
  | 'invalid_confidence'
  | 'duplicate_step_ids';

/**
 * 计划问题详情
 */
export interface PlanIssue {
  type: PlanIssueType;
  severity: 'error' | 'warning';
  message: string;
  stepId?: string;
  details?: Record<string, unknown>;
}

/**
 * 计划验证结果
 */
export interface PlanValidationResult {
  isValid: boolean;
  issues: PlanIssue[];
  errorCount: number;
  warningCount: number;
  suggestions: string[];
}

/**
 * 验证配置
 */
export interface PlanValidatorConfig {
  maxSteps: number;
  requireTerminationCondition: boolean;
  requireSuccessCriteria: boolean;
  minConfidence: number;
  availableTools: ToolInfo[];
}

/**
 * 默认验证配置
 */
export const DEFAULT_PLAN_VALIDATOR_CONFIG: Partial<PlanValidatorConfig> = {
  maxSteps: 20,
  requireTerminationCondition: false,
  requireSuccessCriteria: true,
  minConfidence: 0.3,
};

/**
 * 计划验证器类
 */
export class PlanValidator {
  private config: PlanValidatorConfig;

  constructor(config: Partial<PlanValidatorConfig> = {}) {
    this.config = {
      ...DEFAULT_PLAN_VALIDATOR_CONFIG,
      ...config,
      availableTools: config.availableTools || [],
    } as PlanValidatorConfig;
  }

  /**
   * 验证计划
   */
  validate(plan: Plan): PlanValidationResult {
    const issues: PlanIssue[] = [];

    // 执行各项检查
    issues.push(...this.checkEmptySteps(plan));
    issues.push(...this.checkInvalidTools(plan));
    issues.push(...this.checkDuplicateStepIds(plan));
    issues.push(...this.checkCircularDependencies(plan));
    issues.push(...this.checkStepCount(plan));
    issues.push(...this.checkConfidence(plan));

    if (this.config.requireSuccessCriteria) {
      issues.push(...this.checkSuccessCriteria(plan));
    }

    if (this.config.requireTerminationCondition) {
      issues.push(...this.checkTerminationCondition(plan));
    }

    // 统计错误和警告数量
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;

    // 生成建议
    const suggestions = this.generateSuggestions(issues, plan);

    return {
      isValid: errorCount === 0,
      issues,
      errorCount,
      warningCount,
      suggestions,
    };
  }

  /**
   * 检查空步骤
   */
  private checkEmptySteps(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    if (!plan.steps || plan.steps.length === 0) {
      issues.push({
        type: 'empty_steps',
        severity: 'error',
        message: '计划没有包含任何步骤',
        details: { stepsCount: plan.steps?.length || 0 },
      });
    }

    return issues;
  }

  /**
   * 检查无效工具
   */
  private checkInvalidTools(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    if (this.config.availableTools.length === 0) {
      // 如果没有提供可用工具列表，跳过此检查
      return issues;
    }

    const availableToolNames = new Set(
      this.config.availableTools.map((t) => t.name)
    );

    for (const step of plan.steps) {
      if (!availableToolNames.has(step.toolName)) {
        issues.push({
          type: 'invalid_tool',
          severity: 'error',
          message: `步骤 "${step.id}" 使用了不可用的工具 "${step.toolName}"`,
          stepId: step.id,
          details: {
            toolName: step.toolName,
            availableTools: Array.from(availableToolNames),
          },
        });
      }
    }

    return issues;
  }

  /**
   * 检查重复的步骤ID
   */
  private checkDuplicateStepIds(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];
    const stepIds = new Set<string>();

    for (const step of plan.steps) {
      if (stepIds.has(step.id)) {
        issues.push({
          type: 'duplicate_step_ids',
          severity: 'error',
          message: `步骤ID "${step.id}" 重复`,
          stepId: step.id,
        });
      }
      stepIds.add(step.id);
    }

    return issues;
  }

  /**
   * 检查循环依赖
   */
  private checkCircularDependencies(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    try {
      // 使用拓扑排序检测循环
      this.topologicalSort(plan.steps);
    } catch (error) {
      issues.push({
        type: 'circular_dependency',
        severity: 'error',
        message: '计划中存在循环依赖',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    return issues;
  }

  /**
   * 拓扑排序（用于检测循环依赖）
   */
  private topologicalSort(steps: PlanStep[]): PlanStep[] {
    const stepMap = new Map<string, PlanStep>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, step.dependsOn.length);
      adjacency.set(step.id, []);
    }

    for (const step of steps) {
      for (const depId of step.dependsOn) {
        const deps = adjacency.get(depId);
        if (deps) {
          deps.push(step.id);
        }
      }
    }

    const queue: string[] = [];
    for (const [stepId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(stepId);
      }
    }

    const result: PlanStep[] = [];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const step = stepMap.get(currentId);
      if (step) {
        result.push(step);
      }

      const neighbors = adjacency.get(currentId) || [];
      for (const neighborId of neighbors) {
        const newDegree = (inDegree.get(neighborId) || 0) - 1;
        inDegree.set(neighborId, newDegree);
        if (newDegree === 0) {
          queue.push(neighborId);
        }
      }
    }

    if (result.length !== steps.length) {
      throw new Error('Dependency graph contains cycles');
    }

    return result;
  }

  /**
   * 检查步骤数量
   */
  private checkStepCount(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    if (plan.steps.length > this.config.maxSteps) {
      issues.push({
        type: 'too_many_steps',
        severity: 'warning',
        message: `计划步骤数量 (${plan.steps.length}) 超过建议的最大值 (${this.config.maxSteps})`,
        details: {
          currentCount: plan.steps.length,
          maxSteps: this.config.maxSteps,
        },
      });
    }

    return issues;
  }

  /**
   * 检查置信度
   */
  private checkConfidence(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    if (plan.overallConfidence < this.config.minConfidence) {
      issues.push({
        type: 'invalid_confidence',
        severity: 'warning',
        message: `计划整体置信度 (${plan.overallConfidence.toFixed(2)}) 低于建议的最小值 (${this.config.minConfidence})`,
        details: {
          currentConfidence: plan.overallConfidence,
          minConfidence: this.config.minConfidence,
        },
      });
    }

    // 检查每个步骤的置信度
    for (const step of plan.steps) {
      if (step.confidence < this.config.minConfidence) {
        issues.push({
          type: 'invalid_confidence',
          severity: 'warning',
          message: `步骤 "${step.id}" 的置信度 (${step.confidence.toFixed(2)}) 过低`,
          stepId: step.id,
          details: {
            currentConfidence: step.confidence,
            minConfidence: this.config.minConfidence,
          },
        });
      }
    }

    return issues;
  }

  /**
   * 检查成功标准
   */
  private checkSuccessCriteria(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    for (const step of plan.steps) {
      // 检查是否定义了 success_criteria（如果 PlanStep 有这个字段）
      const stepWithCriteria = step as PlanStep & {
        success_criteria?: string;
      };
      if (!stepWithCriteria.success_criteria) {
        issues.push({
          type: 'missing_success_criteria',
          severity: 'warning',
          message: `步骤 "${step.id}" 缺少成功标准定义`,
          stepId: step.id,
        });
      }
    }

    return issues;
  }

  /**
   * 检查终止条件
   */
  private checkTerminationCondition(plan: Plan): PlanIssue[] {
    const issues: PlanIssue[] = [];

    // 检查是否定义了 termination_condition（如果 Plan 有这个字段）
    const planWithTermination = plan as Plan & {
      termination_condition?: string;
    };
    if (!planWithTermination.termination_condition) {
      issues.push({
        type: 'missing_termination',
        severity: 'warning',
        message: '计划缺少终止条件定义',
      });
    }

    return issues;
  }

  /**
   * 生成改进建议
   */
  private generateSuggestions(issues: PlanIssue[], _plan: Plan): string[] {
    const suggestions: string[] = [];

    const issueTypes = new Set(issues.map((i) => i.type));

    if (issueTypes.has('empty_steps')) {
      suggestions.push('请确保计划包含至少一个可执行的步骤');
    }

    if (issueTypes.has('invalid_tool')) {
      suggestions.push('请检查步骤中使用的工具名称是否正确');
    }

    if (issueTypes.has('circular_dependency')) {
      suggestions.push('请检查步骤之间的依赖关系，确保没有循环依赖');
    }

    if (issueTypes.has('too_many_steps')) {
      suggestions.push('考虑将计划拆分为多个较小的子计划');
    }

    if (issueTypes.has('invalid_confidence')) {
      suggestions.push('考虑重新评估计划的可行性，或添加更多备选方案');
    }

    if (issueTypes.has('missing_success_criteria')) {
      suggestions.push('为每个步骤定义明确的成功标准，以便于评估执行结果');
    }

    if (issueTypes.has('missing_termination')) {
      suggestions.push('定义明确的终止条件，以便系统知道何时完成任务');
    }

    return suggestions;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PlanValidatorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): PlanValidatorConfig {
    return { ...this.config };
  }
}

/**
 * 创建默认的计划验证器
 */
export function createPlanValidator(
  availableTools?: ToolInfo[]
): PlanValidator {
  return new PlanValidator({
    availableTools: availableTools || [],
  });
}

/**
 * 快速验证计划
 */
export function validatePlan(
  plan: Plan,
  availableTools?: ToolInfo[]
): PlanValidationResult {
  const validator = createPlanValidator(availableTools);
  return validator.validate(plan);
}
