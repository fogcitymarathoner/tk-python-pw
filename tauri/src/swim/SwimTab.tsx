import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import CalendarView from "./CalendarView";
import LogEditor from "./LogEditor";
import WorkoutManager from "./WorkoutManager";
import { latestLogDate, type PeriodLevel } from "./calendar";
import {
  fromDateInput,
  inferWorkoutTotal,
  isWorkoutName,
  milesFromMeters,
  parseNumber,
  toDateInput,
  todayInput,
} from "./logFormat";
import type { SwimDraft, SwimSession, SwimWorkout, SwimWorkoutSet } from "../types";

type Props = {
  uid: string;
  onStatus: (message: string) => void;
};

function emptyDraft(date = todayInput()): SwimDraft {
  return {
    id: null,
    remoteId: null,
    date,
    meters: "",
    miles: "",
    stroke: "",
    note: "",
    extra: "",
    workoutId: null,
    mode: "line",
  };
}

function draftFromSession(session: SwimSession): SwimDraft {
  return {
    id: session.id,
    remoteId: session.remoteId,
    date: toDateInput(session.date) || todayInput(),
    meters: session.meters,
    miles: session.miles,
    stroke: session.stroke,
    note: session.note,
    extra: session.extra,
    workoutId: session.workoutId,
    mode: session.workoutId ? "workout" : "line",
  };
}

export default function SwimTab({ uid, onStatus }: Props) {
  const [view, setView] = useState<"log" | "calendar" | "workouts">("log");
  const [sessions, setSessions] = useState<SwimSession[]>([]);
  const [workouts, setWorkouts] = useState<SwimWorkout[]>([]);
  const [sets, setSets] = useState<SwimWorkoutSet[]>([]);
  const [draft, setDraft] = useState<SwimDraft | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fillFromWorkout, setFillFromWorkout] = useState(false);
  const [loadedSetsFor, setLoadedSetsFor] = useState<number | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [calendarLevel, setCalendarLevel] = useState<PeriodLevel>("month");
  const didAutoImport = useRef(false);

  async function load(autoImport = false) {
    if (!uid) return;
    try {
      const [nextSessions, nextWorkouts] = await Promise.all([
        invoke<SwimSession[]>("list_swim_sessions", { uid }),
        invoke<SwimWorkout[]>("list_swim_workouts", { uid }),
      ]);
      if (autoImport && !didAutoImport.current && nextSessions.length === 0 && nextWorkouts.length === 0) {
        didAutoImport.current = true;
        try {
          const message = await invoke<string>("import_swim_from_sheet", { uid });
          onStatus(message);
          await load(false);
          return;
        } catch (err: unknown) {
          onStatus(`❌ ${err}`);
        }
      }
      setSessions(nextSessions);
      setWorkouts(nextWorkouts);
      setCalendarCursor(latestLogDate(nextSessions));
    } catch (err: unknown) {
      onStatus(`❌ ${err}`);
    }
  }

  useEffect(() => {
    didAutoImport.current = false;
    void load(true);
  }, [uid]);

  useEffect(() => {
    if (view === "workouts") void load(false);
  }, [view]);

  const editorWorkoutId = draft?.mode === "workout" ? draft.workoutId : null;
  useEffect(() => {
    let cancelled = false;
    async function loadSets() {
      if (!editorWorkoutId) {
        setSets([]);
        setLoadedSetsFor(null);
        return;
      }
      try {
        const next = await invoke<SwimWorkoutSet[]>("list_swim_sets", { workoutId: editorWorkoutId });
        if (!cancelled) {
          setSets(next);
          setLoadedSetsFor(editorWorkoutId);
        }
      } catch (err: unknown) {
        if (!cancelled) onStatus(`❌ ${err}`);
      }
    }
    void loadSets();
    return () => {
      cancelled = true;
    };
  }, [editorWorkoutId]);

  useEffect(() => {
    if (!fillFromWorkout || draft?.mode !== "workout" || draft.workoutId == null) return;
    if (loadedSetsFor !== draft.workoutId) return;
    const total = inferWorkoutTotal(sets);
    setDraft((current) =>
      current && current.mode === "workout"
        ? {
            ...current,
            meters: total.meters || current.meters,
            miles: total.miles || milesFromMeters(total.meters) || current.miles,
          }
        : current,
    );
    setFillFromWorkout(false);
  }, [draft?.mode, draft?.workoutId, fillFromWorkout, loadedSetsFor, sets]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (!needle) return true;
      return [session.date, session.meters, session.miles, session.note, session.stroke, session.extra, session.workoutName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, sessions]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, session) => {
          if (!session.date.trim()) return acc;
          acc.sessions += 1;
          acc.meters += parseNumber(session.meters);
          acc.miles += parseNumber(session.miles);
          return acc;
        },
        { sessions: 0, meters: 0, miles: 0 },
      ),
    [visible],
  );

  function startNew(date = todayInput()) {
    setView("log");
    setDraft(emptyDraft(date));
    setFillFromWorkout(false);
  }

  function openSession(session: SwimSession) {
    setView("log");
    setDraft(draftFromSession(session));
    setFillFromWorkout(false);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.date) {
      onStatus("Pick a date.");
      return;
    }
    if (draft.mode === "workout" && draft.workoutId == null) {
      onStatus("Select a workout.");
      return;
    }
    setSaving(true);
    try {
      const saved = await invoke<SwimSession>("save_swim_session", {
        uid,
        id: draft.id,
        remoteId: draft.remoteId,
        date: fromDateInput(draft.date),
        meters: draft.meters.trim(),
        miles: draft.miles.trim() || milesFromMeters(draft.meters),
        stroke: draft.mode === "line" ? draft.stroke.trim() : "",
        note: draft.note.trim(),
        extra: draft.extra.trim(),
        workoutId: draft.mode === "workout" ? draft.workoutId : null,
      });
      setSessions((current) => {
        const without = current.filter((session) => session.id !== saved.id);
        return [saved, ...without];
      });
      setDraft(draftFromSession(saved));
      onStatus("Session saved.");
    } catch (err: unknown) {
      onStatus(`❌ ${err}`);
    } finally {
      setSaving(false);
    }
  }

  async function importSheet() {
    setImporting(true);
    try {
      const message = await invoke<string>("import_swim_from_sheet", { uid });
      onStatus(message);
      await load();
    } catch (err: unknown) {
      onStatus(`❌ ${err}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="swim-tab">
      <div className="search-bar">
        <section aria-label="Overall totals" className="swim-totals">
          <span>{totals.sessions} sessions</span>
          <span>{totals.meters.toLocaleString()} m</span>
          <span>{totals.miles.toFixed(2)} mi</span>
        </section>
        <div className="mode-toggle" role="group" aria-label="Swim views">
          {(["log", "calendar", "workouts"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={view === id ? "active" : undefined}
              onClick={() => setView(id)}
            >
              {id[0]?.toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" className="secondary" onClick={() => void importSheet()} disabled={importing}>
          {importing ? "Importing…" : "Import sheet snapshot"}
        </button>
      </div>

      {view === "log" ? (
        <>
          <div className="search-bar">
            <input
              type="search"
              placeholder="Filter date, note, workout…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => startNew()}>
              Add session
            </button>
          </div>
          <div className="swim-workspace">
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Meters</th>
                    <th>Miles</th>
                    <th>Stroke</th>
                    <th>Note</th>
                    <th>Workout</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((session) => (
                    <tr
                      key={session.id}
                      className={draft?.id === session.id ? "selected" : undefined}
                      onClick={() => openSession(session)}
                    >
                      <td>{session.date || "—"}</td>
                      <td>{session.meters || "—"}</td>
                      <td>{session.miles || "—"}</td>
                      <td>{session.stroke || "—"}</td>
                      <td>{session.note || session.extra || "—"}</td>
                      <td>{session.workoutName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 ? <p className="muted">No swim sessions yet.</p> : null}
            </div>
            <aside className="swim-detail">
              {draft ? (
                <LogEditor
                  draft={draft}
                  workouts={workouts}
                  sets={sets}
                  saving={saving}
                  onChange={(next) => {
                    if (next.meters !== draft.meters) {
                      setDraft({ ...next, miles: milesFromMeters(next.meters) || next.miles });
                      return;
                    }
                    setDraft(next);
                  }}
                  onMode={(mode) => {
                    if (mode === "line") {
                      setDraft({ ...draft, mode, workoutId: null });
                      setFillFromWorkout(false);
                      return;
                    }
                    setDraft({
                      ...draft,
                      mode,
                      workoutId: draft.workoutId ?? workouts[0]?.id ?? null,
                      note:
                        draft.note.trim() === "" || isWorkoutName(draft.note)
                          ? (workouts.find((workout) => workout.id === (draft.workoutId ?? workouts[0]?.id))?.name ??
                            draft.note)
                          : draft.note,
                    });
                    setFillFromWorkout(draft.id == null);
                  }}
                  onWorkout={(workoutId) => {
                    const workout = workouts.find((item) => item.id === workoutId);
                    const note =
                      draft.note.trim() === "" || isWorkoutName(draft.note)
                        ? (workout?.name ?? "")
                        : draft.note;
                    setDraft({ ...draft, workoutId, note, mode: "workout" });
                    setFillFromWorkout(true);
                  }}
                  onSave={() => void saveDraft()}
                  onCancel={() => setDraft(null)}
                />
              ) : (
                <p className="muted">Select a session to edit, or add one.</p>
              )}
            </aside>
          </div>
        </>
      ) : null}

      {view === "calendar" ? (
        <CalendarView
          entries={sessions}
          cursor={calendarCursor}
          level={calendarLevel}
          onCursor={setCalendarCursor}
          onLevel={setCalendarLevel}
          onOpenEntry={openSession}
          onAddForDate={(iso) => startNew(iso)}
        />
      ) : null}

      {view === "workouts" ? (
        <WorkoutManager uid={uid} workouts={workouts} onWorkouts={setWorkouts} onStatus={onStatus} />
      ) : null}
    </div>
  );
}
