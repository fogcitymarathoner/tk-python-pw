import type { FilterEntry } from "../xmlService";

export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

export function formatCondition(val: string): string {
  if (!val) return "";
  if (/[.\-@\[\]"\s]/.test(val)) {
    return `(${val})`;
  }
  return val;
}

export function buildFilterReport(entries: FilterEntry[]): string {
  let report = "The following filters are applied to all incoming mail:\n";
  let filterNum = 1;
  for (const entry of entries) {
    const properties = entry.properties;
    const matchParts = [];
    if (properties.from) {
      matchParts.push(`from:${formatCondition(properties.from)}`);
    }
    if (properties.to) {
      matchParts.push(`to:${formatCondition(properties.to)}`);
    }
    if (properties.subject) {
      matchParts.push(`subject:${formatCondition(properties.subject)}`);
    }
    report += `Filter #${filterNum}: ${matchParts.join(" ")}\n`;
    filterNum++;
  }
  return report;
}

export function filterEntriesBySearch(entries: FilterEntry[], searchTerm: string) {
  if (!searchTerm.trim()) {
    return entries.map((entry, idx) => ({ entry, originalIdx: idx }));
  }
  const query = searchTerm.toLowerCase();
  return entries
    .map((entry, idx) => ({ entry, originalIdx: idx }))
    .filter(({ entry }) => {
      return (
        entry.id.toLowerCase().includes(query) ||
        Object.values(entry.properties).some((val) => val.toLowerCase().includes(query))
      );
    });
}

export function applyPropertyChange(
  entries: FilterEntry[],
  selectedIdx: number,
  name: string,
  val: string,
  now: Date = new Date(),
): FilterEntry[] {
  const updatedEntries = [...entries];
  const updatedProperties = { ...updatedEntries[selectedIdx].properties };

  if (val === "") {
    delete updatedProperties[name];
  } else {
    updatedProperties[name] = val;
  }

  updatedEntries[selectedIdx] = {
    ...updatedEntries[selectedIdx],
    properties: updatedProperties,
    updated: now.toISOString().substring(0, 19) + "Z",
  };

  return updatedEntries;
}

export function createEmptyFilter(now: Date = new Date()): FilterEntry {
  return {
    id: `tag:mail.google.com,2008:filter:z000000${now.getTime()}`,
    title: "Mail Filter",
    updated: now.toISOString().substring(0, 19) + "Z",
    categoryTerm: "filter",
    properties: {
      sizeOperator: "s_sl",
      sizeUnit: "s_smb",
    },
  };
}

export function parseInsertPosition(
  input: string | null,
  length: number,
): number | "cancel" | "invalid" {
  if (input === null) return "cancel";
  const trimmed = input.trim();
  if (trimmed === "") return "cancel";
  const parsedNum = parseInt(trimmed, 10);
  if (isNaN(parsedNum) || parsedNum < 1 || parsedNum > length) return "invalid";
  return parsedNum - 1;
}

export function insertFilterAt(
  entries: FilterEntry[],
  entry: FilterEntry,
  targetIdx: number,
): FilterEntry[] {
  const updated = [...entries];
  updated.splice(targetIdx, 0, entry);
  return updated;
}

export function duplicateFilterAt(
  entries: FilterEntry[],
  idx: number,
  now: Date = new Date(),
): { entries: FilterEntry[]; selectedIdx: number } {
  const source = entries[idx];
  const duplicated: FilterEntry = {
    ...source,
    id: `tag:mail.google.com,2008:filter:z000000${now.getTime()}`,
    updated: now.toISOString().substring(0, 19) + "Z",
    properties: { ...source.properties },
  };
  const updated = [...entries];
  updated.splice(idx + 1, 0, duplicated);
  return { entries: updated, selectedIdx: idx + 1 };
}

export function deleteFilterAt(
  entries: FilterEntry[],
  idx: number,
  selectedIdx: number | null,
): { entries: FilterEntry[]; selectedIdx: number | null } {
  const updated = entries.filter((_, i) => i !== idx);
  let nextSelected = selectedIdx;
  if (selectedIdx === idx) {
    nextSelected = updated.length > 0 ? 0 : null;
  } else if (selectedIdx !== null && selectedIdx > idx) {
    nextSelected = selectedIdx - 1;
  }
  return { entries: updated, selectedIdx: nextSelected };
}

export function moveFilter(
  entries: FilterEntry[],
  idx: number,
  direction: "up" | "down",
  selectedIdx: number | null,
): { entries: FilterEntry[]; selectedIdx: number | null } | null {
  if (direction === "up" && idx === 0) return null;
  if (direction === "down" && idx === entries.length - 1) return null;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  const updated = [...entries];
  const temp = updated[idx];
  updated[idx] = updated[swapWith];
  updated[swapWith] = temp;

  let nextSelected = selectedIdx;
  if (selectedIdx === idx) nextSelected = swapWith;
  else if (selectedIdx === swapWith) nextSelected = idx;
  return { entries: updated, selectedIdx: nextSelected };
}

export function dragReorder(
  entries: FilterEntry[],
  fromIdx: number,
  toIdx: number,
): FilterEntry[] {
  const updated = [...entries];
  const [draggedItem] = updated.splice(fromIdx, 1);
  updated.splice(toIdx, 0, draggedItem);
  return updated;
}

export function shouldIgnorePointerDown(target: HTMLElement): boolean {
  return (
    target.tagName === "BUTTON" ||
    Boolean(target.closest(".entry-actions")) ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    Boolean(target.closest(".icon-btn"))
  );
}
