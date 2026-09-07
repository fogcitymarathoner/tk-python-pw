import type { AppStatus } from "../types";

export function statusBadgeState(app: AppStatus): { text: string; className: string } {
  if (app.rebuilding) {
    return { text: "Rebuilding", className: "status-badge rebuilding" };
  }
  return {
    text: app.running ? "Running" : "Stopped",
    className: `status-badge ${app.running ? "running" : "stopped"}`,
  };
}

export function actionButtonState(app: AppStatus) {
  return {
    startDisabled: app.running || app.rebuilding,
    stopDisabled: !app.running || app.rebuilding,
    rebuildVisible: app.canRebuild,
    rebuildDisabled: app.rebuilding,
    rebuildText: app.rebuilding ? "Rebuilding..." : "Rebuild",
  };
}

export function formatAppLink(
  app: AppStatus,
): { mode: "link" | "hint" | "empty"; text: string } {
  if (app.running && app.url) {
    return { mode: "link", text: app.url };
  }
  if (app.url) {
    return { mode: "hint", text: `Opens at ${app.url}` };
  }
  return { mode: "empty", text: "" };
}

export function shouldStickLogsToBottom(
  el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  accordionOpen: boolean,
): boolean {
  return accordionOpen && el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
