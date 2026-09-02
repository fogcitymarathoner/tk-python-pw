use chrono::Local;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const APP_DIR: &str = r"C:\Users\marc\Documents\repos\firebase_pw\tauri-personal-assistant";

pub fn create_backup() -> Result<String, String> {
    let app_dir = PathBuf::from(APP_DIR);
    let source = app_dir
        .parent()
        .ok_or_else(|| "Could not resolve parent directory".to_string())?;
    let dest_dir = source
        .parent()
        .ok_or_else(|| "Could not resolve two tiers up from the app".to_string())?;

    if !source.is_dir() {
        return Err(format!("Source folder not found: {}", source.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!("Destination folder not found: {}", dest_dir.display()));
    }

    let folder_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("backup");
    let stamp = Local::now().format("%Y-%m-%d_%H%M%S");
    let zip_path = dest_dir.join(format!("{folder_name}-{stamp}.zip"));

    let files = list_non_ignored_files(source)?;
    if files.is_empty() {
        return Err("No files to back up (git ls-files returned nothing)".to_string());
    }

    write_zip(source, folder_name, &files, &zip_path)
        .map_err(|e| format!("Failed to write {}: {e}", zip_path.display()))?;

    Ok(zip_path.display().to_string())
}

fn list_non_ignored_files(repo: &Path) -> Result<Vec<PathBuf>, String> {
    let output = Command::new("git")
        .args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .current_dir(repo)
        .output()
        .map_err(|e| format!("Could not run git ls-files: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git ls-files failed: {stderr}"));
    }

    Ok(output
        .stdout
        .split(|b| *b == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| repo.join(String::from_utf8_lossy(chunk).as_ref()))
        .filter(|path| path.is_file())
        .collect())
}

fn write_zip(
    source: &Path,
    root_name: &str,
    files: &[PathBuf],
    zip_path: &Path,
) -> io::Result<()> {
    let file = File::create(zip_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for path in files {
        let relative = match path.strip_prefix(source) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        let name = format!("{}/{}", root_name, relative.to_string_lossy().replace('\\', "/"));
        zip.start_file(name, options)?;
        let mut input = File::open(path)?;
        io::copy(&mut input, &mut zip)?;
    }

    zip.finish()?.flush()?;
    Ok(())
}
