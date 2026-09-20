import { toDateInput } from "./logFormat";

export function parseLogDate(value: string): Date | null {
  const iso = toDateInput(value);
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfWeek(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - weekday);
  return next;
}

export function sameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWeekLabel(date: Date): string {
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const startText = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endText = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startText} – ${endText}`;
}

export type PeriodLevel = "month" | "week" | "day";

export function periodBounds(cursor: Date, level: PeriodLevel): { start: Date; end: Date } {
  if (level === "day") {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    return { start, end: start };
  }
  if (level === "week") {
    const start = startOfWeek(cursor);
    return { start, end: addDays(start, 6) };
  }
  const start = startOfMonth(cursor);
  const end = addDays(startOfMonth(addMonths(start, 1)), -1);
  return { start, end };
}

export function inBounds(date: Date, start: Date, end: Date): boolean {
  const iso = toIsoDate(date);
  return iso >= toIsoDate(start) && iso <= toIsoDate(end);
}

export function latestLogDate(entries: Array<{ date: string }>): Date {
  let latest: Date | null = null;
  for (const entry of entries) {
    const date = parseLogDate(entry.date);
    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }
  return latest ?? new Date();
}
