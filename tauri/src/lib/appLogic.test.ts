import {
  CALENDAR_DAY_PREVIEW_COUNT,
  MONTHS,
  PERIOD_LABELS,
  PW_ALLOWED_CHARS,
  clampPaneWidth,
  createPassword,
  filterAndSortPasswords,
  filterAndSortSubscriptions,
  formatPeriod,
  getOrdinalDay,
  getSubsForDay,
  monthMatchesPeriod,
  mostUsedCategoryForVendor,
  parseDueDateToNumber,
  parseDueMonthName,
  passwordMatchesSearch,
  periodUsesDueMonth,
  sortExpenses,
} from "./appLogic";
import type { Expense, PasswordRecord, SubscriptionRecord } from "../types";

const pw = (overrides: Partial<PasswordRecord> = {}): PasswordRecord => ({
  vendor: "GitHub",
  account: "marc",
  pw: "x",
  memo: "work",
  ...overrides,
});

const sub = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  name: "Netflix",
  account: "home",
  amount: "$15",
  dueDate: "15th",
  memo: "",
  period: "monthly",
  status: "active",
  ...overrides,
});

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  localId: 1,
  remoteId: null,
  vendorName: "Costco",
  vendorId: 1,
  categoryId: 1,
  categoryName: "Food",
  amount: "10",
  date: "2026-01-01",
  memo: "a",
  userId: "u",
  ...overrides,
});

describe("period helpers", () => {
  it("formats known periods and defaults unknown/empty to monthly", () => {
    expect(formatPeriod("monthly")).toBe("Monthly");
    expect(formatPeriod("annual")).toBe("Annual");
    expect(formatPeriod("every_two_months")).toBe("Every two months");
    expect(formatPeriod(undefined)).toBe(PERIOD_LABELS.monthly);
    expect(formatPeriod("weekly")).toBe(PERIOD_LABELS.monthly);
  });

  it("knows which periods store a due month", () => {
    expect(periodUsesDueMonth("annual")).toBe(true);
    expect(periodUsesDueMonth("every_two_months")).toBe(true);
    expect(periodUsesDueMonth("monthly")).toBe(false);
    expect(periodUsesDueMonth(undefined)).toBe(false);
  });

  it("parses month names case-insensitively", () => {
    expect(parseDueMonthName("March 10th")).toBe("March");
    expect(parseDueMonthName("due in january")).toBe("January");
    expect(parseDueMonthName("15th")).toBeUndefined();
    expect(MONTHS).toHaveLength(12);
  });

  it("matches calendar months by period", () => {
    expect(monthMatchesPeriod("monthly", "15th", 8)).toBe(true);
    expect(monthMatchesPeriod(undefined, "15th", 3)).toBe(true);
    expect(monthMatchesPeriod("annual", "March 10th", 2)).toBe(true);
    expect(monthMatchesPeriod("annual", "March 10th", 3)).toBe(false);
    expect(monthMatchesPeriod("annual", "10th", 2)).toBe(false);
    expect(monthMatchesPeriod("every_two_months", "January 1st", 0)).toBe(true);
    expect(monthMatchesPeriod("every_two_months", "January 1st", 1)).toBe(false);
    expect(monthMatchesPeriod("every_two_months", "January 1st", 2)).toBe(true);
    expect(monthMatchesPeriod("every_two_months", "February 1st", 0)).toBe(false);
    expect(monthMatchesPeriod("every_two_months", "February 1st", 11)).toBe(true);
    expect(monthMatchesPeriod("every_two_months", "1st", 0)).toBe(true);
  });
});

describe("ordinal and due-date parsing", () => {
  it("builds English ordinals including teen and 21+ edge cases", () => {
    expect(getOrdinalDay(1)).toBe("1st");
    expect(getOrdinalDay(2)).toBe("2nd");
    expect(getOrdinalDay(3)).toBe("3rd");
    expect(getOrdinalDay(4)).toBe("4th");
    expect(getOrdinalDay(11)).toBe("11th");
    expect(getOrdinalDay(12)).toBe("12th");
    expect(getOrdinalDay(13)).toBe("13th");
    expect(getOrdinalDay(21)).toBe("21st");
    expect(getOrdinalDay(22)).toBe("22nd");
    expect(getOrdinalDay(23)).toBe("23rd");
    expect(getOrdinalDay(31)).toBe("31st");
  });

  it("parses due dates from ISO, slash, ordinal, and fallbacks", () => {
    expect(parseDueDateToNumber("")).toBe(999);
    expect(parseDueDateToNumber("2026-03-10")).toBe(new Date(Date.parse("2026-03-10")).getDate());
    expect(parseDueDateToNumber("03/10/2026")).toBe(new Date(Date.parse("03/10/2026")).getDate());
    expect(parseDueDateToNumber("22nd")).toBe(22);
    expect(parseDueDateToNumber("no-digits-here")).toBe(999);
    expect(parseDueDateToNumber("not a date")).toBe(999);
    expect(parseDueDateToNumber("???")).toBe(999);
  });
});

describe("password helpers", () => {
  it("creates passwords of the requested length from the allowed charset", () => {
    let i = 0;
    const password = createPassword(12, () => {
      const value = (i % PW_ALLOWED_CHARS.length) / PW_ALLOWED_CHARS.length;
      i += 1;
      return value;
    });
    expect(password).toHaveLength(12);
    expect([...password].every((ch) => PW_ALLOWED_CHARS.includes(ch))).toBe(true);
    expect(createPassword(14)).toHaveLength(14);
  });

  it("matches search against vendor, account, and memo", () => {
    expect(passwordMatchesSearch(pw(), "git")).toBe(true);
    expect(passwordMatchesSearch(pw(), "MARC")).toBe(true);
    expect(passwordMatchesSearch(pw(), "work")).toBe(true);
    expect(passwordMatchesSearch(pw({ memo: undefined }), "work")).toBe(false);
    expect(passwordMatchesSearch(pw(), "nope")).toBe(false);
  });

  it("filters and sorts passwords, including equal-vendor ties", () => {
    const map = {
      a: pw({ vendor: "Zebra", account: "z" }),
      b: pw({ vendor: "Apple", account: "a" }),
      c: pw({ vendor: "Apple", account: "b", memo: "design" }),
    };
    const asc = filterAndSortPasswords(map, "", true);
    expect(asc.map(([, r]) => r.account)).toEqual(["a", "b", "z"]);
    const desc = filterAndSortPasswords(map, "", false);
    expect(desc[0][1].vendor).toBe("Zebra");
    expect(filterAndSortPasswords(map, "design", true)).toHaveLength(1);
  });
});

describe("subscription filtering and calendar", () => {
  it("filters by search and status, then sorts by due day", () => {
    const map = {
      a: sub({ name: "Netflix", dueDate: "20th", status: "active" }),
      b: sub({ name: "Adobe", dueDate: "1st", status: "inactive", account: "work" }),
      c: sub({ name: "Hulu", dueDate: "1st", status: "active" }),
    };
    const active = filterAndSortSubscriptions(map, "", "active", true);
    expect(active.map(([, r]) => r.name)).toEqual(["Hulu", "Netflix"]);
    const inactive = filterAndSortSubscriptions(map, "", "inactive", true);
    expect(inactive).toHaveLength(1);
    const allDesc = filterAndSortSubscriptions(map, "", "all", false);
    expect(allDesc[0][1].name).toBe("Netflix");
    expect(filterAndSortSubscriptions(map, "work", "all", true)).toHaveLength(1);
    expect(filterAndSortSubscriptions(map, "zzz", "all", true)).toHaveLength(0);
  });

  it("places monthly, annual, dated, searched, and overflow subscriptions", () => {
    const map: Record<string, SubscriptionRecord> = {
      monthly: sub({ name: "Netflix", dueDate: "15th" }),
      inactive: sub({ name: "Quiet", dueDate: "15th", status: "inactive" }),
      annual: sub({ name: "Domain", dueDate: "March 10th", period: "annual" }),
      dated: sub({ name: "OneOff", dueDate: "02/28/2026" }),
      slash: sub({ name: "Tax", dueDate: "02/01/2026" }),
      overflow: sub({ name: "Rent", dueDate: "31st" }),
      noday: sub({ name: "Mystery", dueDate: "sometime" }),
    };

    expect(getSubsForDay(15, map, 2026, 0, "active", "").map(([, s]) => s.name)).toEqual([
      "Netflix",
    ]);
    expect(getSubsForDay(15, map, 2026, 0, "all", "").map(([, s]) => s.name)).toEqual([
      "Netflix",
      "Quiet",
    ]);
    expect(getSubsForDay(15, map, 2026, 0, "active", "net").map(([, s]) => s.name)).toEqual([
      "Netflix",
    ]);
    expect(getSubsForDay(15, map, 2026, 0, "active", "zzz")).toHaveLength(0);
    expect(getSubsForDay(10, map, 2026, 2, "active", "").map(([, s]) => s.name)).toEqual([
      "Domain",
    ]);
    expect(getSubsForDay(10, map, 2026, 3, "active", "")).toHaveLength(0);
    expect(getSubsForDay(28, map, 2026, 1, "active", "").map(([, s]) => s.name)).toEqual([
      "OneOff",
      "Rent*",
    ]);
    expect(getSubsForDay(1, map, 2026, 1, "active", "").map(([, s]) => s.name)).toEqual(["Tax"]);
    expect(getSubsForDay(3, map, 2026, 0, "active", "")).toHaveLength(0);
    expect(CALENDAR_DAY_PREVIEW_COUNT).toBe(4);
  });
});

describe("expense helpers", () => {
  it("sorts by date, vendor, amount, and memo in both directions", () => {
    const rows = [
      expense({ localId: 1, vendorName: "Zebra", amount: "5", date: "2026-03-01", memo: "c" }),
      expense({ localId: 2, vendorName: "Apple", amount: "20", date: "2026-01-01", memo: "a" }),
      expense({ localId: 3, vendorName: "Apple", amount: "bad", date: "nope", memo: null }),
    ];
    expect(sortExpenses(rows, "v", true).map((e) => e.vendorName)).toEqual([
      "Apple",
      "Apple",
      "Zebra",
    ]);
    expect(sortExpenses(rows, "v", false)[0].vendorName).toBe("Zebra");
    expect(sortExpenses(rows, "a", true)[0].amount).toBe("bad");
    expect(sortExpenses(rows, "d", true)[0].date).toBe("nope");
    expect(sortExpenses(rows, "m", true).map((e) => e.memo)).toEqual([null, "a", "c"]);
    expect(sortExpenses(rows, "m", false)[0].memo).toBe("c");
  });

  it("picks the most-used category for a vendor", () => {
    const rows = [
      expense({ vendorName: "Costco", categoryName: "Food" }),
      expense({ vendorName: "Costco", categoryName: "Food" }),
      expense({ vendorName: "Costco", categoryName: "Household" }),
      expense({ vendorName: "Uber", categoryName: "Travel" }),
      expense({ vendorName: "Costco", categoryName: "" }),
    ];
    expect(mostUsedCategoryForVendor(rows, "costco")).toBe("Food");
    expect(mostUsedCategoryForVendor(rows, "Nope")).toBe("");
  });

  it("clamps pane widths", () => {
    expect(clampPaneWidth(10)).toBe(150);
    expect(clampPaneWidth(240)).toBe(240);
    expect(clampPaneWidth(900)).toBe(500);
    expect(clampPaneWidth(20, 10, 30)).toBe(20);
  });
});
