use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};

const MAX_LOG_CHARS: usize = 80_000;

const WIKI_DIR: &str = r"C:\Users\marc\Documents\repos\mopo-ai\wiki";
const WIKI_PORT: u16 = 8899;
const WIKI_URL: &str = "http://localhost:8899";

const DATABASE_API_DIR: &str = r"C:\Users\marc\Documents\repos\firebase_pw\api";
const DATABASE_API_PORT: u16 = 8900;
const DATABASE_API_URL: &str = "http://localhost:8900";

const PERSONAL_DATA_ROOT: &str = r"C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri";
const PERSONAL_DATA_EXE: &str = "personal-data.exe";
const PERSONAL_DATA_BUILD_DIR: &str = r"C:\Users\marc\Documents\repos\firebase_pw\tauri";

const GMAIL_FILTER_ROOT: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\src-tauri";
const GMAIL_FILTER_EXE: &str = "gmail-filter-editor.exe";
const GMAIL_FILTER_EXE_FALLBACK: &str = "tauri-app.exe";
const GMAIL_FILTER_BUILD_DIR: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters";

/// Directories a monitored app may be running from. `tauri build` on this
/// machine writes `target\release`; an explicit `--target` build uses the triple.
const MONITORED_TARGET_DIRS: [&str; 4] = [
    r"target\release",
    r"target\x86_64-pc-windows-msvc\release",
    r"target\debug",
    r"target\x86_64-pc-windows-msvc\debug",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AppId {
    Wiki,
    DatabaseApi,
    PersonalData,
    GmailFilter,
}

impl AppId {
    pub fn as_str(self) -> &'static str {
        match self {
            AppId::Wiki => "wiki",
            AppId::DatabaseApi => "database-api",
            AppId::PersonalData => "personal-data",
            AppId::GmailFilter => "gmail-filter",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "wiki" => Some(AppId::Wiki),
            "database-api" => Some(AppId::DatabaseApi),
            "personal-data" => Some(AppId::PersonalData),
            "gmail-filter" => Some(AppId::GmailFilter),
            _ => None,
        }
    }

    pub fn can_rebuild(self) -> bool {
        matches!(self, AppId::PersonalData | AppId::GmailFilter)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub name: String,
    pub running: bool,
    pub rebuilding: bool,
    pub can_rebuild: bool,
    pub url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppLogs {
    pub stdout: String,
    pub stderr: String,
}

struct AppDefinition {
    id: AppId,
    name: &'static str,
    url: Option<&'static str>,
}

const APP_DEFINITIONS: [AppDefinition; 4] = [
    AppDefinition {
        id: AppId::Wiki,
        name: "Wiki",
        url: Some(WIKI_URL),
    },
    AppDefinition {
        id: AppId::DatabaseApi,
        name: "Database API",
        url: Some(DATABASE_API_URL),
    },
    AppDefinition {
        id: AppId::PersonalData,
        name: "Personal Data App",
        url: None,
    },
    AppDefinition {
        id: AppId::GmailFilter,
        name: "Gmail Filter Editor",
        url: None,
    },
];

struct LogBuffer {
    stdout: Mutex<String>,
    stderr: Mutex<String>,
}

impl LogBuffer {
    fn new() -> Self {
        Self {
            stdout: Mutex::new(String::new()),
            stderr: Mutex::new(String::new()),
        }
    }

    fn clear(&self) {
        if let Ok(mut stdout) = self.stdout.lock() {
            stdout.clear();
        }
        if let Ok(mut stderr) = self.stderr.lock() {
            stderr.clear();
        }
    }

    fn append_stdout(&self, text: &str) {
        append_limited(&self.stdout, text);
    }

    fn append_stderr(&self, text: &str) {
        append_limited(&self.stderr, text);
    }

    fn snapshot(&self) -> AppLogs {
        AppLogs {
            stdout: self.stdout.lock().map(|s| s.clone()).unwrap_or_default(),
            stderr: self.stderr.lock().map(|s| s.clone()).unwrap_or_default(),
        }
    }
}

fn append_limited(mutex: &Mutex<String>, text: &str) {
    if let Ok(mut buffer) = mutex.lock() {
        buffer.push_str(text);
        if buffer.len() > MAX_LOG_CHARS {
            let keep_from = buffer.len() - MAX_LOG_CHARS;
            *buffer = buffer.split_off(keep_from);
        }
    }
}

pub struct ProcessManager {
    children: Mutex<HashMap<AppId, Child>>,
    rebuilds: Mutex<HashMap<AppId, Child>>,
    logs: Mutex<HashMap<AppId, Arc<LogBuffer>>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            children: Mutex::new(HashMap::new()),
            rebuilds: Mutex::new(HashMap::new()),
            logs: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_all_status(&self) -> Vec<AppStatus> {
        APP_DEFINITIONS
            .iter()
            .map(|app| AppStatus {
                id: app.id.as_str().to_string(),
                name: app.name.to_string(),
                running: self.is_running(app.id),
                rebuilding: self.is_rebuilding(app.id),
                can_rebuild: app.id.can_rebuild(),
                url: app.url.map(str::to_string),
            })
            .collect()
    }

    pub fn get_logs(&self, id: AppId) -> AppLogs {
        self.log_buffer(id).snapshot()
    }

    pub fn start(&self, id: AppId) -> Result<(), String> {
        if self.is_rebuilding(id) {
            return Err(format!("{} is rebuilding", app_name(id)));
        }
        if self.is_running(id) {
            return Err(format!("{} is already running", app_name(id)));
        }

        let logs = self.log_buffer(id);
        logs.clear();
        logs.append_stdout(&format!("Starting {}...\n", app_name(id)));

        let child = match id {
            AppId::Wiki => spawn_wiki(logs)?,
            AppId::DatabaseApi => spawn_database_api(logs)?,
            AppId::PersonalData => {
                spawn_monitored(PERSONAL_DATA_ROOT, &[PERSONAL_DATA_EXE], logs)?
            }
            AppId::GmailFilter => spawn_monitored(
                GMAIL_FILTER_ROOT,
                &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
                logs,
            )?,
        };

        self.children
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, child);

        Ok(())
    }

    pub fn stop(&self, id: AppId) -> Result<(), String> {
        if !self.is_running(id) {
            return Err(format!("{} is not running", app_name(id)));
        }

        let mut children = self.children.lock().map_err(|e| e.to_string())?;
        if let Some(child) = children.remove(&id) {
            kill_process(child.id())?;
        } else if let Some(pid) = find_external_pid(id) {
            kill_process(pid)?;
        }

        self.log_buffer(id)
            .append_stdout(&format!("\n{} stopped.\n", app_name(id)));

        Ok(())
    }

    pub fn rebuild(&self, id: AppId) -> Result<(), String> {
        if !id.can_rebuild() {
            return Err(format!("{} cannot be rebuilt from here", app_name(id)));
        }
        if self.is_rebuilding(id) {
            return Err(format!("{} is already rebuilding", app_name(id)));
        }

        let build_dir = match id {
            AppId::PersonalData => PERSONAL_DATA_BUILD_DIR,
            AppId::GmailFilter => GMAIL_FILTER_BUILD_DIR,
            AppId::Wiki | AppId::DatabaseApi => unreachable!(),
        };

        let logs = self.log_buffer(id);
        logs.clear();
        logs.append_stdout(&format!(
            "Running rebuild in {build_dir}\n> npm run tauri build\n\n"
        ));

        let child = spawn_npm_tauri_build(build_dir, logs)?;

        self.rebuilds
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, child);

        Ok(())
    }

    fn log_buffer(&self, id: AppId) -> Arc<LogBuffer> {
        let mut logs = self.logs.lock().expect("logs lock");
        logs.entry(id)
            .or_insert_with(|| Arc::new(LogBuffer::new()))
            .clone()
    }

    fn is_running(&self, id: AppId) -> bool {
        if let Ok(mut children) = self.children.lock() {
            if let Some(child) = children.get_mut(&id) {
                match child.try_wait() {
                    Ok(None) => return true,
                    Ok(Some(status)) => {
                        self.log_buffer(id).append_stdout(&format!(
                            "\nProcess exited with status: {status}\n"
                        ));
                        children.remove(&id);
                    }
                    Err(error) => {
                        self.log_buffer(id)
                            .append_stderr(&format!("\nFailed to poll process: {error}\n"));
                        children.remove(&id);
                    }
                }
            }
        }

        detect_external_running(id)
    }

    fn is_rebuilding(&self, id: AppId) -> bool {
        if let Ok(mut rebuilds) = self.rebuilds.lock() {
            if let Some(child) = rebuilds.get_mut(&id) {
                match child.try_wait() {
                    Ok(None) => return true,
                    Ok(Some(status)) => {
                        let logs = self.log_buffer(id);
                        if status.success() {
                            logs.append_stdout("\nRebuild completed successfully.\n");
                        } else {
                            logs.append_stderr(&format!("\nRebuild failed with status: {status}\n"));
                        }
                        rebuilds.remove(&id);
                    }
                    Err(error) => {
                        self.log_buffer(id)
                            .append_stderr(&format!("\nFailed to poll rebuild: {error}\n"));
                        rebuilds.remove(&id);
                    }
                }
            }
        }

        false
    }
}

fn app_name(id: AppId) -> &'static str {
    APP_DEFINITIONS
        .iter()
        .find(|app| app.id == id)
        .map(|app| app.name)
        .unwrap_or("App")
}

fn spawn_with_logs(mut cmd: Command, logs: Arc<LogBuffer>) -> Result<Child, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let logs = Arc::clone(&logs);
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                logs.append_stdout(&format!("{line}\n"));
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let logs = Arc::clone(&logs);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                logs.append_stderr(&format!("{line}\n"));
            }
        });
    }

    Ok(child)
}

fn spawn_wiki(logs: Arc<LogBuffer>) -> Result<Child, String> {
    let mut cmd = Command::new("node");
    cmd.arg("server").current_dir(WIKI_DIR);
    spawn_with_logs(cmd, logs)
}

fn spawn_database_api(logs: Arc<LogBuffer>) -> Result<Child, String> {
    let mut cmd = Command::new("node");
    cmd.args(["--disable-warning=ExperimentalWarning", "src/index.ts"])
        .current_dir(DATABASE_API_DIR);
    spawn_with_logs(cmd, logs)
}

fn spawn_monitored(root: &str, exe_names: &[&str], logs: Arc<LogBuffer>) -> Result<Child, String> {
    let exe_path = resolve_monitored_exe(root, exe_names);
    let mut cmd = Command::new(&exe_path);
    if let Some(dir) = exe_path.parent() {
        cmd.current_dir(dir);
    }
    spawn_with_logs(cmd, logs).map_err(|e| format!("Failed to start {}: {e}", exe_path.display()))
}

fn resolve_monitored_exe(root: &str, exe_names: &[&str]) -> PathBuf {
    for exe_name in exe_names {
        for dir in MONITORED_TARGET_DIRS {
            let path = PathBuf::from(root).join(dir).join(exe_name);
            if path.is_file() {
                return path;
            }
        }
    }

    PathBuf::from(root)
        .join(MONITORED_TARGET_DIRS[0])
        .join(exe_names.first().copied().unwrap_or("app.exe"))
}

fn spawn_npm_tauri_build(dir: &str, logs: Arc<LogBuffer>) -> Result<Child, String> {
    let mut cmd = npm_command();
    cmd.args(["run", "tauri", "build"]).current_dir(dir);
    spawn_with_logs(cmd, logs)
}

fn npm_command() -> Command {
    #[cfg(windows)]
    {
        Command::new("npm.cmd")
    }
    #[cfg(not(windows))]
    {
        Command::new("npm")
    }
}

fn detect_external_running(id: AppId) -> bool {
    match id {
        AppId::Wiki => is_port_open(WIKI_PORT),
        AppId::DatabaseApi => is_port_open(DATABASE_API_PORT),
        AppId::PersonalData => {
            find_monitored_pid(&[PERSONAL_DATA_EXE], PERSONAL_DATA_ROOT).is_some()
        }
        AppId::GmailFilter => find_monitored_pid(
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        )
        .is_some(),
    }
}

fn find_external_pid(id: AppId) -> Option<u32> {
    match id {
        AppId::Wiki => find_pid_on_port(WIKI_PORT),
        AppId::DatabaseApi => find_pid_on_port(DATABASE_API_PORT),
        AppId::PersonalData => find_monitored_pid(&[PERSONAL_DATA_EXE], PERSONAL_DATA_ROOT),
        AppId::GmailFilter => find_monitored_pid(
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ),
    }
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("valid localhost addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn find_monitored_pid(exe_names: &[&str], root: &str) -> Option<u32> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);

    for (pid, process) in system.processes() {
        let name = process.name().to_string_lossy();
        let exe = process
            .exe()
            .map(|path| path.to_string_lossy().into_owned());
        if monitored_process_matches(&name, exe.as_deref(), exe_names, root) {
            return Some(pid.as_u32());
        }
    }

    None
}

fn monitored_process_matches(
    process_name: &str,
    exe_path: Option<&str>,
    exe_names: &[&str],
    root: &str,
) -> bool {
    let matched_name = exe_names
        .iter()
        .find(|expected| process_name.eq_ignore_ascii_case(expected));
    let Some(matched_name) = matched_name else {
        return false;
    };

    let Some(exe_path) = exe_path.map(normalize_path).filter(|path| !path.is_empty()) else {
        // sysinfo can report a matching process with no image path. Unique exe
        // names are still the app we monitor; the generic fallback name is not.
        return !is_generic_exe(matched_name);
    };

    path_is_under(&exe_path, root)
}

fn is_generic_exe(name: &str) -> bool {
    name.eq_ignore_ascii_case(GMAIL_FILTER_EXE_FALLBACK)
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase()
}

fn path_is_under(exe_path: &str, root: &str) -> bool {
    let exe_path = normalize_path(exe_path);
    let mut root = normalize_path(root);
    if !root.ends_with('\\') {
        root.push('\\');
    }
    exe_path.starts_with(&root)
}

fn find_pid_on_port(port: u16) -> Option<u32> {
    let output = Command::new("netstat").args(["-ano"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let port_suffix = format!(":{port}");

    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&port_suffix) {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(pid_str) = parts.last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                return Some(pid);
            }
        }
    }

    None
}

fn kill_process(pid: u32) -> Result<(), String> {
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|e| format!("Failed to stop process: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to stop process {pid}: {stderr}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_host_release_build_after_restart() {
        assert!(monitored_process_matches(
            "personal-data.exe",
            Some(r"C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri\target\release\personal-data.exe"),
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
        assert!(monitored_process_matches(
            "gmail-filter-editor.exe",
            Some(r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\src-tauri\target\release\gmail-filter-editor.exe"),
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ));
    }

    #[test]
    fn detects_explicit_msvc_target_and_debug_builds() {
        assert!(monitored_process_matches(
            "personal-data.exe",
            Some(r"C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri\target\x86_64-pc-windows-msvc\release\personal-data.exe"),
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
        assert!(monitored_process_matches(
            "gmail-filter-editor.exe",
            Some(r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\src-tauri\target\debug\gmail-filter-editor.exe"),
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ));
    }

    #[test]
    fn ignores_the_same_exe_outside_its_project() {
        assert!(!monitored_process_matches(
            "personal-data.exe",
            Some(r"D:\apps\personal-data.exe"),
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
        assert!(!monitored_process_matches(
            "tauri-app.exe",
            Some(r"C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri\target\release\tauri-app.exe"),
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ));
    }

    #[test]
    fn matches_a_unique_exe_when_the_image_path_is_missing() {
        assert!(monitored_process_matches(
            "Personal-Data.EXE",
            None,
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
        assert!(monitored_process_matches(
            "gmail-filter-editor.exe",
            Some(""),
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ));
        assert!(!monitored_process_matches(
            "tauri-app.exe",
            None,
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ));
    }

    #[test]
    fn accepts_extended_and_forward_slash_paths() {
        assert!(monitored_process_matches(
            "personal-data.exe",
            Some(r"\\?\C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri\target\release\personal-data.exe"),
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
        assert!(monitored_process_matches(
            "personal-data.exe",
            Some("C:/Users/marc/Documents/repos/firebase_pw/tauri/src-tauri/target/debug/personal-data.exe"),
            &[PERSONAL_DATA_EXE],
            PERSONAL_DATA_ROOT,
        ));
    }

    #[test]
    fn resolves_the_built_release_binary() {
        let personal = resolve_monitored_exe(PERSONAL_DATA_ROOT, &[PERSONAL_DATA_EXE]);
        assert!(
            personal.ends_with(r"target\release\personal-data.exe"),
            "{}",
            personal.display()
        );

        let gmail = resolve_monitored_exe(
            GMAIL_FILTER_ROOT,
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
        );
        assert!(
            gmail.ends_with(r"target\release\gmail-filter-editor.exe"),
            "{}",
            gmail.display()
        );
    }
}
