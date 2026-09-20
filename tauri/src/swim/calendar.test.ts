import {
  addDays,
  addMonths,
  formatDayLabel,
  formatMonthYear,
  formatWeekLabel,
  inBounds,
  latestLogDate,
  parseLogDate,
  periodBounds,
  sameDay,
  startOfMonth,
  startOfWeek,
  toIsoDate,
} from "./calendar";

const june4 = new Date(2025, 5, 4);
const july15 = new Date(2025, 6, 15);

describe("parseLogDate / toIsoDate", () => {
  it("parses sheet dates", () => {
    expect(toIsoDate(parseLogDate("6/4/2025")!)).toBe("2025-06-04");
    expect(toIsoDate(parseLogDate("7/15/2025")!)).toBe("2025-07-15");
  });

  it("returns null for junk", () => {
    expect(parseLogDate("nope")).toBeNull();
    expect(parseLogDate("")).toBeNull();
  });
});

describe("week and month helpers", () => {
  it("starts weeks on Monday", () => {
    expect(toIsoDate(startOfWeek(june4))).toBe("2025-06-02");
    expect(toIsoDate(startOfWeek(july15))).toBe("2025-07-14");
  });

  it("starts months on the first", () => {
    expect(toIsoDate(startOfMonth(june4))).toBe("2025-06-01");
  });

  it("shifts days and months", () => {
    expect(toIsoDate(addDays(june4, 6))).toBe("2025-06-10");
    expect(toIsoDate(addMonths(july15, -1))).toBe("2025-06-15");
  });

  it("compares calendar days", () => {
    expect(sameDay(june4, new Date(2025, 5, 4, 18))).toBe(true);
    expect(sameDay(june4, july15)).toBe(false);
  });
});

describe("periodBounds", () => {
  it("covers a single day", () => {
    const { start, end } = periodBounds(july15, "day");
    expect(toIsoDate(start)).toBe("2025-07-15");
    expect(toIsoDate(end)).toBe("2025-07-15");
  });

  it("covers Monday through Sunday", () => {
    const { start, end } = periodBounds(july15, "week");
    expect(toIsoDate(start)).toBe("2025-07-14");
    expect(toIsoDate(end)).toBe("2025-07-20");
  });

  it("covers the whole month", () => {
    const { start, end } = periodBounds(june4, "month");
    expect(toIsoDate(start)).toBe("2025-06-01");
    expect(toIsoDate(end)).toBe("2025-06-30");
  });
});

describe("inBounds", () => {
  it("includes the start and end days", () => {
    const { start, end } = periodBounds(june4, "month");
    expect(inBounds(new Date(2025, 5, 1), start, end)).toBe(true);
    expect(inBounds(new Date(2025, 5, 30), start, end)).toBe(true);
    expect(inBounds(new Date(2025, 6, 1), start, end)).toBe(false);
  });
});

describe("labels", () => {
  it("formats month, week, and day headings", () => {
    expect(formatMonthYear(july15)).toBe("July 2025");
    expect(formatWeekLabel(july15)).toBe("Jul 14 – Jul 20, 2025");
    expect(formatDayLabel(july15)).toBe("Tue, Jul 15, 2025");
  });
});

describe("latestLogDate", () => {
  it("picks the newest dated entry", () => {
    const latest = latestLogDate([
      { date: "6/4/2025" },
      { date: "7/15/2025" },
      { date: "6/28/2025" },
      { date: "" },
    ]);
    expect(toIsoDate(latest)).toBe("2025-07-15");
  });

  it("falls back to now when nothing is dated", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-19T12:00:00"));
    expect(toIsoDate(latestLogDate([{ date: "" }]))).toBe("2026-09-19");
    jest.useRealTimers();
  });
});
