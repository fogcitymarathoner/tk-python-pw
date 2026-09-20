import type { SwimWorkoutSet } from "../types";

export function parseNumber(value: string): number {
  const n = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function milesFromMeters(meters: string): string {
  const value = parseNumber(meters);
  if (!value) return "";
  return ((value / 1000) * 0.62137119).toFixed(2);
}

export function toDateInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!match) return "";
  const month = match[1] ?? "";
  const day = match[2] ?? "";
  const rawYear = match[3];
  const year = rawYear
    ? rawYear.length === 2
      ? `20${rawYear}`
      : rawYear
    : String(new Date().getFullYear());
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function fromDateInput(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year}`;
}

export function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isWorkoutName(value: string): boolean {
  return /^workout\s*\d+$/i.test(value.trim());
}

export function inferWorkoutTotal(sets: SwimWorkoutSet[]): { meters: string; miles: string } {
  const total = [...sets]
    .reverse()
    .find((set) => set.description.trim() === "" && parseNumber(set.distance) > 0);
  const meters = total?.distance ?? "";
  return { meters, miles: milesFromMeters(meters) };
}

export type WorkoutSetLike = {
  distance: string;
  description: string;
  equipment: string;
  fins: string;
};

export type WorkoutDistanceTotals = {
  total: number;
  equipment: number;
  fins: number;
  totalPct: number;
  equipmentPct: number;
  finsPct: number;
};

function isConversionRow(set: WorkoutSetLike): boolean {
  const distance = set.distance.trim().toLowerCase();
  const description = set.description.trim().toLowerCase();
  return /km to miles|^miles$/.test(distance) || /km to miles|^miles$/.test(description);
}

function trailingTotalIndex(sets: WorkoutSetLike[]): number | null {
  let last = -1;
  for (let index = 0; index < sets.length; index += 1) {
    const set = sets[index];
    if (!set || isConversionRow(set)) continue;
    if (set.description.trim() === "" && parseNumber(set.distance) > 0) {
      last = index;
    }
  }
  if (last <= 0) return null;
  const hasPriorSet = sets.slice(0, last).some((set) => !isConversionRow(set) && parseNumber(set.distance) > 0);
  return hasPriorSet ? last : null;
}

function gearMeters(setDistance: string, gear: string): number {
  const flagged = gear.trim();
  if (!flagged) return 0;
  const explicit = parseNumber(flagged);
  if (explicit > 0) return explicit;
  return parseNumber(setDistance);
}

export function percentOf(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
}

export function summarizeWorkoutSets(sets: WorkoutSetLike[]): WorkoutDistanceTotals {
  const skip = trailingTotalIndex(sets);
  const countable = sets.filter((set, index) => {
    if (isConversionRow(set) || index === skip) return false;
    return parseNumber(set.distance) > 0 || parseNumber(set.equipment) > 0 || parseNumber(set.fins) > 0;
  });
  const total = countable.reduce((sum, set) => sum + parseNumber(set.distance), 0);
  const equipment = countable.reduce((sum, set) => sum + gearMeters(set.distance, set.equipment), 0);
  const fins = countable.reduce((sum, set) => sum + gearMeters(set.distance, set.fins), 0);
  return {
    total,
    equipment,
    fins,
    totalPct: total ? 100 : 0,
    equipmentPct: percentOf(equipment, total),
    finsPct: percentOf(fins, total),
  };
}
