import { describe, it, expect } from "vitest";
import { calculateStrength, DECAY_RATES, shouldPrune } from "../src/decay.js";

describe("calculateStrength", () => {
  it("returns full importance when accessed just now", () => {
    const strength = calculateStrength("decision", 0.8, 0);
    expect(strength).toBeCloseTo(0.8);
  });

  it("decays over time", () => {
    const day0 = calculateStrength("decision", 0.8, 0);
    const day30 = calculateStrength("decision", 0.8, 30);
    const day90 = calculateStrength("decision", 0.8, 90);
    expect(day30).toBeLessThan(day0);
    expect(day90).toBeLessThan(day30);
  });

  it("bugs decay faster than decisions", () => {
    const bugStrength = calculateStrength("bug", 0.5, 30);
    const decisionStrength = calculateStrength("decision", 0.5, 30);
    expect(bugStrength).toBeLessThan(decisionStrength);
  });

  it("higher importance decays slower in absolute terms", () => {
    const high = calculateStrength("context", 0.9, 30);
    const low = calculateStrength("context", 0.3, 30);
    expect(high).toBeGreaterThan(low);
  });

  it("clamps to 0-1 range", () => {
    const strength = calculateStrength("decision", 1.0, 0);
    expect(strength).toBeLessThanOrEqual(1);
    expect(strength).toBeGreaterThanOrEqual(0);
  });
});

describe("shouldPrune", () => {
  it("returns false for recent memories", () => {
    expect(shouldPrune("decision", 0.5, 0)).toBe(false);
  });

  it("returns true for very old low-importance memories", () => {
    expect(shouldPrune("bug", 0.1, 365)).toBe(true);
  });

  it("returns false for high-importance even if old", () => {
    expect(shouldPrune("decision", 1.0, 100)).toBe(false);
  });
});

describe("DECAY_RATES", () => {
  it("has a rate for every memory type", () => {
    expect(DECAY_RATES.decision).toBe(0.01);
    expect(DECAY_RATES.preference).toBe(0.015);
    expect(DECAY_RATES.context).toBe(0.03);
    expect(DECAY_RATES.bug).toBe(0.05);
    expect(DECAY_RATES.pattern).toBe(0.02);
    expect(DECAY_RATES.architecture).toBe(0.01);
  });
});
