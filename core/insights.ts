// STUB — placeholder for the frozen `allInsights` API so the Home dashboard typechecks in this tree.
// The real core/insights.ts replaces this file wholesale on merge.
import type { Driver } from "./schema";

export type Insight = {
  id: string;
  kind: string;
  text: string;
  source: { lens: string; filter: Record<string, unknown> };
  n: number;
};

export const allInsights = async (_d: Driver, _now: number): Promise<Insight[]> => [];
