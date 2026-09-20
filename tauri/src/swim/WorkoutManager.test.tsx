import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkoutManager from "./WorkoutManager";
import { createBackend } from "../test/backend";
import { invoke } from "../test/mocks/tauri";
import { swimSets, swimWorkouts } from "../test/swimFixtures";
import type { SwimWorkout } from "../types";

function renderManager(initial: SwimWorkout[] = swimWorkouts) {
  const backend = createBackend({ swimWorkouts: initial, swimSets });
  invoke.mockImplementation(backend.impl);
  const onWorkouts = jest.fn();
  const onStatus = jest.fn();
  const user = userEvent.setup();

  function Harness() {
    const [workouts, setWorkouts] = useState(initial);
    return (
      <WorkoutManager
        uid="user-1"
        workouts={workouts}
        onWorkouts={(next) => {
          onWorkouts(next);
          setWorkouts(next);
        }}
        onStatus={onStatus}
      />
    );
  }

  const view = render(<Harness />);
  return { ...view, user, backend, onWorkouts, onStatus };
}

describe("WorkoutManager", () => {
  it("loads the selected workout sets", async () => {
    const { user } = renderManager();

    await user.click(await screen.findByRole("button", { name: "Workout 2, 3 sets" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Workout 2");
    expect(screen.getByDisplayValue("kick with board, snorkel")).toBeInTheDocument();
    expect(screen.getByLabelText("Workout distance totals")).toHaveTextContent("500 m");
  });

  it("creates a workout", async () => {
    const { user, onWorkouts, onStatus } = renderManager();

    await user.click(await screen.findByRole("button", { name: /\+ New workout/ }));
    await user.type(screen.getByLabelText("Name"), "Threshold");
    await user.type(screen.getByLabelText("Note"), "threshold set");
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[2]!, "200");
    await user.type(inputs[3]!, "free");
    await user.click(screen.getByRole("button", { name: "Save workout" }));

    expect(onWorkouts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Threshold", setCount: 1 })]),
    );
    expect(onStatus).toHaveBeenCalledWith("Workout saved.");
    expect(screen.getByRole("button", { name: "Threshold, 1 sets" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Threshold");
  });

  it("rejects a blank name", async () => {
    const { user, onStatus, onWorkouts } = renderManager();
    await screen.findByRole("button", { name: "Workout 2, 3 sets" });
    onWorkouts.mockClear();
    onStatus.mockClear();

    await user.click(screen.getByRole("button", { name: /\+ New workout/ }));
    await user.type(screen.getByLabelText("Name"), "   ");
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    expect(onStatus).toHaveBeenCalledWith("Name the workout.");
    expect(onWorkouts).not.toHaveBeenCalled();
  });

  it("adds a set and updates an existing workout", async () => {
    const { user, onWorkouts, onStatus } = renderManager();

    await user.click(await screen.findByRole("button", { name: "Workout 2, 3 sets" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Workout 2 updated");
    await user.type(screen.getByLabelText("Note"), "send-off 1:30");
    await user.click(screen.getByRole("button", { name: "Add set" }));
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[inputs.length - 5]!, "50");
    await user.type(inputs[inputs.length - 4]!, "sprint");
    await user.click(screen.getByRole("button", { name: "Save workout" }));

    expect(onWorkouts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Workout 2 updated", setCount: 5 })]),
    );
    expect(onStatus).toHaveBeenCalledWith("Workout saved.");
  });

  it("edits set columns and removes a row", async () => {
    const { user } = renderManager();
    await user.click(await screen.findByRole("button", { name: "Workout 2, 3 sets" }));
    expect(await screen.findByDisplayValue("kick with board, snorkel")).toBeInTheDocument();

    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[9]!, "1:30");
    await user.type(inputs[10]!, "paddles");
    await user.type(inputs[11]!, "yes");
    await user.click(screen.getAllByRole("button", { name: "×" })[0]!);

    expect(screen.queryByDisplayValue("kick with board, snorkel")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("1:30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("paddles")).toBeInTheDocument();
  });

  it("surfaces list and save errors", async () => {
    const { user, onStatus, backend } = renderManager();
    await screen.findByRole("button", { name: "Workout 2, 3 sets" });
    onStatus.mockClear();
    backend.state.fail.list_swim_sets = "sets down";
    await user.click(screen.getByRole("button", { name: "Workout 4, 1 sets" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("❌ sets down"));

    delete backend.state.fail.list_swim_sets;
    backend.state.fail.save_swim_workout = "save down";
    await user.click(screen.getByRole("button", { name: /\+ New workout/ }));
    await user.type(screen.getByLabelText("Name"), "Broken");
    await user.click(screen.getByRole("button", { name: "Save workout" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("❌ save down"));
  });

  it("keeps the workout when delete is cancelled", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    const { user, onWorkouts } = renderManager();

    await user.click(await screen.findByRole("button", { name: "Workout 4, 1 sets" }));
    onWorkouts.mockClear();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalled();
    expect(onWorkouts).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Workout 4, 1 sets" })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("deletes a workout after confirm", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onWorkouts, onStatus } = renderManager();

    await user.click(await screen.findByRole("button", { name: "Workout 4, 1 sets" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalled();
    expect(onWorkouts).toHaveBeenCalledWith([swimWorkouts[0]]);
    expect(onStatus).toHaveBeenCalledWith("Workout deleted.");
    expect(screen.queryByRole("button", { name: "Workout 4, 1 sets" })).not.toBeInTheDocument();
    confirm.mockRestore();
  });
});
