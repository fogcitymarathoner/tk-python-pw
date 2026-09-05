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

const PERSONAL_DATA_DIR: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri\src-tauri\target\x86_64-pc-windows-msvc\release";
const PERSONAL_DATA_EXE: &str = "personal-data.exe";
const PERSONAL_DATA_BUILD_DIR: &str = r"C:\Users\marc\Documents\repos\firebase_pw\tauri";

const GMAIL_FILTER_DIR: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\src-tauri\target\x86_64-pc-windows-msvc\release";
const GMAIL_FILTER_EXE: &str = "gmail-filter-editor.exe";
const GMAIL_FILTER_EXE_FALLBACK: &str = "tauri-app.exe";
const GMAIL_FILTER_BUILD_DIR: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AppId {
    Wiki,
    PersonalData,
    GmailFilter,
}

impl AppId {
    pub fn as_str(self) -> &'static str {
        match self {
            AppId::Wiki => "wiki",
            AppId::PersonalData => "personal-data",
            AppId::GmailFilter => "gmail-filter",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "wiki" => Some(AppId::Wiki),
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

const APP_DEFINITIONS: [AppDefinition; 3] = [
    AppDefinition {
        id: AppId::Wiki,
        name: "Wiki",
        url: Some(WIKI_URL),
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
            AppId::PersonalData => spawn_exe(PERSONAL_DATA_DIR, PERSONAL_DATA_EXE, logs)?,
            AppId::GmailFilter => spawn_exe(GMAIL_FILTER_DIR, gmail_filter_exe(), logs)?,
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
            AppId::Wiki => unreachable!(),
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

fn gmail_filter_exe() -> &'static str {
    let primary = PathBuf::from(GMAIL_FILTER_DIR).join(GMAIL_FILTER_EXE);
    if primary.exists() {
        GMAIL_FILTER_EXE
    } else {
        GMAIL_FILTER_EXE_FALLBACK
    }
}

fn spawn_exe(dir: &str, exe_name: &str, logs: Arc<LogBuffer>) -> Result<Child, String> {
    let exe_path = PathBuf::from(dir).join(exe_name);
    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(dir);
    spawn_with_logs(cmd, logs).map_err(|e| format!("Failed to start {}: {e}", exe_path.display()))
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
        AppId::PersonalData => is_exe_running(PERSONAL_DATA_EXE, PERSONAL_DATA_DIR),
        AppId::GmailFilter => {
            is_exe_running(GMAIL_FILTER_EXE, GMAIL_FILTER_DIR)
                || is_exe_running(GMAIL_FILTER_EXE_FALLBACK, GMAIL_FILTER_DIR)
        }
    }
}

fn find_external_pid(id: AppId) -> Option<u32> {
    match id {
        AppId::Wiki => find_pid_on_port(WIKI_PORT),
        AppId::PersonalData => find_exe_pid(PERSONAL_DATA_EXE, PERSONAL_DATA_DIR),
        AppId::GmailFilter => find_exe_pid(GMAIL_FILTER_EXE, GMAIL_FILTER_DIR)
            .or_else(|| find_exe_pid(GMAIL_FILTER_EXE_FALLBACK, GMAIL_FILTER_DIR)),
    }
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("valid localhost addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn is_exe_running(exe_name: &str, dir: &str) -> bool {
    find_exe_pid(exe_name, dir).is_some()
}

fn find_exe_pid(exe_name: &str, dir: &str) -> Option<u32> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let dir_lower = dir.to_lowercase();

    for (pid, process) in system.processes() {
        if !process.name().eq_ignore_ascii_case(exe_name) {
            continue;
        }

        if let Some(exe) = process.exe() {
            if exe.to_string_lossy().to_lowercase().contains(&dir_lower) {
                return Some(pid.as_u32());
            }
        }
    }

    None
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
