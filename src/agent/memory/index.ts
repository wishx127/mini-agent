export { SessionStore } from './session-store.js';
export { CostTracker } from './cost-tracker.js';
export {
  estimateTokenCount,
  createTrimmer,
  getTokenStatus,
  runTokenPreflight,
} from './token-manager.js';
export type { TokenUsage, CostRecord, CostSummary } from './types.js';

// Long-term memory exports
export { VectorDatabaseClient } from './vector-database-client.js';
export { MemoryExtractor } from './memory-extractor.js';
export { LongTermMemoryManager } from './long-term-memory-manager.js';
export type { MemoryExtractorConfig } from './memory-extractor.js';
export type { MemoryStats } from './long-term-memory-manager.js';
