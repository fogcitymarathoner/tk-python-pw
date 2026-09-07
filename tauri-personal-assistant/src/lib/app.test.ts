import { fireEvent, screen, waitFor } from "@testing-library/dom";
import type { AppLogs, AppStatus } from "../types";
import { mountApp, renderCard, showError, updateCard, updateLogs } from "./app";

const wiki: AppStatus = {
  id: "wiki",
  name: "Wiki",
  running: false,
  rebuilding: false,
  canRebuild: false,
  url: "http://localhost:8899",
};

const personal: AppStatus = {
  id: "personal-data",
  name: "Personal Data App",
  running: false,
  rebuilding: false,
  canRebuild: true,
};

const emptyLogs: AppLogs = { stdout: "", stderr: "" };

function createBackend(initial: AppStatus[] = [wiki, personal]) {
  const apps = new Map(initial.map((app) => [app.id, { ...app }]));
  const logs = new Map<string, AppLogs>(
    initial.map((app) => [app.id, { ...emptyLogs }]),
  );
  const fail = new Map<string, string>();
  const opened: string[] = [];

  const invoke = jest.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (fail.has(cmd)) throw fail.get(cmd);
    switch (cmd) {
      case "get_all_status":
        return [...apps.values()];
      case "get_app_logs":
        return logs.get(String(args.appId)) ?? emptyLogs;
      case "start_app": {
        const app = apps.get(String(args.appId));
        if (app) app.running = true;
        return;
      }
      case "stop_app": {
        const app = apps.get(String(args.appId));
        if (app) app.running = false;
        return;
      }
      case "rebuild_app": {
        const app = apps.get(String(args.appId));
        if (app) app.rebuilding = true;
        return;
      }
      case "backup_repo":
        return "C:\\\\backups\\\\repo.zip";
      default:
        throw new Error(`unknown ${cmd}`);
    }
  });

  return {
    invoke,
    openUrl: jest.fn(async (url: string) => {
      opened.push(url);
    }),
    apps,
    logs,
    fail,
    opened,
  };
}

async function mount(backend = createBackend(), extras: Record<string, unknown> = {}) {
  const controller = mountApp({
    invoke: backend.invoke,
    openUrl: backend.openUrl,
    icons: { wiki: "/wiki.ico" },
    refreshIntervalMs: 0,
    errorHideMs: 20,
    ...extras,
  });
  await waitFor(() => {
    expect(screen.getByText("Wiki")).toBeInTheDocument();
  });
  return { controller, backend };
}

describe("renderCard and updateCard", () => {
  it("renders an icon when one is provided and omits it otherwise", () => {
    const withIcon = renderCard(wiki, { wiki: "/wiki.ico" }, jest.fn(), jest.fn(), jest.fn(), jest.fn());
    expect(withIcon.querySelector("img.app-icon")).toHaveAttribute("src", "/wiki.ico");

    const withoutIcon = renderCard(personal, {}, jest.fn(), jest.fn(), jest.fn(), jest.fn());
    expect(withoutIcon.querySelector("img.app-icon")).toBeNull();
  });

  it("wires start, stop, rebuild, and accordion callbacks", () => {
    const onStart = jest.fn();
    const onStop = jest.fn();
    const onRebuild = jest.fn();
    const onToggle = jest.fn();
    const card = renderCard(personal, {}, onStart, onStop, onRebuild, onToggle);
    document.body.appendChild(card);

    fireEvent.click(card.querySelector(".btn-start") as HTMLElement);
    fireEvent.click(card.querySelector(".btn-stop") as HTMLElement);
    fireEvent.click(card.querySelector(".btn-rebuild") as HTMLElement);
    expect(onStart).toHaveBeenCalledWith("personal-data");
    expect(onStop).toHaveBeenCalledWith("personal-data");
    expect(onRebuild).toHaveBeenCalledWith("personal-data");

    const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
    accordion.open = true;
    accordion.dispatchEvent(new Event("toggle"));
    expect(onToggle).toHaveBeenCalledWith("personal-data", true);
    accordion.open = false;
    accordion.dispatchEvent(new Event("toggle"));
    expect(onToggle).toHaveBeenCalledWith("personal-data", false);
  });

  it("updates running, rebuilding, rebuild, and link states", () => {
    const card = renderCard(wiki, {}, jest.fn(), jest.fn(), jest.fn(), jest.fn());
    const openUrl = jest.fn();

    updateCard(card, { ...wiki, running: true }, openUrl);
    expect(card.querySelector(".status-badge")).toHaveTextContent("Running");
    expect(card.querySelector(".open-link")).toHaveTextContent("http://localhost:8899");
    fireEvent.click(card.querySelector(".open-link") as HTMLElement);
    expect(openUrl).toHaveBeenCalledWith("http://localhost:8899");

    updateCard(card, wiki, openUrl);
    expect(card.querySelector(".app-link")).toHaveTextContent("Opens at http://localhost:8899");

    updateCard(card, personal, openUrl);
    expect(card.querySelector(".app-link")).toHaveTextContent("");
    expect(card.querySelector(".btn-rebuild")).not.toHaveAttribute("hidden");

    updateCard(card, { ...personal, rebuilding: true }, openUrl);
    expect(card.querySelector(".status-badge")).toHaveTextContent("Rebuilding");
    expect(card.querySelector(".btn-rebuild")).toHaveTextContent("Rebuilding...");
    expect(card.querySelector(".btn-start")).toBeDisabled();
    expect(card.querySelector(".btn-stop")).toBeDisabled();
  });
});

describe("updateLogs and showError", () => {
  it("fills empty logs and sticks to the bottom when already near it", () => {
    const card = renderCard(wiki, {}, jest.fn(), jest.fn(), jest.fn(), jest.fn());
    const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
    const stdout = card.querySelector(".log-stdout") as HTMLElement;
    accordion.open = true;
    Object.defineProperty(stdout, "scrollHeight", { value: 200, configurable: true });
    Object.defineProperty(stdout, "clientHeight", { value: 20, configurable: true });
    stdout.scrollTop = 170;

    updateLogs(card, emptyLogs);
    expect(stdout).toHaveTextContent("(empty)");
    expect(card.querySelector(".log-stderr")).toHaveTextContent("(empty)");
    expect(stdout.scrollTop).toBe(200);

    stdout.scrollTop = 0;
    updateLogs(card, { stdout: "out", stderr: "err" });
    expect(stdout).toHaveTextContent("out");
    expect(card.querySelector(".log-stderr")).toHaveTextContent("err");
    expect(stdout.scrollTop).toBe(0);
  });

  it("shows and hides an error, and ignores a missing card", () => {
    const card = renderCard(wiki, {}, jest.fn(), jest.fn(), jest.fn(), jest.fn());
    document.body.appendChild(card);
    const timers: Array<() => void> = [];
    showError(undefined, "nope", 5, ((cb: () => void) => {
      timers.push(cb);
      return 1;
    }) as typeof setTimeout);
    showError(card, "boom", 5, ((cb: () => void) => {
      timers.push(cb);
      return 1;
    }) as typeof setTimeout);
    expect(card.querySelector(".error-msg")).toHaveTextContent("boom");
    expect(card.querySelector(".error-msg")).not.toHaveAttribute("hidden");
    timers.at(-1)?.();
    expect(card.querySelector(".error-msg")).toHaveAttribute("hidden");
  });
});

describe("mountApp", () => {
  it("renders cards, starts, stops, and rebuilds apps", async () => {
    const { backend } = await mount();
    expect(screen.getByText("Personal Data App")).toBeInTheDocument();
    expect(document.querySelector('[data-app-id="wiki"] img.app-icon')).toBeTruthy();
    expect(document.querySelector('[data-app-id="personal-data"] img.app-icon')).toBeNull();

    const wikiCard = document.querySelector('[data-app-id="wiki"]') as HTMLElement;
    fireEvent.click(wikiCard.querySelector(".btn-start") as HTMLElement);
    await waitFor(() => {
      expect(wikiCard.querySelector(".status-badge")).toHaveTextContent("Running");
    });
    expect(wikiCard.querySelector(".log-accordion")).toHaveAttribute("open");
    expect(backend.invoke).toHaveBeenCalledWith("start_app", { appId: "wiki" });

    fireEvent.click(wikiCard.querySelector(".open-link") as HTMLElement);
    expect(backend.openUrl).toHaveBeenCalledWith("http://localhost:8899");

    fireEvent.click(wikiCard.querySelector(".btn-stop") as HTMLElement);
    await waitFor(() => {
      expect(wikiCard.querySelector(".status-badge")).toHaveTextContent("Stopped");
    });

    const personalCard = document.querySelector('[data-app-id="personal-data"]') as HTMLElement;
    fireEvent.click(personalCard.querySelector(".btn-rebuild") as HTMLElement);
    await waitFor(() => {
      expect(personalCard.querySelector(".status-badge")).toHaveTextContent("Rebuilding");
    });
  });

  it("preserves accordion open state across refreshes", async () => {
    const { controller } = await mount();
    const wikiCard = document.querySelector('[data-app-id="wiki"]') as HTMLElement;
    const accordion = wikiCard.querySelector(".log-accordion") as HTMLDetailsElement;
    accordion.open = true;
    accordion.dispatchEvent(new Event("toggle"));
    expect(controller.openAccordions.has("wiki")).toBe(true);
    await controller.refreshStatus();
    expect((wikiCard.querySelector(".log-accordion") as HTMLDetailsElement).open).toBe(true);

    accordion.open = false;
    accordion.dispatchEvent(new Event("toggle"));
    await controller.refreshStatus();
    expect((wikiCard.querySelector(".log-accordion") as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelectorAll(".app-card")).toHaveLength(2);
  });

  it("surfaces start, stop, and rebuild errors", async () => {
    const backend = createBackend();
    const { controller } = await mount(backend);
    backend.fail.set("start_app", "start failed");
    await controller.startApp("wiki");
    expect(screen.getByText("start failed")).toBeInTheDocument();

    backend.fail.set("stop_app", "stop failed");
    await controller.stopApp("wiki");
    expect(screen.getByText("stop failed")).toBeInTheDocument();

    backend.fail.set("rebuild_app", "rebuild failed");
    await controller.rebuildApp("personal-data");
    expect(screen.getByText("rebuild failed")).toBeInTheDocument();
  });

  it("creates a backup and reports failures", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Backup" }));
    await waitFor(() => {
      expect(screen.getByText(/Backup saved to/)).toBeInTheDocument();
    });
    expect(screen.getByText(/repo.zip/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup" })).toBeEnabled();

    backend.fail.set("backup_repo", "disk full");
    fireEvent.click(screen.getByRole("button", { name: "Backup" }));
    await waitFor(() => {
      expect(screen.getByText("disk full")).toBeInTheDocument();
    });
    expect(document.querySelector("#backup-status")).toHaveClass("error");
  });

  it("skips backup when the header controls are missing", async () => {
    document.body.innerHTML = `<section id="apps"></section>`;
    const backend = createBackend();
    const controller = mountApp({
      invoke: backend.invoke,
      openUrl: backend.openUrl,
      refreshIntervalMs: 0,
    });
    await controller.backupRepo();
    expect(backend.invoke).not.toHaveBeenCalledWith("backup_repo");
    controller.destroy();
  });

  it("does nothing when #apps is missing", async () => {
    document.body.innerHTML = `<button id="btn-backup">Backup</button><p id="backup-status" hidden></p>`;
    const backend = createBackend();
    const controller = mountApp({
      invoke: backend.invoke,
      openUrl: backend.openUrl,
      refreshIntervalMs: 0,
    });
    await controller.refreshStatus();
    expect(backend.invoke).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("polls for status and can be destroyed", async () => {
    jest.useFakeTimers();
    const backend = createBackend();
    const controller = mountApp({
      invoke: backend.invoke,
      openUrl: backend.openUrl,
      refreshIntervalMs: 1500,
    });
    await waitFor(() => expect(backend.invoke).toHaveBeenCalledWith("get_all_status"));
    const calls = backend.invoke.mock.calls.filter(([cmd]) => cmd === "get_all_status").length;
    jest.advanceTimersByTime(1500);
    await waitFor(() => {
      expect(
        backend.invoke.mock.calls.filter(([cmd]) => cmd === "get_all_status").length,
      ).toBeGreaterThan(calls);
    });
    controller.destroy();
    jest.useRealTimers();
  });
});
