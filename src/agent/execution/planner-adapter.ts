import type { ExecutionPlan } from '../../types/agent.js';

import type { Plan, PlanStep } from './types.js';

export class PlannerAdapter {
  static toLegacyFormat(plan: Plan): ExecutionPlan {
    if (plan.isFinalAnswer) {
      return {
        needsTool: false,
        toolCalls: [],
        reasoning: plan.reasoning || 'Final answer provided',
      };
    }

    const toolCalls = plan.steps.map((step) => ({
      toolCallId: step.id,
      toolName: step.toolName,
      arguments: step.arguments,
    }));

    return {
      needsTool: true,
      toolCalls,
      reasoning: plan.reasoning,
    };
  }

  static toNewFormat(executionPlan: ExecutionPlan): Plan {
    const steps: PlanStep[] = executionPlan.toolCalls.map((tc, index) => ({
      id: tc.toolCallId || `step_${index}`,
      toolName: tc.toolName,
      arguments: tc.arguments || {},
      dependsOn: [],
      confidence: 0.8,
      reasoning: executionPlan.reasoning,
    }));

    return {
      steps,
      overallConfidence: executionPlan.needsTool ? 0.8 : 0.0,
      reasoning: executionPlan.reasoning,
      isFinalAnswer: !executionPlan.needsTool,
    };
  }

  static isNewFormat(plan: ExecutionPlan | Plan): plan is Plan {
    return 'steps' in plan && 'overallConfidence' in plan;
  }
}
