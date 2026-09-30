import {
  PW_COLUMN_DEFAULTS,
  PW_COLUMN_MAX,
  PW_COLUMN_MIN,
  PW_COLUMN_STORAGE_KEY,
  clampColumnWidth,
  readColumnWidths,
} from "./columnWidths";

describe("column widths", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clamps a width to the allowed range", () => {
    expect(clampColumnWidth(10.4, 80, 800)).toBe(80);
    expect(clampColumnWidth(240.2, 80, 800)).toBe(240);
    expect(clampColumnWidth(900, 80, 800)).toBe(800);
  });

  it("reads stored widths and ignores invalid values", () => {
    localStorage.setItem(
      PW_COLUMN_STORAGE_KEY,
      JSON.stringify({ vendor: 320, copy: 10, account: "wide", extra: 50 }),
    );

    expect(readColumnWidths(PW_COLUMN_STORAGE_KEY, PW_COLUMN_DEFAULTS, PW_COLUMN_MIN, PW_COLUMN_MAX)).toEqual({
      ...PW_COLUMN_DEFAULTS,
      vendor: 320,
      copy: PW_COLUMN_MIN.copy,
    });
  });

  it("falls back to defaults when storage is empty or corrupt", () => {
    expect(readColumnWidths(PW_COLUMN_STORAGE_KEY, PW_COLUMN_DEFAULTS, PW_COLUMN_MIN, PW_COLUMN_MAX)).toEqual(
      PW_COLUMN_DEFAULTS,
    );

    localStorage.setItem(PW_COLUMN_STORAGE_KEY, "{");
    expect(readColumnWidths(PW_COLUMN_STORAGE_KEY, PW_COLUMN_DEFAULTS, PW_COLUMN_MIN, PW_COLUMN_MAX)).toEqual(
      PW_COLUMN_DEFAULTS,
    );
  });
});
