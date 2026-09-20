import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatPct, milesFromMeters, summarizeWorkoutSets } from "./logFormat";
import type { SwimWorkout, SwimWorkoutSet } from "../types";

type SetDraft = {
  key: string;
  distance: string;
  description: string;
  splitTotal: string;
  equipment: string;
  fins: string;
};

type Props = {
  uid: string;
  workouts: SwimWorkout[];
  onWorkouts: (workouts: SwimWorkout[]) => void;
  onStatus: (message: string) => void;
};

let nextSetKey = 0;
function emptySet(): SetDraft {
  nextSetKey += 1;
  return {
    key: `new-${nextSetKey}`,
    distance: "",
    description: "",
    splitTotal: "",
    equipment: "",
    fins: "",
  };
}

export default function WorkoutManager({ uid, workouts, onWorkouts, onStatus }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(workouts[0]?.id ?? null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [sets, setSets] = useState<SetDraft[]>([emptySet()]);
  const [saving, setSaving] = useState(false);

  const selected = workouts.find((workout) => workout.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function refreshWorkouts() {
      try {
        const next = await invoke<SwimWorkout[]>("list_swim_workouts", { uid });
        if (cancelled) return;
        onWorkouts(next);
        setSelectedId((current) => {
          if (current != null && next.some((workout) => workout.id === current)) return current;
          return next[0]?.id ?? null;
        });
      } catch (err: unknown) {
        if (!cancelled) onStatus(`❌ ${err}`);
      }
    }
    void refreshWorkouts();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (selectedId == null) {
        setName("");
        setNote("");
        setSets([emptySet()]);
        return;
      }
      const current = workouts.find((workout) => workout.id === selectedId);
      setName(current?.name ?? "");
      setNote(current?.note ?? "");
      try {
        const next = await invoke<SwimWorkoutSet[]>("list_swim_sets", { workoutId: selectedId });
        if (!cancelled) {
          setSets(
            next.length
              ? next.map((set, index) => ({
                  key: `${set.id}-${index}`,
                  distance: set.distance,
                  description: set.description,
                  splitTotal: set.splitTotal,
                  equipment: set.equipment,
                  fins: set.fins,
                }))
              : [emptySet()],
          );
        }
      } catch (err: unknown) {
        if (!cancelled) onStatus(`❌ ${err}`);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const totals = useMemo(() => summarizeWorkoutSets(sets), [sets]);

  function startNew() {
    setSelectedId(null);
    setName("");
    setNote("");
    setSets([emptySet()]);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      onStatus("Name the workout.");
      return;
    }
    const payloadSets = sets.filter(
      (set) =>
        set.distance.trim() !== "" ||
        set.description.trim() !== "" ||
        set.equipment.trim() !== "" ||
        set.fins.trim() !== "",
    );
    setSaving(true);
    try {
      const saved = await invoke<SwimWorkout>("save_swim_workout", {
        uid,
        id: selectedId,
        remoteId: selected?.remoteId ?? null,
        name: trimmed,
        note: note.trim(),
        sets: payloadSets,
      });
      onWorkouts(
        selectedId
          ? workouts.map((workout) => (workout.id === saved.id ? saved : workout))
          : [...workouts, saved],
      );
      setSelectedId(saved.id);
      onStatus("Workout saved.");
    } catch (err: unknown) {
      onStatus(`❌ ${err}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (selectedId == null) return;
    if (!window.confirm(`Delete ${selected?.name ?? "this workout"}? Log rows stay, but the link is cleared.`)) {
      return;
    }
    try {
      await invoke("delete_swim_workout", { uid, id: selectedId });
      onWorkouts(workouts.filter((workout) => workout.id !== selectedId));
      startNew();
      onStatus("Workout deleted.");
    } catch (err: unknown) {
      onStatus(`❌ ${err}`);
    }
  }

  return (
    <div className="workout-manager">
      <aside className="workout-list">
        <div className="editor-actions">
          <button type="button" className="btn-primary" onClick={startNew}>
            + New workout
          </button>
        </div>
        <ul aria-label="Saved workouts">
          {workouts.map((workout) => (
            <li key={workout.id}>
              <button
                type="button"
                className={workout.id === selectedId ? "selected" : undefined}
                aria-label={`${workout.name}, ${workout.setCount} sets`}
                onClick={() => setSelectedId(workout.id)}
              >
                <strong>{workout.name}</strong>
                <span>{workout.setCount} sets</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <form
        className="editor workout-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="eyebrow">{selectedId == null ? "New workout" : "Edit workout"}</p>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Focus, send-off, pool notes…"
          />
        </label>
        <section className="workout-totals" aria-label="Workout distance totals">
          <div>
            <span>Total</span>
            <strong>{totals.total ? `${totals.total.toLocaleString()} m` : "—"}</strong>
            <em>{totals.total ? `${milesFromMeters(String(totals.total))} mi · ${formatPct(totals.totalPct)}` : "0%"}</em>
          </div>
          <div>
            <span>Equipment</span>
            <strong>{totals.equipment ? `${totals.equipment.toLocaleString()} m` : "—"}</strong>
            <em>{formatPct(totals.equipmentPct)}</em>
          </div>
          <div>
            <span>Fins</span>
            <strong>{totals.fins ? `${totals.fins.toLocaleString()} m` : "—"}</strong>
            <em>{formatPct(totals.finsPct)}</em>
          </div>
        </section>
        <div className="set-table">
          <div className="set-head">
            <span>Meters</span>
            <span>Description</span>
            <span>Split</span>
            <span>Equip</span>
            <span>Fins</span>
            <span />
          </div>
          {sets.map((set) => (
            <div key={set.key} className="set-row">
              <input
                value={set.distance}
                onChange={(event) =>
                  setSets((current) =>
                    current.map((row) =>
                      row.key === set.key ? { ...row, distance: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                value={set.description}
                onChange={(event) =>
                  setSets((current) =>
                    current.map((row) =>
                      row.key === set.key ? { ...row, description: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                value={set.splitTotal}
                onChange={(event) =>
                  setSets((current) =>
                    current.map((row) =>
                      row.key === set.key ? { ...row, splitTotal: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                value={set.equipment}
                onChange={(event) =>
                  setSets((current) =>
                    current.map((row) =>
                      row.key === set.key ? { ...row, equipment: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                value={set.fins}
                onChange={(event) =>
                  setSets((current) =>
                    current.map((row) =>
                      row.key === set.key ? { ...row, fins: event.target.value } : row,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setSets((current) => current.filter((row) => row.key !== set.key))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="editor-actions">
          <button type="button" className="secondary" onClick={() => setSets((current) => [...current, emptySet()])}>
            Add set
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save workout"}
          </button>
          {selectedId != null ? (
            <button type="button" className="secondary" onClick={() => void remove()}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
