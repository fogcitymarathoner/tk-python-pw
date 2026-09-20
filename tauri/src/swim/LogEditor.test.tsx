import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogEditor from "./LogEditor";
import { swimSets, swimWorkouts } from "../test/swimFixtures";
import type { SwimDraft } from "../types";

const draft: SwimDraft = {
  id: 1,
  remoteId: "s5",
  date: "2025-07-15",
  meters: "3200",
  miles: "1.99",
  stroke: "",
  note: "Workout 5",
  extra: "",
  workoutId: null,
  mode: "line",
};

describe("LogEditor", () => {
  it("saves and cancels", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    const onCancel = jest.fn();
    render(
      <LogEditor
        draft={draft}
        workouts={swimWorkouts}
        sets={[]}
        saving={false}
        onChange={jest.fn()}
        onMode={jest.fn()}
        onWorkout={jest.fn()}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Edit session")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("switches to workout mode and lists sets", async () => {
    const user = userEvent.setup();
    const onMode = jest.fn();
    render(
      <LogEditor
        draft={{ ...draft, mode: "workout", workoutId: 2 }}
        workouts={swimWorkouts}
        sets={swimSets.filter((set) => set.workoutId === 2)}
        saving={false}
        onChange={jest.fn()}
        onMode={onMode}
        onWorkout={jest.fn()}
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Workout")).toBeInTheDocument();
    expect(screen.getByText("kick with board, snorkel")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Single line" }));
    expect(onMode).toHaveBeenCalledWith("line");
  });

  it("edits strokes, extra, and workout choice", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onWorkout = jest.fn();
    render(
      <LogEditor
        draft={draft}
        workouts={swimWorkouts}
        sets={[]}
        saving={false}
        onChange={onChange}
        onMode={jest.fn()}
        onWorkout={onWorkout}
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Stroke"), "free");
    expect(onChange).toHaveBeenCalled();
    await user.type(screen.getByLabelText("Extra"), "goal");
    await user.type(screen.getByLabelText("Miles"), "2");
  });
});
