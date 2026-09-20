import { screen } from "@testing-library/react";
import { renderApp } from "./test/renderApp";
import { swimSeed } from "./test/swimFixtures";

describe("Swim tab", () => {
  it("lists sessions and opens the editor", async () => {
    const { user } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    expect(await screen.findByText("6/4/2025")).toBeInTheDocument();
    expect(screen.getByLabelText("Overall totals")).toHaveTextContent("14,000");

    await user.click(screen.getByText("6/4/2025"));
    expect(screen.getByText("Edit session")).toBeInTheDocument();
    expect(screen.getByLabelText("Meters")).toHaveValue("2500");
  });

  it("adds a session from the log view", async () => {
    const { user, backend } = await renderApp();
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await user.click(await screen.findByRole("button", { name: "Add session" }));
    await user.type(screen.getByLabelText("Note"), "Easy swim");
    await user.type(screen.getByLabelText("Meters"), "1800");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Session saved.")).toBeInTheDocument();
    expect(backend.state.swimSessions.some((row) => row.note === "Easy swim")).toBe(true);
  });

  it("opens migrated workouts in the manager", async () => {
    const { user } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await user.click(await screen.findByRole("button", { name: "Workouts" }));
    expect(await screen.findByRole("button", { name: "Workout 2, 3 sets" })).toBeInTheDocument();
    expect(screen.getByText("Edit workout")).toBeInTheDocument();
    expect(screen.getByDisplayValue("kick with board, snorkel")).toBeInTheDocument();
    expect(screen.getByLabelText("Workout distance totals")).toHaveTextContent("500 m");
  });

  it("filters log rows and opens the calendar", async () => {
    const { user } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await screen.findByText("6/4/2025");

    await user.type(screen.getByPlaceholderText(/Filter date/), "Workout 4");
    expect(screen.getByText("6/24/2025")).toBeInTheDocument();
    expect(screen.queryByText("6/4/2025")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/Filter date/));
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    expect(await screen.findByRole("heading", { name: "July 2025" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Period totals" })).toHaveTextContent("3,200");
  });

  it("auto-imports and can import the sheet snapshot again", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    expect(await screen.findByText(/Imported 0 workouts/)).toBeInTheDocument();
    expect(screen.getByText("No swim sessions yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import sheet snapshot" }));
    expect(await screen.findByText(/Imported 0 workouts/)).toBeInTheDocument();
  });

  it("saves a session from a named workout", async () => {
    const { user, backend } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await user.click(await screen.findByRole("button", { name: "Add session" }));
    await user.click(screen.getByRole("button", { name: "Workout" }));
    expect(screen.getByLabelText("Workout")).toHaveValue("2");
    expect(await screen.findByText("kick with board, snorkel")).toBeInTheDocument();
    expect(screen.getByLabelText("Meters")).toHaveValue("2500");

    await user.selectOptions(screen.getByLabelText("Workout"), "4");
    expect(screen.getByLabelText("Note")).toHaveValue("Workout 4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Session saved.")).toBeInTheDocument();
    expect(backend.state.swimSessions.some((row) => row.workoutId === 4)).toBe(true);
  });

  it("switches a new session back to a single line", async () => {
    const { user } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await user.click(await screen.findByRole("button", { name: "Add session" }));
    await user.click(screen.getByRole("button", { name: "Workout" }));
    expect(screen.getByLabelText("Workout")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Single line" }));
    expect(screen.getByLabelText("Stroke")).toBeInTheDocument();
  });

  it("shows import and list errors", async () => {
    const { user } = await renderApp({ fail: { import_swim_from_sheet: "import down" } });
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    expect(await screen.findByText("❌ import down")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import sheet snapshot" }));
    expect(await screen.findAllByText("❌ import down")).not.toHaveLength(0);
  });

  it("updates an existing session from the log", async () => {
    const { user, backend } = await renderApp(swimSeed);
    await user.click(screen.getByRole("button", { name: /Swim/ }));
    await user.click(await screen.findByText("6/4/2025"));
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "Easy recovery");
    await user.clear(screen.getByLabelText("Meters"));
    await user.type(screen.getByLabelText("Meters"), "1600");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Session saved.")).toBeInTheDocument();
    expect(backend.state.swimSessions.some((row) => row.note === "Easy recovery" && row.meters === "1600")).toBe(
      true,
    );
  });
});
