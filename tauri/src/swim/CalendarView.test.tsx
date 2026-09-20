import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarView from "./CalendarView";
import type { PeriodLevel } from "./calendar";
import { swimSessions } from "../test/swimFixtures";
import type { SwimSession } from "../types";

function Harness({
  entries = swimSessions,
  initialCursor = new Date(2025, 6, 15),
  initialLevel = "month",
  onOpenEntry = jest.fn(),
  onAddForDate = jest.fn(),
}: {
  entries?: SwimSession[];
  initialCursor?: Date;
  initialLevel?: PeriodLevel;
  onOpenEntry?: (entry: SwimSession) => void;
  onAddForDate?: (isoDate: string) => void;
}) {
  const [cursor, setCursor] = useState(initialCursor);
  const [level, setLevel] = useState<PeriodLevel>(initialLevel);
  return (
    <CalendarView
      entries={entries}
      cursor={cursor}
      level={level}
      onCursor={setCursor}
      onLevel={setLevel}
      onOpenEntry={onOpenEntry}
      onAddForDate={onAddForDate}
    />
  );
}

describe("CalendarView", () => {
  it("shows month totals and per-day meters", () => {
    render(<Harness initialCursor={new Date(2025, 5, 10)} />);

    expect(screen.getByRole("heading", { name: "June 2025" })).toBeInTheDocument();
    const period = screen.getByRole("region", { name: "Period totals" });
    expect(period).toHaveTextContent("4");
    expect(period).toHaveTextContent("10,800");
    expect(period).toHaveTextContent("6.70");
    expect(screen.getByRole("button", { name: "2025-06-04, 2,500 meters" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Week of 2025-06-23, 5,800 meters, 2 sessions" }),
    ).toBeInTheDocument();
  });

  it("drills from a week total into that week, then a day", async () => {
    const user = userEvent.setup();
    const onOpenEntry = jest.fn();
    render(<Harness initialCursor={new Date(2025, 6, 15)} onOpenEntry={onOpenEntry} />);

    await user.click(screen.getByRole("button", { name: "Week of 2025-07-14, 3,200 meters, 1 session" }));
    expect(screen.getByRole("heading", { name: "Jul 14 – Jul 20, 2025" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025-07-15, 1 session, 3,200 meters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2025-07-15, 1 session, 3,200 meters" }));
    expect(screen.getByRole("heading", { name: "Tue, Jul 15, 2025" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3,200 meters, Workout 5" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "3,200 meters, Workout 5" }));
    expect(onOpenEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 5, meters: "3200" }));
  });

  it("adds a session for the selected day", async () => {
    const user = userEvent.setup();
    const onAddForDate = jest.fn();
    render(
      <Harness initialCursor={new Date(2025, 6, 15)} initialLevel="day" onAddForDate={onAddForDate} />,
    );

    await user.click(screen.getByRole("button", { name: "Add session this day" }));
    expect(onAddForDate).toHaveBeenCalledWith("2025-07-15");
  });

  it("returns to month view from the breadcrumb", async () => {
    const user = userEvent.setup();
    render(<Harness initialCursor={new Date(2025, 6, 15)} initialLevel="day" />);

    await user.click(screen.getByRole("button", { name: "July 2025" }));
    expect(screen.getByRole("heading", { name: "July 2025" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025-07-15, 3,200 meters" })).toBeInTheDocument();
  });

  it("shifts month, week, and day and shows an empty day", async () => {
    const user = userEvent.setup();
    render(<Harness initialCursor={new Date(2025, 6, 15)} />);

    await user.click(screen.getByRole("button", { name: "‹" }));
    expect(screen.getByRole("heading", { name: "June 2025" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "›" }));
    expect(screen.getByRole("heading", { name: "July 2025" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("heading", { name: "Jul 14 – Jul 20, 2025" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "›" }));
    expect(screen.getByRole("heading", { name: "Jul 21 – Jul 27, 2025" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Day" }));
    await user.click(screen.getByRole("button", { name: "›" }));
    expect(screen.getByText("No swims on this day.")).toBeInTheDocument();
  });
});
