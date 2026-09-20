import type { SwimDraft, SwimEditorMode, SwimWorkout, SwimWorkoutSet } from "../types";

type Props = {
  draft: SwimDraft;
  workouts: SwimWorkout[];
  sets: SwimWorkoutSet[];
  saving: boolean;
  onChange: (draft: SwimDraft) => void;
  onMode: (mode: SwimEditorMode) => void;
  onWorkout: (workoutId: number | null) => void;
  onSave: () => void;
  onCancel: () => void;
};

export default function LogEditor({
  draft,
  workouts,
  sets,
  saving,
  onChange,
  onMode,
  onWorkout,
  onSave,
  onCancel,
}: Props) {
  const set = (patch: Partial<SwimDraft>) => onChange({ ...draft, ...patch });

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className="eyebrow">{draft.id == null ? "New session" : "Edit session"}</p>
      <div className="mode-toggle" role="group" aria-label="Entry type">
        <button
          type="button"
          className={draft.mode === "line" ? "active" : undefined}
          onClick={() => onMode("line")}
        >
          Single line
        </button>
        <button
          type="button"
          className={draft.mode === "workout" ? "active" : undefined}
          onClick={() => onMode("workout")}
        >
          Workout
        </button>
      </div>

      <label>
        Date
        <input
          type="date"
          value={draft.date}
          onChange={(event) => set({ date: event.target.value })}
          required
        />
      </label>

      {draft.mode === "workout" ? (
        <label>
          Workout
          <select
            value={draft.workoutId ?? ""}
            onChange={(event) =>
              onWorkout(event.target.value ? Number(event.target.value) : null)
            }
            required
          >
            <option value="">Select a workout…</option>
            {workouts.map((workout) => (
              <option key={workout.id} value={workout.id}>
                {workout.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Note
          <input
            type="text"
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
            placeholder="Pool closed, easy swim…"
          />
        </label>
      )}

      <div className="field-row">
        <label>
          Meters
          <input
            type="text"
            inputMode="decimal"
            value={draft.meters}
            onChange={(event) => set({ meters: event.target.value })}
          />
        </label>
        <label>
          Miles
          <input
            type="text"
            inputMode="decimal"
            value={draft.miles}
            onChange={(event) => set({ miles: event.target.value })}
          />
        </label>
      </div>

      {draft.mode === "line" ? (
        <label>
          Stroke
          <input
            type="text"
            value={draft.stroke}
            onChange={(event) => set({ stroke: event.target.value })}
            placeholder="free, IM, breast…"
          />
        </label>
      ) : (
        <label>
          Note
          <input
            type="text"
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
      )}

      <label>
        Extra
        <input
          type="text"
          value={draft.extra}
          onChange={(event) => set({ extra: event.target.value })}
        />
      </label>

      <div className="editor-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }}
          disabled={saving}
        >
          Cancel
        </button>
      </div>

      {draft.mode === "workout" && sets.length > 0 ? (
        <ol className="sets">
          {sets.map((setRow) => (
            <li key={setRow.id}>
              <strong>{setRow.distance || "—"}</strong>
              <span>{setRow.description || "set"}</span>
              {setRow.splitTotal ? <em>{setRow.splitTotal}</em> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  );
}
