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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_filters_file, 
            write_filters_file,
            write_report_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
