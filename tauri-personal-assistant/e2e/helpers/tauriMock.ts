export type AppSeed = {
  id: string;
  name: string;
  running?: boolean;
  rebuilding?: boolean;
  canRebuild?: boolean;
  url?: string;
  stdout?: string;
  stderr?: string;
};

export type TauriSeed = {
  apps?: AppSeed[];
  fail?: Record<string, string>;
  backupPath?: string;
};

export const defaultE2eSeed: TauriSeed = {
  apps: [
    {
      id: "wiki",
      name: "Wiki",
      url: "http://localhost:8899",
      canRebuild: false,
      stdout: "wiki ready",
    },
    {
      id: "personal-data",
      name: "Personal Data App",
      canRebuild: true,
    },
    {
      id: "gmail-filter",
      name: "Gmail Filter Editor",
      canRebuild: true,
    },
  ],
  backupPath: "C:\\\\Users\\\\marc\\\\backups\\\\repo.zip",
};

export function installTauriMock() {
  const seed =
    (window as unknown as { __TAURI_MOCK_SEED__?: TauriSeed }).__TAURI_MOCK_SEED__ ?? {};
  const apps = (seed.apps ?? []).map((app) => ({
    id: app.id,
    name: app.name,
    running: Boolean(app.running),
    rebuilding: Boolean(app.rebuilding),
    canRebuild: Boolean(app.canRebuild),
    url: app.url,
    stdout: app.stdout ?? "",
    stderr: app.stderr ?? "",
  }));
  const fail = { ...(seed.fail ?? {}) };
  const opened: string[] = [];

  const internals = {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (fail[cmd]) throw fail[cmd];
      switch (cmd) {
        case "get_all_status":
          return apps.map(({ stdout: _stdout, stderr: _stderr, ...status }) => status);
        case "get_app_logs": {
          const app = apps.find((item) => item.id === args.appId);
          return { stdout: app?.stdout ?? "", stderr: app?.stderr ?? "" };
        }
        case "start_app": {
          const app = apps.find((item) => item.id === args.appId);
          if (app) app.running = true;
          return;
        }
        case "stop_app": {
          const app = apps.find((item) => item.id === args.appId);
          if (app) app.running = false;
          return;
        }
        case "rebuild_app": {
          const app = apps.find((item) => item.id === args.appId);
          if (app) {
            app.rebuilding = true;
            app.stdout = "cargo build started";
          }
          return;
        }
        case "backup_repo":
          return seed.backupPath ?? "C:\\\\backup.zip";
        case "plugin:opener|open_url":
          opened.push(String(args.url ?? ""));
          return;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    },
  };

  const win = window as unknown as {
    __TAURI_INTERNALS__: typeof internals;
    __TAURI_OPENED__: string[];
  };
  win.__TAURI_INTERNALS__ = internals;
  win.__TAURI_OPENED__ = opened;
}
