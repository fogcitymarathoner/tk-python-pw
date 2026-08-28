import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface AppStatus {
  id: string;
  name: string;
  running: boolean;
  rebuilding: boolean;
  canRebuild: boolean;
  url?: string;
}

interface AppLogs {
  stdout: string;
  stderr: string;
}

const appsContainer = document.querySelector("#apps") as HTMLElement;
const cardElements = new Map<string, HTMLElement>();
const openAccordions = new Set<string>();

function renderCard(app: AppStatus): HTMLElement {
  const card = document.createElement("article");
  card.className = "app-card";
  card.dataset.appId = app.id;

  card.innerHTML = `
    <div class="app-card-header">
      <h2>${app.name}</h2>
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

  card.querySelector(".btn-start")?.addEventListener("click", () => startApp(app.id));
  card.querySelector(".btn-stop")?.addEventListener("click", () => stopApp(app.id));
  card.querySelector(".btn-rebuild")?.addEventListener("click", () => rebuildApp(app.id));

  const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
  accordion.addEventListener("toggle", () => {
    if (accordion.open) {
      openAccordions.add(app.id);
    } else {
      openAccordions.delete(app.id);
    }
  });

  return card;
}

function updateCard(card: HTMLElement, app: AppStatus) {
  const badge = card.querySelector(".status-badge") as HTMLElement;
  const startBtn = card.querySelector(".btn-start") as HTMLButtonElement;
  const stopBtn = card.querySelector(".btn-stop") as HTMLButtonElement;
  const rebuildBtn = card.querySelector(".btn-rebuild") as HTMLButtonElement;
  const linkEl = card.querySelector(".app-link") as HTMLElement;

  if (app.rebuilding) {
    badge.textContent = "Rebuilding";
    badge.className = "status-badge rebuilding";
  } else {
    badge.textContent = app.running ? "Running" : "Stopped";
    badge.className = `status-badge ${app.running ? "running" : "stopped"}`;
  }

  startBtn.disabled = app.running || app.rebuilding;
  stopBtn.disabled = !app.running || app.rebuilding;

  if (app.canRebuild) {
    rebuildBtn.hidden = false;
    rebuildBtn.disabled = app.rebuilding;
    rebuildBtn.textContent = app.rebuilding ? "Rebuilding..." : "Rebuild";
  }

  if (app.running && app.url) {
    linkEl.innerHTML = `<a href="#" class="open-link">${app.url}</a>`;
    const link = linkEl.querySelector(".open-link");
    link?.replaceWith(link.cloneNode(true));
    linkEl.querySelector(".open-link")?.addEventListener("click", (event) => {
      event.preventDefault();
      void openUrl(app.url!);
    });
  } else {
    linkEl.textContent = app.url ? `Opens at ${app.url}` : "";
  }
}

function updateLogs(card: HTMLElement, logs: AppLogs) {
  const stdoutEl = card.querySelector(".log-stdout") as HTMLElement;
  const stderrEl = card.querySelector(".log-stderr") as HTMLElement;
  const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;

  const shouldStickToBottom =
    accordion.open &&
    stdoutEl.scrollHeight - stdoutEl.scrollTop - stdoutEl.clientHeight < 40;

  stdoutEl.textContent = logs.stdout || "(empty)";
  stderrEl.textContent = logs.stderr || "(empty)";

  if (shouldStickToBottom) {
    stdoutEl.scrollTop = stdoutEl.scrollHeight;
    stderrEl.scrollTop = stderrEl.scrollHeight;
  }
}

function showError(appId: string, message: string) {
  const card = cardElements.get(appId);
  if (!card) return;

  const errorEl = card.querySelector(".error-msg") as HTMLElement;
  errorEl.textContent = message;
  errorEl.hidden = false;
  window.setTimeout(() => {
    errorEl.hidden = true;
  }, 5000);
}

async function refreshStatus() {
  const apps = await invoke<AppStatus[]>("get_all_status");

  for (const app of apps) {
    let card = cardElements.get(app.id);
    if (!card) {
      card = renderCard(app);
      cardElements.set(app.id, card);
      appsContainer.appendChild(card);
    }
    updateCard(card, app);

    const logs = await invoke<AppLogs>("get_app_logs", { appId: app.id });
    updateLogs(card, logs);

    const accordion = card.querySelector(".log-accordion") as HTMLDetailsElement;
    accordion.open = openAccordions.has(app.id);
  }
}

async function startApp(appId: string) {
  try {
    openAccordions.add(appId);
    await invoke("start_app", { appId });
    await refreshStatus();
  } catch (error) {
    showError(appId, String(error));
  }
}

async function stopApp(appId: string) {
  try {
    await invoke("stop_app", { appId });
    await refreshStatus();
  } catch (error) {
    showError(appId, String(error));
  }
}

async function rebuildApp(appId: string) {
  try {
    openAccordions.add(appId);
    await invoke("rebuild_app", { appId });
    await refreshStatus();
  } catch (error) {
    showError(appId, String(error));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void refreshStatus();
  window.setInterval(() => {
    void refreshStatus();
  }, 1500);
});
