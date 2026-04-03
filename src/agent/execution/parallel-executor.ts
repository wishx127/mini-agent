import {
  Plan,
  PlanStep,
  ToolExecutionResult,
  WaveExecutionResult,
  ExecutionWave,
  ToolCallStatus,
  ToolInfo,
} from './types.js';

export function parseDependencyGraph(plan: Plan): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const step of plan.steps) {
    if (!graph.has(step.id)) {
      graph.set(step.id, new Set());
    }
    for (const depId of step.dependsOn) {
      graph.get(step.id)!.add(depId);
    }
  }

  return graph;
}

export function topologicalSort(steps: PlanStep[]): PlanStep[] {
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

export function groupIntoWaves(steps: PlanStep[]): ExecutionWave[] {
  if (steps.length === 0) {
    return [];
  }

  const sortedSteps = topologicalSort(steps);
  const waveIndexById = new Map<string, number>();

  for (const step of sortedSteps) {
    if (step.dependsOn.length === 0) {
      waveIndexById.set(step.id, 0);
      continue;
    }

    const depWaveIndexes = step.dependsOn
      .map((depId) => waveIndexById.get(depId))
      .filter((index): index is number => index !== undefined);

    if (depWaveIndexes.length === 0) {
      waveIndexById.set(step.id, 0);
      continue;
    }

    const minDepWave = Math.min(...depWaveIndexes);
    waveIndexById.set(step.id, minDepWave + 1);
  }

  const waves: ExecutionWave[] = [];
  for (const step of sortedSteps) {
    const waveIndex = waveIndexById.get(step.id) ?? 0;
    if (!waves[waveIndex]) {
      waves[waveIndex] = { waveIndex, steps: [] };
    }
    waves[waveIndex].steps.push(step);
  }

  return waves;
}

export function buildExecutionWaves(plan: Plan): ExecutionWave[] {
  return groupIntoWaves(plan.steps);
}

export function resolveDependencies(
  stepArgs: Record<string, unknown>,
  previousResults: Map<string, ToolExecutionResult>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(stepArgs)) {
    if (typeof value === 'string') {
      const resolvedValue = resolvePlaceholder(value, previousResults);
      resolved[key] = resolvedValue;
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function resolvePlaceholder(
  value: string,
  previousResults: Map<string, ToolExecutionResult>
): unknown {
  const placeholderRegex = /\$\{([^}]+)\}/g;

  return value.replace(
    placeholderRegex,
    (match: string, path: string): string => {
      const matchResult = path.match(/^step(\d+)(?:\.result(?:\.(.+))?)?$/);
      if (matchResult) {
        const stepIndex = parseInt(matchResult[1], 10);
        const resultField = matchResult[2];

        for (const [, result] of previousResults) {
          if (result.stepIndex === stepIndex) {
            if (resultField && result.result) {
              const parts = resultField.split('.');
              let current: unknown = JSON.parse(result.result);
              for (const part of parts) {
                if (current && typeof current === 'object' && part in current) {
                  current = (current as Record<string, unknown>)[part];
                } else {
                  return match;
                }
              }
              return String(current);
            }
            return result.result || '';
          }
        }
      }
      return match;
    }
  );
}

export function createDefaultToolExecutor(
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>
) {
  return async function executeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    let status: ToolCallStatus = 'success';
    let result: string | undefined;
    let error: string | undefined;

    try {
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout);
      });

      result = await Promise.race([
        toolExecutor(toolName, args),
        timeoutPromise,
      ]);
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }

    const endTime = Date.now();

    return {
      stepId: '',
      stepIndex: -1,
      toolName,
      arguments: args,
      result,
      status,
      error,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  };
}

export async function executeWave(
  wave: ExecutionWave,
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>,
  previousResults: Map<string, ToolExecutionResult>,
  config: {
    toolTimeout: number;
    maxConcurrentTools: number;
    waveTimeout: number;
    toolInfoMap?: Map<string, ToolInfo>; // 工具信息映射，用于获取工具级别的超时时间
  },
  onToolExecuted?: (
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ) => void
): Promise<WaveExecutionResult> {
  const waveStartTime = Date.now();
  const { toolTimeout, maxConcurrentTools, waveTimeout, toolInfoMap } = config;

  const executeStepWithTimeout = async (
    step: PlanStep,
    index: number
  ): Promise<ToolExecutionResult> => {
    const startTime = Date.now();
    const resolvedArgs = resolveDependencies(step.arguments, previousResults);

    // 使用工具级别的超时时间（如果有），否则使用默认超时
    const stepTimeout = toolInfoMap?.get(step.toolName)?.timeout ?? toolTimeout;

    let status: ToolCallStatus = 'success';
    let result: string | undefined;
    let error: string | undefined;

    try {
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(
          () => reject(new Error('Tool execution timeout')),
          stepTimeout
        );
      });

      result = await Promise.race([
        toolExecutor(step.toolName, resolvedArgs),
        timeoutPromise,
      ]);

      // 触发工具执行完成回调
      if (onToolExecuted && result !== undefined) {
        onToolExecuted(step.toolName, resolvedArgs, result);
      }
    } catch (e) {
      status =
        e instanceof Error && e.message === 'Tool execution timeout'
          ? 'timeout'
          : 'failed';
      error = e instanceof Error ? e.message : String(e);
    }

    const endTime = Date.now();

    return {
      stepId: step.id,
      stepIndex: index,
      toolName: step.toolName,
      arguments: resolvedArgs,
      result,
      status,
      error,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  };

  const stepPromises: Promise<ToolExecutionResult>[] = [];
  let running = 0;

  for (let i = 0; i < wave.steps.length; i++) {
    const step = wave.steps[i];

    const promise = (async () => {
      while (running >= maxConcurrentTools) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      running++;
      try {
        return await executeStepWithTimeout(step, i);
      } finally {
        running--;
      }
    })();

    stepPromises.push(promise);
  }

  const waveTimeoutPromise = new Promise<ToolExecutionResult[]>((resolve) => {
    setTimeout(() => resolve([]), waveTimeout);
  });

  let stepResults: ToolExecutionResult[];
  try {
    stepResults = await Promise.race([
      Promise.all(stepPromises),
      waveTimeoutPromise.then(() => {
        throw new Error('Wave timeout');
      }),
    ]);
  } catch {
    stepResults = await Promise.all(stepPromises);
  }

  const waveEndTime = Date.now();

  const successCount = stepResults.filter((r) => r.status === 'success').length;
  const failureCount = stepResults.length - successCount;

  return {
    waveIndex: wave.waveIndex,
    stepResults: stepResults.sort((a, b) => a.stepIndex - b.stepIndex),
    waveDuration: waveEndTime - waveStartTime,
    successCount,
    failureCount,
  };
}

export async function executeAllWaves(
  waves: ExecutionWave[],
  toolExecutor: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<string>,
  config: {
    toolTimeout: number;
    maxConcurrentTools: number;
    waveTimeout: number;
    toolInfoMap?: Map<string, ToolInfo>; // 工具信息映射，用于获取工具级别的超时时间
  },
  onToolExecuted?: (
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ) => void
): Promise<WaveExecutionResult[]> {
  const allResults: WaveExecutionResult[] = [];
  const previousResults = new Map<string, ToolExecutionResult>();

  for (const wave of waves) {
    const waveResult = await executeWave(
      wave,
      toolExecutor,
      previousResults,
      config,
      onToolExecuted
    );
    allResults.push(waveResult);

    for (const stepResult of waveResult.stepResults) {
      previousResults.set(stepResult.stepId, stepResult);
    }
  }

  return allResults;
}
