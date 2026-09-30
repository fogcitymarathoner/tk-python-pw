import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

export const PW_COLUMN_KEYS = ["copy", "vendor", "account", "password", "memo"] as const;
export type PwColumnKey = (typeof PW_COLUMN_KEYS)[number];

export const PW_COLUMN_STORAGE_KEY = "pw-column-widths";

export const PW_COLUMN_DEFAULTS: Record<PwColumnKey, number> = {
  copy: 156,
  vendor: 180,
  account: 200,
  password: 180,
  memo: 220,
};

export const PW_COLUMN_MIN: Record<PwColumnKey, number> = {
  copy: 140,
  vendor: 80,
  account: 80,
  password: 80,
  memo: 80,
};

export const PW_COLUMN_MAX = 800;

export function clampColumnWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function readColumnWidths<T extends string>(
  storageKey: string,
  defaults: Record<T, number>,
  min: Record<T, number>,
  max: number,
): Record<T, number> {
  const widths = { ...defaults };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return widths;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return widths;
    for (const key of Object.keys(defaults) as T[]) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[key] = clampColumnWidth(value, min[key], max);
      }
    }
  } catch {
    return { ...defaults };
  }
  return widths;
}

export function useColumnWidths<T extends string>(
  storageKey: string,
  defaults: Record<T, number>,
  min: Record<T, number>,
  max: number,
) {
  const [widths, setWidths] = useState(() => readColumnWidths(storageKey, defaults, min, max));
  const [resizing, setResizing] = useState<T | null>(null);
  const drag = useRef<{ key: T; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

  const onResizeStart = useCallback((key: T, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { key, startX: event.clientX, startWidth: widths[key] };
    setResizing(key);
  }, [widths]);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: MouseEvent) => {
      const current = drag.current;
      if (!current) return;
      const next = clampColumnWidth(
        current.startWidth + event.clientX - current.startX,
        min[current.key],
        max,
      );
      setWidths((prev) => (prev[current.key] === next ? prev : { ...prev, [current.key]: next }));
    };

    const onUp = () => {
      drag.current = null;
      setResizing(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, min, max]);

  return { widths, resizing, onResizeStart };
}
