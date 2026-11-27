use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub mod cli;

pub struct AppState {
    pub initial_file: std::sync::Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct FilterEntry {
    pub id: String,
    pub title: String,
    pub updated: String,
    #[serde(rename = "categoryTerm")]
    pub category_term: String,
    pub properties: BTreeMap<String, String>,
}

// Compute deterministic SHA-256 hash across sorted, non-empty filter criteria and actions
pub fn compute_filter_hash(properties: &BTreeMap<String, String>) -> String {
    let mut parts = Vec::new();
    for (k, v) in properties {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            parts.push(format!("{}={}", k, trimmed));
        }
    }
    let canonical = parts.join(";");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

// Helper to determine the SQLite file path from the XML file path.
pub fn get_db_path(xml_path: Option<&str>) -> Result<PathBuf, String> {
    match xml_path {
        Some(p) if !p.trim().is_empty() => {
            let mut path_buf = PathBuf::from(p);
            path_buf.set_extension("db");
            Ok(path_buf)
        }
        _ => get_project_path("mailFilters.db"),
    }
}

// Helper to initialize the SQLite database table and indexed hash field.
pub fn init_db_connection(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory for SQLite DB: {}", e))?;
        }
    }

    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open SQLite database at {:?}: {}", db_path, e))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS filters (
            entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL,
            title TEXT NOT NULL,
            updated TEXT NOT NULL,
            category_term TEXT NOT NULL,
            properties_json TEXT NOT NULL,
            hash TEXT NOT NULL,
            display_order INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_filters_hash ON filters(hash);",
    )
    .map_err(|e| format!("Failed to initialize filters table and index: {}", e))?;

    Ok(conn)
}

// Helper to find the correct path in the project root.
fn get_project_path(filename: &str) -> Result<PathBuf, String> {
    let mut path = std::env::current_dir().map_err(|e| e.to_string())?;

    // Check if we are running in the src-tauri subdirectory (dev mode)
    if path.ends_with("src-tauri") {
        if let Some(parent) = path.parent() {
            path = parent.to_path_buf();
        }
    }

    path.push(filename);
    Ok(path)
}

// Populates the SQLite database with parsed filter entries, computing an indexed hash for each.
#[tauri::command]
fn populate_sqlite(path: Option<String>, entries: Vec<FilterEntry>) -> Result<String, String> {
    let db_path = get_db_path(path.as_deref())?;
    let mut conn = init_db_connection(&db_path)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    tx.execute("DELETE FROM filters", [])
        .map_err(|e| format!("Failed to clear filters table: {}", e))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO filters (id, title, updated, category_term, properties_json, hash, display_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("Failed to prepare insert statement: {}", e))?;

        for (idx, entry) in entries.iter().enumerate() {
            let hash = compute_filter_hash(&entry.properties);
            let properties_json = serde_json::to_string(&entry.properties)
                .map_err(|e| format!("Failed to serialize properties for filter #{}: {}", idx + 1, e))?;

            stmt.execute(params![
                entry.id,
                entry.title,
                entry.updated,
                entry.category_term,
                properties_json,
                hash,
                idx as i64
            ])
            .map_err(|e| format!("Failed to insert filter #{}: {}", idx + 1, e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit filters transaction: {}", e))?;

    Ok(db_path.to_string_lossy().into_owned())
}

// Exports distinct filter entries from the SQLite database excluding the hash field.
// Uses the indexed hash field to detect duplicate filters and block export if duplicates exist.
#[tauri::command]
fn export_sqlite(path: Option<String>) -> Result<Vec<FilterEntry>, String> {
    let db_path = get_db_path(path.as_deref())?;
    if !db_path.exists() {
        return Err(format!("SQLite database not found at {:?}", db_path));
    }
    let conn = init_db_connection(&db_path)?;

    // Check for duplicate filters using the indexed hash field
    let mut check_stmt = conn
        .prepare(
            "SELECT hash, COUNT(*) as cnt, GROUP_CONCAT(display_order + 1) as filter_nums, MIN(properties_json) as sample_props
             FROM filters
             GROUP BY hash
             HAVING cnt > 1
             ORDER BY MIN(display_order) ASC",
        )
        .map_err(|e| format!("Failed to query duplicate hashes: {}", e))?;

    let duplicate_rows = check_stmt
        .query_map([], |row| {
            let hash: String = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            let nums: String = row.get(2)?;
            let sample_props: String = row.get(3)?;
            Ok((hash, cnt as usize, nums, sample_props))
        })
        .map_err(|e| format!("Failed to evaluate duplicates: {}", e))?;

    let mut duplicates = Vec::new();
    for dup in duplicate_rows {
        let (_hash, cnt, nums, sample_props) =
            dup.map_err(|e| format!("Error reading duplicate row: {}", e))?;
        duplicates.push(format!(
            "Filter(s) #{} ({} identical instances: {})",
            nums, cnt, sample_props
        ));
    }

    if !duplicates.is_empty() {
        return Err(format!(
            "Duplicate filters detected! All filters must be distinct to save.\n{}",
            duplicates.join("\n")
        ));
    }

    // Export records from the database EXCLUDING the hash field
    let mut select_stmt = conn
        .prepare(
            "SELECT id, title, updated, category_term, properties_json
             FROM filters
             ORDER BY display_order ASC",
        )
        .map_err(|e| format!("Failed to query filters for export: {}", e))?;

    let entries_iter = select_stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let updated: String = row.get(2)?;
            let category_term: String = row.get(3)?;
            let props_str: String = row.get(4)?;
            Ok((id, title, updated, category_term, props_str))
        })
        .map_err(|e| format!("Failed to fetch filter rows: {}", e))?;

    let mut exported_entries = Vec::new();
    for entry_res in entries_iter {
        let (id, title, updated, category_term, props_str) =
            entry_res.map_err(|e| format!("Error reading row: {}", e))?;
        let properties: BTreeMap<String, String> = serde_json::from_str(&props_str)
            .map_err(|e| format!("Failed to deserialize properties for entry {}: {}", id, e))?;
        exported_entries.push(FilterEntry {
            id,
            title,
            updated,
            category_term,
            properties,
        });
    }

    Ok(exported_entries)
}

// Command to read mailFilters.xml safely from the project root.
#[tauri::command]
fn read_filters_file() -> Result<String, String> {
    let path = get_project_path("mailFilters.xml")?;

    if !path.exists() {
        return Err(format!("mailFilters.xml not found at {:?}", path));
    }

    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

// Command to write content to mailFilters.xml safely with an automatic backup (.bak).
#[tauri::command]
fn write_filters_file(content: String) -> Result<(), String> {
    let path = get_project_path("mailFilters.xml")?;

    // Create a backup of the current file in the same directory if it exists, before overwriting it
    if path.exists() {
        let mut backup_path = path.clone();
        backup_path.set_extension("xml.bak");
        if let Err(e) = fs::copy(&path, &backup_path) {
            return Err(format!("Failed to create backup: {}", e));
        }
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

// Command to save the human-readable text report natively to filter_report.txt.
#[tauri::command]
fn write_report_file(content: String) -> Result<(), String> {
    let path = get_project_path("filter_report.txt")?;
    fs::write(&path, content).map_err(|e| format!("Failed to write report: {}", e))
}

// Command to open a file dialog and select an XML file.
#[tauri::command]
fn select_filters_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("XML Files", &["xml"])
        .pick_file();

    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

// Command to read an XML file from an arbitrary path.
#[tauri::command]
fn read_filters_from_path(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(format!("File not found at {:?}", path_buf));
    }
    fs::read_to_string(&path_buf).map_err(|e| format!("Failed to read file: {}", e))
}

// Command to write XML content to an arbitrary path with an automatic backup (.bak).
#[tauri::command]
fn write_filters_to_path(path: String, content: String) -> Result<(), String> {
    let path_buf = PathBuf::from(path);

    // Create a backup of the current file in the same directory if it exists, before overwriting it
    if path_buf.exists() {
        let mut backup_path = path_buf.clone();
        let ext = path_buf.extension().and_then(|e| e.to_str()).unwrap_or("xml");
        backup_path.set_extension(format!("{}.bak", ext));
        if let Err(e) = fs::copy(&path_buf, &backup_path) {
            return Err(format!("Failed to create backup: {}", e));
        }
    }

    fs::write(&path_buf, content).map_err(|e| format!("Failed to write file: {}", e))
}

// Command to open a save dialog to select where to save an XML file.
#[tauri::command]
fn select_save_path(default_name: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().add_filter("XML Files", &["xml"]);
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    let file = dialog.save_file();
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

// Command to open a file dialog and select an EML file.
#[tauri::command]
fn select_eml_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Email Files", &["eml", "msg", "txt"])
        .pick_file();

    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

// Command to read an EML file from an arbitrary path.
#[tauri::command]
fn read_eml_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(format!("File not found at {:?}", path_buf));
    }
    fs::read_to_string(&path_buf).map_err(|e| format!("Failed to read EML file: {}", e))
}

// Extracts suffix XXX from mailFiltersXXX.xml to format "Filter XXX" for the title bar
pub fn format_filter_title(file_path_or_name: &str) -> String {
    let path = Path::new(file_path_or_name);
    let file_name = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(file_path_or_name);

    let lower = file_name.to_lowercase();
    if lower.starts_with("mailfilters") {
        let without_prefix = &file_name["mailfilters".len()..];
        let without_ext = if without_prefix.to_lowercase().ends_with(".xml") {
            &without_prefix[..without_prefix.len() - 4]
        } else {
            without_prefix
        };
        let trimmed = without_ext.trim();
        if !trimmed.is_empty() {
            return format!("Filter {}", trimmed);
        }
        return "Filter".to_string();
    }

    let without_ext = if lower.ends_with(".xml") {
        &file_name[..file_name.len() - 4]
    } else {
        file_name
    };
    let trimmed = without_ext.trim();
    if !trimmed.is_empty() {
        format!("Filter {}", trimmed)
    } else {
        "Filter".to_string()
    }
}

// Command to retrieve optional initial filter file passed via CLI arguments
#[tauri::command]
fn get_initial_file_path(state: tauri::State<AppState>) -> Result<Option<String>, String> {
    let guard = state.initial_file.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

// Command to set the native window title bar dynamically from the frontend
#[tauri::command]
fn set_window_title(window: tauri::Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(initial_file: Option<String>) {
    let initial_clone = initial_file.clone();
    let app_state = AppState {
        initial_file: std::sync::Mutex::new(initial_file),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(ref path) = initial_clone {
                if let Some(window) = app.get_webview_window("main") {
                    let title = format_filter_title(path);
                    let _ = window.set_title(&title);
                }
            }
            Ok(())
        })
        .on_tray_icon_event(|app, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_filters_file,
            write_filters_file,
            write_report_file,
            select_filters_file,
            read_filters_from_path,
            write_filters_to_path,
            select_save_path,
            populate_sqlite,
            export_sqlite,
            select_eml_file,
            read_eml_file,
            get_initial_file_path,
            set_window_title
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{compute_filter_hash, export_sqlite, format_filter_title, populate_sqlite, FilterEntry};
    use rusqlite::Connection;
    use std::collections::BTreeMap;
    use std::fs;

    #[test]
    fn test_format_filter_title() {
        assert_eq!(format_filter_title("mailFiltersFog.xml"), "Filter Fog");
        assert_eq!(format_filter_title("mailFiltersRRG.xml"), "Filter RRG");
        assert_eq!(format_filter_title("mailFiltersRrg.xml"), "Filter Rrg");
        assert_eq!(format_filter_title("C:\\data\\mailFiltersWork.xml"), "Filter Work");
        assert_eq!(format_filter_title("mailFilters.xml"), "Filter");
        assert_eq!(format_filter_title("custom.xml"), "Filter custom");
    }

    #[test]
    fn test_compute_filter_hash_canonical() {
        let mut props1 = BTreeMap::new();
        props1.insert("to".to_string(), "user@example.com".to_string());
        props1.insert("from".to_string(), "sender@example.com".to_string());
        props1.insert("empty_field".to_string(), "".to_string());

        let mut props2 = BTreeMap::new();
        props2.insert("from".to_string(), " sender@example.com ".to_string());
        props2.insert("to".to_string(), "user@example.com".to_string());

        let hash1 = compute_filter_hash(&props1);
        let hash2 = compute_filter_hash(&props2);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);
    }

    #[test]
    fn test_sqlite_populate_and_export_success() {
        let temp_dir = std::env::temp_dir().join(format!("test_sqlite_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("filters.db");
        let xml_path = temp_dir.join("filters.xml").to_string_lossy().into_owned();

        let mut entry1 = FilterEntry {
            id: "1".to_string(),
            title: "Mail Filter".to_string(),
            updated: "2026-01-01T00:00:00Z".to_string(),
            category_term: "filter".to_string(),
            properties: BTreeMap::new(),
        };
        entry1.properties.insert("from".to_string(), "a@example.com".to_string());

        let mut entry2 = FilterEntry {
            id: "2".to_string(),
            title: "Mail Filter".to_string(),
            updated: "2026-01-01T00:00:00Z".to_string(),
            category_term: "filter".to_string(),
            properties: BTreeMap::new(),
        };
        entry2.properties.insert("from".to_string(), "b@example.com".to_string());

        let res = populate_sqlite(Some(xml_path.clone()), vec![entry1.clone(), entry2.clone()]);
        assert!(res.is_ok());
        assert!(db_path.exists());

        // Verify index exists
        let conn = Connection::open(&db_path).unwrap();
        let mut index_stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_filters_hash'").unwrap();
        let mut index_rows = index_stmt.query([]).unwrap();
        assert!(index_rows.next().unwrap().is_some());

        // Verify export excluding hash
        let exported = export_sqlite(Some(xml_path)).unwrap();
        assert_eq!(exported.len(), 2);
        assert_eq!(exported[0].id, "1");
        assert_eq!(exported[1].id, "2");
        assert_eq!(exported[0].properties, entry1.properties);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_sqlite_duplicate_detection_blocks_export() {
        let temp_dir = std::env::temp_dir().join(format!("test_sqlite_dup_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();
        let xml_path = temp_dir.join("filters.xml").to_string_lossy().into_owned();

        let mut entry1 = FilterEntry {
            id: "1".to_string(),
            title: "Mail Filter".to_string(),
            updated: "2026-01-01T00:00:00Z".to_string(),
            category_term: "filter".to_string(),
            properties: BTreeMap::new(),
        };
        entry1.properties.insert("from".to_string(), "dupe@example.com".to_string());
        entry1.properties.insert("label".to_string(), "Trash".to_string());

        let mut entry2 = FilterEntry {
            id: "2".to_string(),
            title: "Mail Filter".to_string(),
            updated: "2026-01-01T00:00:00Z".to_string(),
            category_term: "filter".to_string(),
            properties: BTreeMap::new(),
        };
        entry2.properties.insert("from".to_string(), "dupe@example.com".to_string());
        entry2.properties.insert("label".to_string(), "Trash".to_string());

        let res = populate_sqlite(Some(xml_path.clone()), vec![entry1, entry2]);
        assert!(res.is_ok());

        let export_res = export_sqlite(Some(xml_path));
        assert!(export_res.is_err());
        let err_msg = export_res.err().unwrap();
        assert!(err_msg.contains("Duplicate filters detected"));
        assert!(err_msg.contains("Filter(s) #1,2"));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
