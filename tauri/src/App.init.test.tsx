import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { invoke } from "./test/mocks/tauri";
import { activePanel, renderApp, renderAppUntilStatus } from "./test/renderApp";

describe("App initialization and chrome", () => {
  it("loads online users, syncs, and shows the expenses workspace", async () => {
    const { user } = await renderApp();
    expect(await screen.findByText(/Synced 3 items|Loaded user: user-1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cloud Sync/ })).toBeInTheDocument();
    expect(screen.getByText("📊 All Expenses")).toBeInTheDocument();
    expect(screen.getByText("📁 Food")).toBeInTheDocument();
    expect(within(activePanel()).getAllByText(/Costco/).length).toBeGreaterThan(0);
    expect(screen.getByText("Tauri Sync Pro v1.0.0")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "user-2");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_passwords", { uid: "user-2" });
    });

    await user.click(screen.getByRole("button", { name: /Reload/ }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("sync_all", { uid: "user-2" });
    });

    await user.click(screen.getByRole("button", { name: /Cloud Sync/ }));
    await waitFor(() => {
      expect(screen.getByText("Synced 3 items")).toBeInTheDocument();
    });
  });

  it("switches the default uid when it is missing from the cloud user list", async () => {
    await renderApp({ defaultUid: "ghost", users: ["user-a"] });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_passwords", { uid: "user-a" });
    });
    expect(screen.getByRole("combobox")).toHaveValue("user-a");
  });

  it("enters offline mode when firebase is unavailable", async () => {
    await renderApp({ online: false });
    expect(screen.getByText("🔌 OFFLINE MODE")).toBeInTheDocument();
    expect(screen.getByText("Offline Mode - SQLite only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cloud Sync/ })).not.toBeInTheDocument();
  });

  it("shows an initialization error when the backend cannot start", async () => {
    await renderAppUntilStatus(
      { fail: { is_firebase_available: "boom" } },
      /Initialization Error: boom/,
    );
  });

  it("reports a failed cloud sync", async () => {
    const { user } = await renderApp({ fail: { sync_all: "timeout" } });
    await user.click(screen.getByRole("button", { name: /Cloud Sync/ }));
    expect(await screen.findByText("❌ Sync failed: timeout")).toBeInTheDocument();
  });

  it("surfaces expense refresh errors in the status bar", async () => {
    await renderApp({ fail: { get_categories: "db down" } });
    expect(await screen.findByText("Error refreshing expenses: db down")).toBeInTheDocument();
  });

  it("resizes both expense panes and clamps extreme widths", async () => {
    await renderApp();
    const container = document.querySelector(".paned-container") as HTMLElement;
    jest.spyOn(container, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON() {
        return {};
      },
    });

    const handles = document.querySelectorAll(".resizer-handle");
    fireEvent.mouseDown(handles[0]);
    fireEvent.mouseMove(window, { clientX: 300 });
    expect(document.querySelector(".col-categories")).toHaveStyle({ width: "300px" });

    fireEvent.mouseMove(window, { clientX: 20 });
    expect(document.querySelector(".col-categories")).toHaveStyle({ width: "150px" });
    fireEvent.mouseUp(window);

    fireEvent.mouseDown(handles[1]);
    fireEvent.mouseMove(window, { clientX: 800 });
    expect(document.querySelector(".col-vendors")).toHaveStyle({ width: "500px" });
    fireEvent.mouseUp(window);
  });
});
