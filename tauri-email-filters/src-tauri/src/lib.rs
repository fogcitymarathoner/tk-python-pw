use std::fs;
use std::path::PathBuf;

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
    let mut dialog = rfd::FileDialog::new()
        .add_filter("XML Files", &["xml"]);
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    let file = dialog.save_file();
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_filters_file, 
            write_filters_file,
            write_report_file,
            select_filters_file,
            read_filters_from_path,
            write_filters_to_path,
            select_save_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
