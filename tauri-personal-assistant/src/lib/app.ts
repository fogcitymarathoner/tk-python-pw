import type { AppLogs, AppStatus } from "../types";
import {
  actionButtonState,
  formatAppLink,
  shouldStickLogsToBottom,
  statusBadgeState,
} from "./cardState";

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type OpenUrlFn = (url: string) => Promise<unknown> | unknown;

export interface AppTimers {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface MountAppOptions {
  invoke: InvokeFn;
  openUrl: OpenUrlFn;
  icons?: Record<string, string>;
  refreshIntervalMs?: number;
  errorHideMs?: number;
  document?: Document;
  timers?: AppTimers;
}

export function renderCard(
  app: AppStatus,
  icons: Record<string, string>,
  onStart: (id: string) => void,
  onStop: (id: string) => void,
  onRebuild: (id: string) => void,
  onAccordionToggle: (id: string, open: boolean) => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "app-card";
  card.dataset.appId = app.id;

  card.innerHTML = `
    <div class="app-card-header">
      <h2>
        ${icons[app.id] ? `<img class="app-icon" src="${icons[app.id]}" alt="" />` : ""}
        <span>${app.name}</span>
      </h2>
      <span class="status-badge stopped">Stopped</span>
    </div>
    <p class="app-link"></p>
    <div class="app-actions">
      <button type="button" class="btn-start">Start</button>
      <button type="button" class="btn-stop" disabled>Stop</button>
      <button type="button" class="btn-rebuild" hidden>Rebuild</button>
    </div>
    <p class="error-msg" hidden></p>
    <details class="log-accordion">
      <summary>Logs</summary>
      <div class="log-panels">
        <div class="log-panel">
          <div class="log-panel-header">stdout</div>
          <pre class="log-stdout"></pre>
        </div>
        <div class="log-panel">
          <div class="log-panel-header">stderr</div>
          <pre class="log-stderr"></pre>
        </div>
      </div>
    </details>
  `;

  card.querySelector(".btn-start")?.addEventListener("click", () => onStart(app.id));
  card.querySelector(".btn-stop")?.addEventListener("click", () => onStop(app.id));
  card.querySelector(".btn-rebuild")?.addEventListener("click", () => onRebuild(app.id));

  const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
  accordion.addEventListener("toggle", () => {
    onAccordionToggle(app.id, accordion.open);
  });

  return card;
}

export function updateCard(card: HTMLElement, app: AppStatus, openUrl: OpenUrlFn) {
  const badge = card.querySelector(".status-badge") as HTMLElement;
  const startBtn = card.querySelector(".btn-start") as HTMLButtonElement;
  const stopBtn = card.querySelector(".btn-stop") as HTMLButtonElement;
  const rebuildBtn = card.querySelector(".btn-rebuild") as HTMLButtonElement;
  const linkEl = card.querySelector(".app-link") as HTMLElement;

  const badgeState = statusBadgeState(app);
  badge.textContent = badgeState.text;
  badge.className = badgeState.className;

  const buttons = actionButtonState(app);
  startBtn.disabled = buttons.startDisabled;
  stopBtn.disabled = buttons.stopDisabled;

  if (buttons.rebuildVisible) {
    rebuildBtn.hidden = false;
    rebuildBtn.disabled = buttons.rebuildDisabled;
    rebuildBtn.textContent = buttons.rebuildText;
  }

  const link = formatAppLink(app);
  if (link.mode === "link") {
    linkEl.innerHTML = `<a href="#" class="open-link">${link.text}</a>`;
    const previous = linkEl.querySelector(".open-link");
    previous?.replaceWith(previous.cloneNode(true));
    linkEl.querySelector(".open-link")?.addEventListener("click", (event) => {
      event.preventDefault();
      void openUrl(app.url!);
    });
  } else {
    linkEl.textContent = link.text;
  }
}

export function updateLogs(card: HTMLElement, logs: AppLogs) {
  const stdoutEl = card.querySelector(".log-stdout") as HTMLElement;
  const stderrEl = card.querySelector(".log-stderr") as HTMLElement;
  const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;

  const shouldStick = shouldStickLogsToBottom(stdoutEl, accordion.open);

  stdoutEl.textContent = logs.stdout || "(empty)";
  stderrEl.textContent = logs.stderr || "(empty)";

  if (shouldStick) {
    stdoutEl.scrollTop = stdoutEl.scrollHeight;
    stderrEl.scrollTop = stderrEl.scrollHeight;
  }
}

export function showError(
  card: HTMLElement | undefined,
  message: string,
  hideMs: number,
  setTimeoutFn: typeof setTimeout,
) {
  if (!card) return;

  const errorEl = card.querySelector(".error-msg") as HTMLElement;
  errorEl.textContent = message;
  errorEl.hidden = false;
  setTimeoutFn(() => {
    errorEl.hidden = true;
  }, hideMs);
}

export function mountApp(options: MountAppOptions) {
  const doc = options.document ?? document;
  const timers: AppTimers = options.timers ?? {
    setTimeout,
    setInterval,
    clearInterval,
  };
  const icons = options.icons ?? {};
  const refreshIntervalMs = options.refreshIntervalMs ?? 1500;
  const errorHideMs = options.errorHideMs ?? 5000;

  const appsContainer = doc.querySelector("#apps") as HTMLElement | null;
  const cardElements = new Map<string, HTMLElement>();
  const openAccordions = new Set<string>();

  const showAppError = (appId: string, message: string) => {
    showError(cardElements.get(appId), message, errorHideMs, timers.setTimeout);
  };

  const refreshStatus = async () => {
    if (!appsContainer) return;
    const apps = (await options.invoke("get_all_status")) as AppStatus[];

    for (const app of apps) {
      let card = cardElements.get(app.id);
      if (!card) {
        card = renderCard(
          app,
          icons,
          (id) => void startApp(id),
          (id) => void stopApp(id),
          (id) => void rebuildApp(id),
          (id, open) => {
            if (open) {
              openAccordions.add(id);
            } else {
              openAccordions.delete(id);
            }
          },
        );
        cardElements.set(app.id, card);
        appsContainer.appendChild(card);
      }
      updateCard(card, app, options.openUrl);

      const logs = (await options.invoke("get_app_logs", { appId: app.id })) as AppLogs;
      updateLogs(card, logs);

      const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
      accordion.open = openAccordions.has(app.id);
    }
  };

  const startApp = async (appId: string) => {
    try {
      openAccordions.add(appId);
      await options.invoke("start_app", { appId });
      await refreshStatus();
    } catch (error) {
      showAppError(appId, String(error));
    }
  };

  const stopApp = async (appId: string) => {
    try {
      await options.invoke("stop_app", { appId });
      await refreshStatus();
    } catch (error) {
      showAppError(appId, String(error));
    }
  };

  const rebuildApp = async (appId: string) => {
    try {
      openAccordions.add(appId);
      await options.invoke("rebuild_app", { appId });
      await refreshStatus();
    } catch (error) {
      showAppError(appId, String(error));
    }
  };

  const backupRepo = async () => {
    const button = doc.querySelector("#btn-backup") as HTMLButtonElement | null;
    const status = doc.querySelector("#backup-status") as HTMLElement | null;
    if (!button || !status) return;

    button.disabled = true;
    status.hidden = false;
    status.classList.remove("error");
    status.textContent = "Creating zip backup…";

    try {
      const path = (await options.invoke("backup_repo")) as string;
      status.textContent = `Backup saved to ${path}`;
    } catch (error) {
      status.classList.add("error");
      status.textContent = String(error);
    } finally {
      button.disabled = false;
    }
  };

  doc.querySelector("#btn-backup")?.addEventListener("click", () => {
    void backupRepo();
  });

  void refreshStatus();
  const intervalId =
    refreshIntervalMs > 0
      ? timers.setInterval(() => {
          void refreshStatus();
        }, refreshIntervalMs)
      : undefined;

  return {
    refreshStatus,
    startApp,
    stopApp,
    rebuildApp,
    backupRepo,
    cardElements,
    openAccordions,
    destroy() {
      if (intervalId !== undefined) {
        timers.clearInterval(intervalId);
      }
    },
  };
}
