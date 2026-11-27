use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};

const MAX_LOG_BYTES: usize = 5_000_000;
const REBUILD_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

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
const GMAIL_FILTER_RRG_XML: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\mailFiltersRRG.xml";
const GMAIL_FILTER_FOG_XML: &str =
    r"C:\Users\marc\Documents\repos\firebase_pw\tauri-email-filters\mailFiltersFog.xml";

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
        if buffer.len() > MAX_LOG_BYTES {
            let mut keep_from = buffer.len() - MAX_LOG_BYTES;
            while !buffer.is_char_boundary(keep_from) {
                keep_from += 1;
            }
            *buffer = buffer.split_off(keep_from);
        }
    }
}

struct RebuildHandle {
    is_done: Arc<AtomicBool>,
}

pub struct ProcessManager {
    children: Mutex<HashMap<AppId, Vec<Child>>>,
    rebuilds: Mutex<HashMap<AppId, RebuildHandle>>,
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

        let children = match id {
            AppId::Wiki => vec![spawn_wiki(logs)?],
            AppId::DatabaseApi => vec![spawn_database_api(logs)?],
            AppId::PersonalData => vec![
                spawn_monitored(PERSONAL_DATA_ROOT, &[PERSONAL_DATA_EXE], logs)?
            ],
            AppId::GmailFilter => spawn_gmail_filter_dual(logs)?,
        };

        self.children
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, children);

        Ok(())
    }

    pub fn stop(&self, id: AppId) -> Result<(), String> {
        if !self.is_running(id) {
            return Err(format!("{} is not running", app_name(id)));
        }

        let mut children_map = self.children.lock().map_err(|e| e.to_string())?;
        if let Some(children) = children_map.remove(&id) {
            for child in children {
                let _ = kill_process(child.id());
            }
        }

        for pid in find_all_external_pids(id) {
            let _ = kill_process(pid);
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

        if self.is_running(id) {
            logs.append_stdout(&format!(
                "Stopping running instance of {} before rebuild...\n",
                app_name(id)
            ));
            if let Err(e) = self.stop(id) {
                logs.append_stderr(&format!(
                    "Warning: failed to stop {}: {e}\n",
                    app_name(id)
                ));
            }
            thread::sleep(Duration::from_millis(200));
        }

        logs.append_stdout(&format!(
            "Running rebuild in {build_dir}\n> npm run tauri build -- --no-bundle --verbose -- --verbose\n\n"
        ));

        let (mut child, output_streams_remaining) =
            spawn_npm_tauri_build(build_dir, Arc::clone(&logs))?;

        let is_done = Arc::new(AtomicBool::new(false));
        let is_done_thread = Arc::clone(&is_done);
        let logs_heartbeat = Arc::clone(&logs);
        thread::spawn(move || {
            let start = std::time::Instant::now();
            while !is_done_thread.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(2));
                if is_done_thread.load(Ordering::Relaxed) {
                    break;
                }
                let elapsed = start.elapsed().as_secs();
                logs_heartbeat.append_stdout(&format!(
                    "[rebuild] Compiling... ({elapsed}s elapsed)\n"
                ));
            }
        });

        let is_done_monitor = Arc::clone(&is_done);
        let logs_monitor = Arc::clone(&logs);
        thread::spawn(move || {
            let status = child.wait();
            let drain_start = std::time::Instant::now();
            while output_streams_remaining.load(Ordering::Acquire) > 0
                && drain_start.elapsed() < REBUILD_OUTPUT_DRAIN_TIMEOUT
            {
                thread::sleep(Duration::from_millis(50));
            }

            if output_streams_remaining.load(Ordering::Acquire) > 0 {
                logs_monitor.append_stderr(
                    "\nBuild process exited, but an output pipe remained open; some final output may be missing.\n",
                );
                logs_monitor.append_stdout(
                    "\nBuild process exited, but an output pipe remained open; some final output may be missing.\n",
                );
            }

            match status {
                Ok(status) if status.success() => {
                    logs_monitor.append_stdout("\nRebuild completed successfully.\n");
                }
                Ok(status) => {
                    logs_monitor.append_stdout(&format!(
                        "\nRebuild failed with status: {status}. Check stderr panel for details.\n"
                    ));
                    logs_monitor.append_stderr(&format!("\nRebuild failed with status: {status}\n"));
                }
                Err(error) => {
                    logs_monitor.append_stdout(&format!("\nFailed to wait for rebuild: {error}\n"));
                    logs_monitor.append_stderr(&format!("\nFailed to wait for rebuild: {error}\n"));
                }
            }

            is_done_monitor.store(true, Ordering::Release);
        });

        self.rebuilds
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, RebuildHandle { is_done });

        Ok(())
    }

    fn log_buffer(&self, id: AppId) -> Arc<LogBuffer> {
        let mut logs = self.logs.lock().expect("logs lock");
        logs.entry(id)
            .or_insert_with(|| Arc::new(LogBuffer::new()))
            .clone()
    }

    fn is_running(&self, id: AppId) -> bool {
        if let Ok(mut children_map) = self.children.lock() {
            if let Some(children) = children_map.get_mut(&id) {
                children.retain_mut(|child| match child.try_wait() {
                    Ok(None) => true,
                    Ok(Some(status)) => {
                        self.log_buffer(id).append_stdout(&format!(
                            "\nProcess exited with status: {status}\n"
                        ));
                        false
                    }
                    Err(error) => {
                        self.log_buffer(id)
                            .append_stderr(&format!("\nFailed to poll process: {error}\n"));
                        false
                    }
                });

                if !children.is_empty() {
                    return true;
                }
                children_map.remove(&id);
            }
        }

        detect_external_running(id)
    }

    fn is_rebuilding(&self, id: AppId) -> bool {
        if let Ok(mut rebuilds) = self.rebuilds.lock() {
            if let Some(handle) = rebuilds.get(&id) {
                if handle.is_done.load(Ordering::Acquire) {
                    rebuilds.remove(&id);
                } else {
                    return true;
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

fn spawn_with_logs(cmd: Command, logs: Arc<LogBuffer>) -> Result<Child, String> {
    spawn_with_logs_and_completion(cmd, logs).map(|(child, _)| child)
}

fn spawn_with_logs_and_completion(
    mut cmd: Command,
    logs: Arc<LogBuffer>,
) -> Result<(Child, Arc<AtomicUsize>), String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {e}"))?;
    let output_streams_remaining = Arc::new(AtomicUsize::new(0));

    if let Some(stdout) = child.stdout.take() {
        let logs = Arc::clone(&logs);
        let output_streams_remaining = Arc::clone(&output_streams_remaining);
        output_streams_remaining.fetch_add(1, Ordering::Relaxed);
        thread::spawn(move || {
            read_log_stream(stdout, |line| logs.append_stdout(&line));
            output_streams_remaining.fetch_sub(1, Ordering::Release);
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let logs = Arc::clone(&logs);
        let output_streams_remaining = Arc::clone(&output_streams_remaining);
        output_streams_remaining.fetch_add(1, Ordering::Relaxed);
        thread::spawn(move || {
            read_log_stream(stderr, |line| {
                logs.append_stderr(&line);
                logs.append_stdout(&line);
            });
            output_streams_remaining.fetch_sub(1, Ordering::Release);
        });
    }

    Ok((child, output_streams_remaining))
}

fn read_log_stream<R: std::io::Read>(stream: R, mut append: impl FnMut(&str)) {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&line);
                let line = line.trim_end_matches(|character| character == '\r' || character == '\n');
                append(&format!("{line}\n"));
            }
        }
    }
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

fn spawn_gmail_filter_dual(logs: Arc<LogBuffer>) -> Result<Vec<Child>, String> {
    let exe_path = resolve_monitored_exe(
        GMAIL_FILTER_ROOT,
        &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
    );

    let mut cmd_rrg = Command::new(&exe_path);
    if let Some(dir) = exe_path.parent() {
        cmd_rrg.current_dir(dir);
    }
    cmd_rrg.args(["--file", GMAIL_FILTER_RRG_XML]);
    logs.append_stdout(&format!(
        "Launching left window: {} --file \"{}\"\n",
        exe_path.display(),
        GMAIL_FILTER_RRG_XML
    ));
    let child_rrg = spawn_with_logs(cmd_rrg, Arc::clone(&logs))
        .map_err(|e| format!("Failed to start {} (RRG): {e}", exe_path.display()))?;

    let mut cmd_fog = Command::new(&exe_path);
    if let Some(dir) = exe_path.parent() {
        cmd_fog.current_dir(dir);
    }
    cmd_fog.args(["--file", GMAIL_FILTER_FOG_XML]);
    logs.append_stdout(&format!(
        "Launching right window: {} --file \"{}\"\n",
        exe_path.display(),
        GMAIL_FILTER_FOG_XML
    ));
    let child_fog = spawn_with_logs(cmd_fog, logs)
        .map_err(|e| format!("Failed to start {} (Fog): {e}", exe_path.display()))?;

    #[cfg(windows)]
    {
        let pid_left = child_rrg.id();
        let pid_right = child_fog.id();
        thread::spawn(move || {
            position_dual_windows(pid_left, pid_right);
        });
    }

    Ok(vec![child_rrg, child_fog])
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

fn npm_tauri_build_args() -> [&'static str; 8] {
    ["run", "tauri", "build", "--", "--no-bundle", "--verbose", "--", "--verbose"]
}

fn spawn_npm_tauri_build(
    dir: &str,
    logs: Arc<LogBuffer>,
) -> Result<(Child, Arc<AtomicUsize>), String> {
    let mut cmd = npm_command();
    cmd.args(npm_tauri_build_args()).current_dir(dir);
    spawn_with_logs_and_completion(cmd, logs)
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

fn find_all_external_pids(id: AppId) -> Vec<u32> {
    match id {
        AppId::Wiki => find_pid_on_port(WIKI_PORT).into_iter().collect(),
        AppId::DatabaseApi => find_pid_on_port(DATABASE_API_PORT).into_iter().collect(),
        AppId::PersonalData => find_all_monitored_pids(&[PERSONAL_DATA_EXE], PERSONAL_DATA_ROOT),
        AppId::GmailFilter => find_all_monitored_pids(
            &[GMAIL_FILTER_EXE, GMAIL_FILTER_EXE_FALLBACK],
            GMAIL_FILTER_ROOT,
        ),
    }
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("valid localhost addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn find_all_monitored_pids(exe_names: &[&str], root: &str) -> Vec<u32> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut pids = Vec::new();

    for (pid, process) in system.processes() {
        let name = process.name().to_string_lossy();
        let exe = process
            .exe()
            .map(|path| path.to_string_lossy().into_owned());
        if monitored_process_matches(&name, exe.as_deref(), exe_names, root) {
            pids.push(pid.as_u32());
        }
    }

    pids
}

fn find_monitored_pid(exe_names: &[&str], root: &str) -> Option<u32> {
    find_all_monitored_pids(exe_names, root).into_iter().next()
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

#[cfg(windows)]
unsafe extern "system" fn enum_windows_callback(
    hwnd: windows_sys::Win32::Foundation::HWND,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::BOOL {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };
    let target = &mut *(lparam as *mut (u32, Option<windows_sys::Win32::Foundation::HWND>));
    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    if process_id == target.0
        && IsWindowVisible(hwnd) != 0
        && GetWindow(hwnd, GW_OWNER) == std::ptr::null_mut()
        && GetWindowTextLengthW(hwnd) > 0
    {
        target.1 = Some(hwnd);
        return 0;
    }
    1
}

#[cfg(windows)]
fn find_window_for_pid(pid: u32) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;
    let mut target = (pid, None);
    unsafe {
        EnumWindows(Some(enum_windows_callback), &mut target as *mut _ as isize);
    }
    target.1
}

#[cfg(windows)]
fn position_dual_windows(pid_left: u32, pid_right: u32) {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SystemParametersInfoW, SPI_GETWORKAREA, SWP_NOZORDER, SWP_SHOWWINDOW,
    };

    let mut found_left = None;
    let mut found_right = None;

    for _ in 0..60 {
        thread::sleep(Duration::from_millis(100));

        if found_left.is_none() {
            found_left = find_window_for_pid(pid_left);
        }
        if found_right.is_none() {
            found_right = find_window_for_pid(pid_right);
        }

        if found_left.is_some() && found_right.is_some() {
            break;
        }
    }

    let mut rect: RECT = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            &mut rect as *mut _ as *mut _,
            0,
        )
    };
    if ok == 0 {
        return;
    }

    let total_width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let half_width = total_width / 2;

    if let Some(h_left) = found_left {
        unsafe {
            SetWindowPos(
                h_left,
                std::ptr::null_mut(),
                rect.left,
                rect.top,
                half_width,
                height,
                SWP_NOZORDER | SWP_SHOWWINDOW,
            );
        }
    }

    if let Some(h_right) = found_right {
        let right_x = rect.left + half_width;
        let right_width = total_width - half_width;
        unsafe {
            SetWindowPos(
                h_right,
                std::ptr::null_mut(),
                right_x,
                rect.top,
                right_width,
                height,
                SWP_NOZORDER | SWP_SHOWWINDOW,
            );
        }
    }
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

    #[cfg(windows)]
    #[test]
    fn test_win_api() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETWORKAREA,
        };
        use windows_sys::Win32::Foundation::RECT;
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        let res = unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                &mut rect as *mut _ as *mut _,
                0,
            )
        };
        assert_ne!(res, 0);
        let my_pid = std::process::id();
        let _ = find_window_for_pid(my_pid);
    }

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

    #[test]
    fn dual_window_paths_configured() {
        assert!(GMAIL_FILTER_RRG_XML.ends_with(r"tauri-email-filters\mailFiltersRRG.xml"));
        assert!(GMAIL_FILTER_FOG_XML.ends_with(r"tauri-email-filters\mailFiltersFog.xml"));
    }

    #[test]
    fn screen_split_math_covers_total_width() {
        let total_widths = [1920, 2560, 3840, 1280, 1366];
        for total in total_widths {
            let left_w = total / 2;
            let right_x = left_w;
            let right_w = total - left_w;
            assert_eq!(left_w + right_w, total);
            assert_eq!(right_x, left_w);
        }
    }

    #[test]
    fn rebuild_args_skip_bundling() {
        assert_eq!(
            npm_tauri_build_args(),
            ["run", "tauri", "build", "--", "--no-bundle", "--verbose", "--", "--verbose"]
        );
    }
}
