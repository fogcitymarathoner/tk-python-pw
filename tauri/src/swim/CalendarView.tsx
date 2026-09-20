import { useMemo } from "react";
import {
  addDays,
  addMonths,
  formatDayLabel,
  formatMonthYear,
  formatWeekLabel,
  inBounds,
  parseLogDate,
  periodBounds,
  sameDay,
  startOfMonth,
  startOfWeek,
  toIsoDate,
  type PeriodLevel,
} from "./calendar";
import { parseNumber } from "./logFormat";
import type { SwimSession } from "../types";

type DayTotal = {
  date: Date;
  meters: number;
  miles: number;
  sessions: number;
  entries: SwimSession[];
};

type Props = {
  entries: SwimSession[];
  cursor: Date;
  level: PeriodLevel;
  onCursor: (date: Date) => void;
  onLevel: (level: PeriodLevel) => void;
  onOpenEntry: (entry: SwimSession) => void;
  onAddForDate: (isoDate: string) => void;
};

function datedEntries(entries: SwimSession[]): Array<{ entry: SwimSession; date: Date }> {
  return entries.flatMap((entry) => {
    const date = parseLogDate(entry.date);
    return date ? [{ entry, date }] : [];
  });
}

function totalsFor(list: SwimSession[]) {
  return list.reduce(
    (acc, entry) => {
      acc.sessions += 1;
      acc.meters += parseNumber(entry.meters);
      acc.miles += parseNumber(entry.miles);
      return acc;
    },
    { sessions: 0, meters: 0, miles: 0 },
  );
}

function dayMap(entries: SwimSession[]): Map<string, DayTotal> {
  const map = new Map<string, DayTotal>();
  for (const { entry, date } of datedEntries(entries)) {
    const key = toIsoDate(date);
    const current = map.get(key) ?? {
      date,
      meters: 0,
      miles: 0,
      sessions: 0,
      entries: [],
    };
    current.meters += parseNumber(entry.meters);
    current.miles += parseNumber(entry.miles);
    current.sessions += 1;
    current.entries.push(entry);
    map.set(key, current);
  }
  return map;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarView({
  entries,
  cursor,
  level,
  onCursor,
  onLevel,
  onOpenEntry,
  onAddForDate,
}: Props) {
  const days = useMemo(() => dayMap(entries), [entries]);
  const bounds = periodBounds(cursor, level);
  const periodEntries = useMemo(
    () =>
      datedEntries(entries)
        .filter(({ date }) => inBounds(date, bounds.start, bounds.end))
        .map(({ entry }) => entry),
    [bounds.end, bounds.start, entries],
  );
  const period = totalsFor(periodEntries);

  const monthGrid = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    return Array.from({ length: 6 }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
    );
  }, [cursor]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index)),
    [cursor],
  );

  function shift(delta: number) {
    if (level === "month") onCursor(addMonths(cursor, delta));
    else if (level === "week") onCursor(addDays(cursor, delta * 7));
    else onCursor(addDays(cursor, delta));
  }

  const title =
    level === "month"
      ? formatMonthYear(cursor)
      : level === "week"
        ? formatWeekLabel(cursor)
        : formatDayLabel(cursor);

  return (
    <div className="calendar">
      <div className="calendar-bar">
        <div className="calendar-nav">
          <button type="button" className="secondary" onClick={() => shift(-1)}>
            ‹
          </button>
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="mode-toggle" role="group" aria-label="Calendar range">
          {(["month", "week", "day"] as PeriodLevel[]).map((item) => (
            <button
              key={item}
              type="button"
              className={level === item ? "active" : undefined}
              onClick={() => onLevel(item)}
            >
              {item[0]?.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <ol className="crumb">
        <li>
          <button type="button" onClick={() => onLevel("month")}>
            {formatMonthYear(cursor)}
          </button>
        </li>
        {level !== "month" ? (
          <li>
            <button type="button" onClick={() => onLevel("week")}>
              Week of {startOfWeek(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </button>
          </li>
        ) : null}
        {level === "day" ? <li>{formatDayLabel(cursor)}</li> : null}
      </ol>

      <section aria-label="Period totals">
        <dl className="stats period-stats">
          <div>
            <dt>Sessions</dt>
            <dd>{period.sessions}</dd>
          </div>
          <div>
            <dt>Meters</dt>
            <dd>{period.meters.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Miles</dt>
            <dd>{period.miles.toFixed(2)}</dd>
          </div>
        </dl>
      </section>

      {level === "month" ? (
        <div className="month-grid">
          <div className="month-weekdays">
            {WEEKDAYS.map((name) => (
              <div key={name}>{name}</div>
            ))}
            <div>Week</div>
          </div>
          {monthGrid.map((week, weekIndex) => {
            const weekMeters = week.reduce(
              (sum, date) => sum + (days.get(toIsoDate(date))?.meters ?? 0),
              0,
            );
            const weekSessions = week.reduce(
              (sum, date) => sum + (days.get(toIsoDate(date))?.sessions ?? 0),
              0,
            );
            return (
              <div key={weekIndex} className="month-week">
                {week.map((date) => {
                  const info = days.get(toIsoDate(date));
                  const outside = date.getMonth() !== cursor.getMonth();
                  return (
                    <button
                      key={toIsoDate(date)}
                      type="button"
                      aria-label={
                        info
                          ? `${toIsoDate(date)}, ${info.meters.toLocaleString()} meters`
                          : `${toIsoDate(date)}, no swim`
                      }
                      className={`day-cell${outside ? " outside" : ""}${sameDay(date, cursor) ? " selected" : ""}${info ? " has-swim" : ""}`}
                      onClick={() => {
                        onCursor(date);
                        onLevel("day");
                      }}
                    >
                      <span className="day-num">{date.getDate()}</span>
                      {info ? (
                        <span className="day-m">{info.meters.toLocaleString()}</span>
                      ) : (
                        <span className="day-m muted">—</span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-label={
                    week[0]
                      ? `Week of ${toIsoDate(week[0])}, ${weekMeters.toLocaleString()} meters, ${weekSessions} session${weekSessions === 1 ? "" : "s"}`
                      : "Week total"
                  }
                  className={`week-total${weekSessions ? " has-swim" : ""}`}
                  onClick={() => {
                    onCursor(week[0] ?? cursor);
                    onLevel("week");
                  }}
                >
                  <span className="day-m">{weekMeters ? weekMeters.toLocaleString() : "—"}</span>
                  <span className="muted">{weekSessions ? `${weekSessions} sess` : " "}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {level === "week" ? (
        <div className="week-grid">
          {weekDays.map((date) => {
            const info = days.get(toIsoDate(date));
            return (
              <button
                key={toIsoDate(date)}
                type="button"
                aria-label={
                  info
                    ? `${toIsoDate(date)}, ${info.sessions} session${info.sessions === 1 ? "" : "s"}, ${info.meters.toLocaleString()} meters`
                    : `${toIsoDate(date)}, no swim`
                }
                className={`week-cell${sameDay(date, cursor) ? " selected" : ""}${info ? " has-swim" : ""}`}
                onClick={() => {
                  onCursor(date);
                  onLevel("day");
                }}
              >
                <strong>
                  {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </strong>
                <span>{info ? `${info.sessions} session${info.sessions === 1 ? "" : "s"}` : "No swim"}</span>
                <span className="num">{info ? `${info.meters.toLocaleString()} m` : "—"}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {level === "day" ? (
        <div className="day-detail">
          <div className="editor-actions">
            <button type="button" onClick={() => onAddForDate(toIsoDate(cursor))}>
              Add session this day
            </button>
          </div>
          {periodEntries.length === 0 ? (
            <p className="muted">No swims on this day.</p>
          ) : (
            <ul className="day-sessions">
              {periodEntries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-label={`${parseNumber(entry.meters).toLocaleString()} meters, ${entry.note || entry.workoutName || entry.stroke || "Session"}`}
                    onClick={() => onOpenEntry(entry)}
                  >
                    <strong>{parseNumber(entry.meters).toLocaleString()} m</strong>
                    <span>{entry.note || entry.workoutName || entry.stroke || "Session"}</span>
                    <em>{entry.miles || "—"} mi</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
