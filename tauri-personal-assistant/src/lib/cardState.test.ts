import {
  actionButtonState,
  formatAppLink,
  shouldStickLogsToBottom,
  statusBadgeState,
} from "./cardState";
import type { AppStatus } from "../types";

const app = (overrides: Partial<AppStatus> = {}): AppStatus => ({
  id: "wiki",
  name: "Wiki",
  running: false,
  rebuilding: false,
  canRebuild: false,
  ...overrides,
});

describe("statusBadgeState", () => {
  it("marks a rebuild in progress", () => {
    expect(statusBadgeState(app({ rebuilding: true, running: true }))).toEqual({
      text: "Rebuilding",
      className: "status-badge rebuilding",
    });
  });

  it("marks a running app", () => {
    expect(statusBadgeState(app({ running: true }))).toEqual({
      text: "Running",
      className: "status-badge running",
    });
  });

  it("marks a stopped app", () => {
    expect(statusBadgeState(app())).toEqual({
      text: "Stopped",
      className: "status-badge stopped",
    });
  });
});

describe("actionButtonState", () => {
  it("disables start while running or rebuilding", () => {
    expect(actionButtonState(app({ running: true })).startDisabled).toBe(true);
    expect(actionButtonState(app({ rebuilding: true })).startDisabled).toBe(true);
    expect(actionButtonState(app()).startDisabled).toBe(false);
  });

  it("only enables stop when the app is running and not rebuilding", () => {
    expect(actionButtonState(app({ running: true })).stopDisabled).toBe(false);
    expect(actionButtonState(app()).stopDisabled).toBe(true);
    expect(actionButtonState(app({ running: true, rebuilding: true })).stopDisabled).toBe(true);
  });

  it("shows rebuild controls only when supported", () => {
    expect(actionButtonState(app({ canRebuild: false })).rebuildVisible).toBe(false);
    const rebuilding = actionButtonState(app({ canRebuild: true, rebuilding: true }));
    expect(rebuilding.rebuildVisible).toBe(true);
    expect(rebuilding.rebuildDisabled).toBe(true);
    expect(rebuilding.rebuildText).toBe("Rebuilding...");
    expect(actionButtonState(app({ canRebuild: true })).rebuildText).toBe("Rebuild");
  });
});

describe("formatAppLink", () => {
  it("renders a live link only while running with a url", () => {
    expect(formatAppLink(app({ running: true, url: "http://localhost:8899" }))).toEqual({
      mode: "link",
      text: "http://localhost:8899",
    });
  });

  it("shows a hint when the app is stopped but has a url", () => {
    expect(formatAppLink(app({ url: "http://localhost:8899" }))).toEqual({
      mode: "hint",
      text: "Opens at http://localhost:8899",
    });
  });

  it("renders nothing when there is no url", () => {
    expect(formatAppLink(app())).toEqual({ mode: "empty", text: "" });
  });
});

describe("shouldStickLogsToBottom", () => {
  it("sticks only when the accordion is open and the user is near the bottom", () => {
    expect(
      shouldStickLogsToBottom({ scrollHeight: 200, scrollTop: 170, clientHeight: 20 }, true),
    ).toBe(true);
    expect(
      shouldStickLogsToBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 20 }, true),
    ).toBe(false);
    expect(
      shouldStickLogsToBottom({ scrollHeight: 200, scrollTop: 170, clientHeight: 20 }, false),
    ).toBe(false);
  });
});
