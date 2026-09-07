export interface AppStatus {
  id: string;
  name: string;
  running: boolean;
  rebuilding: boolean;
  canRebuild: boolean;
  url?: string;
}

export interface AppLogs {
  stdout: string;
  stderr: string;
}
