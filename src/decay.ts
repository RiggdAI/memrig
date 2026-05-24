import type { MemoryType } from "./schema.js";

export const DECAY_RATES: Record<MemoryType, number> = {
  decision: 0.01,
  preference: 0.015,
  context: 0.03,
  bug: 0.05,
  pattern: 0.02,
  architecture: 0.01,
};

const PRUNE_THRESHOLD = 0.05;

export function calculateStrength(
  type: MemoryType,
  importance: number,
  daysSinceAccess: number,
): number {
  const lambda = DECAY_RATES[type];
  return Math.max(0, Math.min(1, importance * Math.exp(-lambda * daysSinceAccess)));
}

export function shouldPrune(
  type: MemoryType,
  importance: number,
  daysSinceAccess: number,
): boolean {
  return calculateStrength(type, importance, daysSinceAccess) < PRUNE_THRESHOLD;
}
