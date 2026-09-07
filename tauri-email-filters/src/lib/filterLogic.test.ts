import {
  applyPropertyChange,
  buildFilterReport,
  createEmptyFilter,
  deleteFilterAt,
  dragReorder,
  duplicateFilterAt,
  filterEntriesBySearch,
  formatCondition,
  getFileName,
  insertFilterAt,
  moveFilter,
  parseInsertPosition,
  shouldIgnorePointerDown,
} from "./filterLogic";
import { alice, bob } from "../test/fixtures";

describe("getFileName", () => {
  it("extracts names from unix and windows paths", () => {
    expect(getFileName("/tmp/mailFilters.xml")).toBe("mailFilters.xml");
    expect(getFileName("C:\\\\Users\\\\marc\\\\filters.xml")).toBe("filters.xml");
    expect(getFileName("alone.xml")).toBe("alone.xml");
  });
});

describe("formatCondition and reports", () => {
  it("wraps values that contain punctuation or spaces", () => {
    expect(formatCondition("")).toBe("");
    expect(formatCondition("work")).toBe("work");
    expect(formatCondition("alice@example.com")).toBe("(alice@example.com)");
    expect(formatCondition("Invoice 2026")).toBe("(Invoice 2026)");
    expect(formatCondition("a-b")).toBe("(a-b)");
  });

  it("builds a numbered human-readable report", () => {
    const report = buildFilterReport([alice, bob, { ...alice, id: "3", properties: {} }]);
    expect(report).toContain("The following filters are applied to all incoming mail:");
    expect(report).toContain("Filter #1: from:(alice@example.com)");
    expect(report).toContain("Filter #2: to:(bob@example.com) subject:(Invoice 2026)");
    expect(report).toContain("Filter #3: ");
  });
});

describe("search, property edits, and list mutations", () => {
  it("filters by id and property values", () => {
    expect(filterEntriesBySearch([alice, bob], "").map((r) => r.originalIdx)).toEqual([0, 1]);
    expect(filterEntriesBySearch([alice, bob], "   ").map((r) => r.originalIdx)).toEqual([0, 1]);
    expect(filterEntriesBySearch([alice, bob], "alice").map((r) => r.originalIdx)).toEqual([0]);
    expect(filterEntriesBySearch([alice, bob], "filter:2").map((r) => r.originalIdx)).toEqual([1]);
    expect(filterEntriesBySearch([alice, bob], "zzz")).toHaveLength(0);
  });

  it("sets and clears properties", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const updated = applyPropertyChange([alice], 0, "from", "new@x.com", now);
    expect(updated[0].properties.from).toBe("new@x.com");
    expect(updated[0].updated).toBe("2026-03-01T12:00:00Z");
    const cleared = applyPropertyChange(updated, 0, "from", "", now);
    expect(cleared[0].properties.from).toBeUndefined();
  });

  it("creates, inserts, duplicates, and deletes filters", () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const created = createEmptyFilter(now);
    expect(created.properties).toEqual({ sizeOperator: "s_sl", sizeUnit: "s_smb" });
    expect(created.id).toContain(String(now.getTime()));

    const inserted = insertFilterAt([alice, bob], created, 1);
    expect(inserted.map((e) => e.id)).toEqual([alice.id, created.id, bob.id]);

    const dup = duplicateFilterAt([alice, bob], 0, now);
    expect(dup.selectedIdx).toBe(1);
    expect(dup.entries[1].properties).toEqual(alice.properties);
    expect(dup.entries[1].id).not.toBe(alice.id);

    expect(deleteFilterAt([alice, bob], 0, 0).selectedIdx).toBe(0);
    expect(deleteFilterAt([alice], 0, 0).selectedIdx).toBeNull();
    expect(deleteFilterAt([alice, bob], 0, 1).selectedIdx).toBe(0);
    expect(deleteFilterAt([alice, bob], 1, 0).selectedIdx).toBe(0);
  });

  it("moves and drag-reorders filters", () => {
    expect(moveFilter([alice, bob], 0, "up", 0)).toBeNull();
    expect(moveFilter([alice, bob], 1, "down", 1)).toBeNull();
    expect(moveFilter([alice, bob], 1, "up", 1)?.entries.map((e) => e.id)).toEqual([bob.id, alice.id]);
    expect(moveFilter([alice, bob], 1, "up", 1)?.selectedIdx).toBe(0);
    expect(moveFilter([alice, bob], 1, "up", 0)?.selectedIdx).toBe(1);
    expect(moveFilter([alice, bob], 0, "down", 0)?.selectedIdx).toBe(1);
    expect(dragReorder([alice, bob], 0, 1).map((e) => e.id)).toEqual([bob.id, alice.id]);
  });

  it("parses insert positions and pointer-down targets", () => {
    expect(parseInsertPosition(null, 2)).toBe("cancel");
    expect(parseInsertPosition("  ", 2)).toBe("cancel");
    expect(parseInsertPosition("0", 2)).toBe("invalid");
    expect(parseInsertPosition("9", 2)).toBe("invalid");
    expect(parseInsertPosition("abc", 2)).toBe("invalid");
    expect(parseInsertPosition("2", 2)).toBe(1);

    const button = document.createElement("button");
    expect(shouldIgnorePointerDown(button)).toBe(true);
    const input = document.createElement("input");
    expect(shouldIgnorePointerDown(input)).toBe(true);
    const select = document.createElement("select");
    expect(shouldIgnorePointerDown(select)).toBe(true);
    const wrap = document.createElement("div");
    wrap.className = "entry-actions";
    const inner = document.createElement("span");
    wrap.appendChild(inner);
    expect(shouldIgnorePointerDown(inner)).toBe(true);
    const iconWrap = document.createElement("div");
    iconWrap.className = "icon-btn";
    const iconInner = document.createElement("span");
    iconWrap.appendChild(iconInner);
    expect(shouldIgnorePointerDown(iconInner)).toBe(true);
    expect(shouldIgnorePointerDown(document.createElement("div"))).toBe(false);
  });
});
