import {
  formatPct,
  fromDateInput,
  inferWorkoutTotal,
  isWorkoutName,
  milesFromMeters,
  parseNumber,
  percentOf,
  summarizeWorkoutSets,
  toDateInput,
  todayInput,
} from "./logFormat";
import type { SwimWorkoutSet } from "../types";

function set(partial: Partial<SwimWorkoutSet> & Pick<SwimWorkoutSet, "id" | "distance">): SwimWorkoutSet {
  return {
    remoteId: null,
    workoutId: 1,
    description: "",
    splitTotal: "",
    equipment: "",
    fins: "",
    sortOrder: 0,
    ...partial,
  };
}

describe("summarizeWorkoutSets", () => {
  it("sums set meters and gear columns, skipping the sheet total row", () => {
    const totals = summarizeWorkoutSets([
      { distance: "100", description: "kick with board", equipment: "100", fins: "" },
      { distance: "200", description: "buoy drill", equipment: "200", fins: "" },
      { distance: "150", description: "breast drill", equipment: "50", fins: "150" },
      { distance: "100", description: "free", equipment: "", fins: "" },
      { distance: "550", description: "", equipment: "350", fins: "150" },
      { distance: "km to miles", description: "0.62137119", equipment: "", fins: "" },
    ]);

    expect(totals.total).toBe(550);
    expect(totals.equipment).toBe(350);
    expect(totals.fins).toBe(150);
    expect(totals.totalPct).toBe(100);
    expect(totals.equipmentPct).toBe(63.6);
    expect(totals.finsPct).toBe(27.3);
  });

  it("treats a non-numeric gear flag as the full set distance", () => {
    const totals = summarizeWorkoutSets([
      { distance: "200", description: "paddles", equipment: "paddles", fins: "yes" },
    ]);
    expect(totals).toMatchObject({ total: 200, equipment: 200, fins: 200, equipmentPct: 100, finsPct: 100 });
  });
});

describe("parseNumber", () => {
  it("reads a plain number", () => {
    expect(parseNumber("2500")).toBe(2500);
  });

  it("strips units and commas", () => {
    expect(parseNumber("1,800 m")).toBe(1800);
  });

  it("returns 0 for empty or junk", () => {
    expect(parseNumber("")).toBe(0);
    expect(parseNumber("abc")).toBe(0);
  });
});

describe("milesFromMeters", () => {
  it("converts meters to miles", () => {
    expect(milesFromMeters("2500")).toBe("1.55");
    expect(milesFromMeters("3200")).toBe("1.99");
  });

  it("returns empty for zero", () => {
    expect(milesFromMeters("")).toBe("");
    expect(milesFromMeters("0")).toBe("");
  });
});

describe("toDateInput / fromDateInput", () => {
  it("parses M/D/YYYY into an ISO date field", () => {
    expect(toDateInput("6/4/2025")).toBe("2025-06-04");
    expect(toDateInput("7/15/2025")).toBe("2025-07-15");
  });

  it("pads single-digit months and days", () => {
    expect(toDateInput("1/2/2025")).toBe("2025-01-02");
  });

  it("expands a two-digit year", () => {
    expect(toDateInput("6/4/25")).toBe("2025-06-04");
  });

  it("uses the current year when none is given", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-19T12:00:00"));
    expect(toDateInput("9/19")).toBe("2026-09-19");
    jest.useRealTimers();
  });

  it("returns empty for a non-date", () => {
    expect(toDateInput("Tuesday")).toBe("");
    expect(toDateInput("")).toBe("");
  });

  it("round-trips an ISO date back to the sheet format", () => {
    expect(fromDateInput("2025-07-15")).toBe("7/15/2025");
    expect(fromDateInput("2025-06-04")).toBe("6/4/2025");
  });

  it("keeps an already ISO date", () => {
    expect(toDateInput("2025-07-15")).toBe("2025-07-15");
  });
});

describe("todayInput", () => {
  it("returns today's date in ISO form", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-19T08:00:00"));
    expect(todayInput()).toBe("2026-09-19");
    jest.useRealTimers();
  });
});

describe("isWorkoutName", () => {
  it("matches Workout N names", () => {
    expect(isWorkoutName("Workout 2")).toBe(true);
    expect(isWorkoutName("workout 15")).toBe(true);
  });

  it("rejects notes that are not workout names", () => {
    expect(isWorkoutName("Red Cross 15 mile - Workout 2")).toBe(false);
    expect(isWorkoutName("easy swim")).toBe(false);
  });
});

describe("inferWorkoutTotal", () => {
  it("uses the last unlabeled distance row as the total", () => {
    expect(
      inferWorkoutTotal([
        set({ id: 1, distance: "100", description: "kick" }),
        set({ id: 2, distance: "300", description: "fly" }),
        set({ id: 3, distance: "2500" }),
      ]),
    ).toEqual({ meters: "2500", miles: "1.55" });
  });

  it("returns empty when every set has a description", () => {
    expect(
      inferWorkoutTotal([
        set({ id: 1, distance: "100", description: "kick" }),
        set({ id: 2, distance: "300", description: "fly" }),
      ]),
    ).toEqual({ meters: "", miles: "" });
  });
});

describe("percent helpers", () => {
  it("rounds to one decimal and formats clean integers", () => {
    expect(percentOf(550, 2500)).toBe(22);
    expect(percentOf(10, 0)).toBe(0);
    expect(formatPct(22)).toBe("22%");
    expect(formatPct(63.6)).toBe("63.6%");
  });
});

describe("summarize edge rows", () => {
  it("skips a miles conversion row labeled in the description", () => {
    const totals = summarizeWorkoutSets([
      { distance: "200", description: "free", equipment: "", fins: "" },
      { distance: "0.12", description: "km to miles", equipment: "", fins: "" },
    ]);
    expect(totals.total).toBe(200);
  });

  it("does not treat a lone unlabeled distance as a trailing total", () => {
    expect(summarizeWorkoutSets([{ distance: "2500", description: "", equipment: "", fins: "" }])).toMatchObject({
      total: 2500,
      totalPct: 100,
    });
  });
});
