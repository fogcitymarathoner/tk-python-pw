use chrono::Local;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const APP_DIR: &str = r"C:\Users\marc\Documents\repos\firebase_pw\tauri-personal-assistant";
const WIKI_CONFIG: &str = r"C:\Users\marc\Documents\repos\mopo-ai\wiki\config.yml";

struct WikiDbConfig {
    db_type: String,
    host: String,
    port: u16,
    user: String,
    pass: String,
    name: String,
    ssl: bool,
}

pub fn create_backup() -> Result<String, String> {
    let app_dir = PathBuf::from(APP_DIR);
    let source = app_dir
        .parent()
        .ok_or_else(|| "Could not resolve parent directory".to_string())?;
    let dest_dir = backup_destination_dir()?;

    if !source.is_dir() {
        return Err(format!("Source folder not found: {}", source.display()));
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

pub fn backup_wiki_database() -> Result<String, String> {
    let config = read_wiki_db_config(Path::new(WIKI_CONFIG))?;
    if config.db_type != "postgres" {
        return Err(format!(
            "Wiki database type is '{}'; only postgres backups are supported",
            config.db_type
        ));
    }

    let pg_dump = find_pg_dump()?;
    let stamp = Local::now().format("%Y-%m-%d_%H%M%S");
    let dump_path = std::env::temp_dir().join(format!("wikijs-{stamp}.sql"));
    let zip_path = backup_destination_dir()?.join(format!("wikijs-{stamp}.zip"));

    dump_postgres(&pg_dump, &config, &dump_path)?;

    let entry_name = format!("{}.sql", sanitize_entry_name(&config.name));
    let zip_result = write_single_file_zip(&dump_path, &entry_name, &zip_path);
    let _ = std::fs::remove_file(&dump_path);
    zip_result.map_err(|e| format!("Failed to write {}: {e}", zip_path.display()))?;

    Ok(zip_path.display().to_string())
}

fn backup_destination_dir() -> Result<PathBuf, String> {
    let app_dir = PathBuf::from(APP_DIR);
    let source = app_dir
        .parent()
        .ok_or_else(|| "Could not resolve parent directory".to_string())?;
    let dest_dir = source
        .parent()
        .ok_or_else(|| "Could not resolve two tiers up from the app".to_string())?;
    if !dest_dir.is_dir() {
        return Err(format!("Destination folder not found: {}", dest_dir.display()));
    }
    Ok(dest_dir.to_path_buf())
}

fn read_wiki_db_config(path: &Path) -> Result<WikiDbConfig, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Could not read wiki config {}: {e}", path.display()))?;
    parse_wiki_db_config(&text)
}

fn parse_wiki_db_config(text: &str) -> Result<WikiDbConfig, String> {
    let mut in_db = false;
    let mut values: HashMap<String, String> = HashMap::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.chars().take_while(|c| *c == ' ' || *c == '\t').count();
        if indent == 0 {
            in_db = trimmed == "db:" || trimmed.starts_with("db:");
            continue;
        }
        if !in_db || indent != 2 {
            continue;
        }

        let Some((key, raw_value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = raw_value
            .split('#')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .trim_matches('\'');
        if value.is_empty() {
            continue;
        }
        values.insert(key.trim().to_string(), value.to_string());
    }

    let require = |key: &str| -> Result<String, String> {
        values
            .get(key)
            .cloned()
            .ok_or_else(|| format!("Wiki config is missing db.{key}"))
    };

    Ok(WikiDbConfig {
        db_type: require("type")?,
        host: require("host")?,
        port: require("port")?
            .parse()
            .map_err(|_| "Wiki config has an invalid db.port".to_string())?,
        user: require("user")?,
        pass: require("pass")?,
        name: require("db")?,
        ssl: values.get("ssl").is_some_and(|value| value == "true"),
    })
}

fn find_pg_dump() -> Result<PathBuf, String> {
    if let Some(path) = pg_dump_on_path() {
        return Ok(path);
    }

    let mut candidates = Vec::new();
    for root in [
        r"C:\Program Files\PostgreSQL",
        r"C:\Program Files (x86)\PostgreSQL",
    ] {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let candidate = entry.path().join("bin").join("pg_dump.exe");
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }

    candidates.sort_by(|left, right| version_parts(left).cmp(&version_parts(right)));
    candidates.pop().ok_or_else(|| {
        "pg_dump was not found. Install PostgreSQL client tools or add pg_dump to PATH.".to_string()
    })
}

fn pg_dump_on_path() -> Option<PathBuf> {
    let output = Command::new("where").arg("pg_dump").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

fn version_parts(path: &Path) -> Vec<u32> {
    path.parent()
        .and_then(|bin| bin.parent())
        .and_then(|version| version.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("0")
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn dump_postgres(pg_dump: &Path, config: &WikiDbConfig, dump_path: &Path) -> Result<(), String> {
    let port = config.port.to_string();
    let dump_arg = dump_path.display().to_string();
    let output = Command::new(pg_dump)
        .args([
            "--host",
            &config.host,
            "--port",
            &port,
            "--username",
            &config.user,
            "--dbname",
            &config.name,
            "--no-password",
            "--format=plain",
            "--file",
            &dump_arg,
        ])
        .env("PGPASSWORD", &config.pass)
        .env(
            "PGSSLMODE",
            if config.ssl { "require" } else { "disable" },
        )
        .output()
        .map_err(|e| format!("Could not run {}: {e}", pg_dump.display()))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(dump_path);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "pg_dump failed".to_string()
        } else {
            format!("pg_dump failed: {detail}")
        });
    }

    if !dump_path.is_file() {
        return Err("pg_dump finished without writing a dump file".to_string());
    }
    Ok(())
}

fn sanitize_entry_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "wiki".to_string()
    } else {
        cleaned
    }
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

fn write_single_file_zip(file_path: &Path, entry_name: &str, zip_path: &Path) -> io::Result<()> {
    let file = File::create(zip_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(entry_name, options)?;
    let mut input = File::open(file_path)?;
    io::copy(&mut input, &mut zip)?;
    zip.finish()?.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn parses_postgres_settings_from_wiki_config() {
        let text = r#"
port: 8899
db:
  type: postgres
  host: localhost
  port: 5433
  user: wikijs
  pass: "wiki pass"
  db: wikijs
  ssl: false
  schema: public
ssl:
  enabled: false
"#;
        let config = parse_wiki_db_config(text).unwrap();
        assert_eq!(config.db_type, "postgres");
        assert_eq!(config.host, "localhost");
        assert_eq!(config.port, 5433);
        assert_eq!(config.user, "wikijs");
        assert_eq!(config.pass, "wiki pass");
        assert_eq!(config.name, "wikijs");
        assert!(!config.ssl);
    }

    #[test]
    fn rejects_a_wiki_config_without_database_settings() {
        match parse_wiki_db_config("port: 8899\n") {
            Err(error) => assert!(error.contains("db.type"), "{error}"),
            Ok(_) => panic!("expected missing db.type"),
        }
    }

    #[test]
    fn zips_a_dump_with_deflate() {
        let dir = std::env::temp_dir().join(format!("wiki-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dump = dir.join("wikijs.sql");
        std::fs::write(&dump, b"CREATE TABLE pages(id int);").unwrap();
        let zip_path = dir.join("wikijs.zip");

        write_single_file_zip(&dump, "wikijs.sql", &zip_path).unwrap();

        let file = File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 1);
        let mut entry = archive.by_index(0).unwrap();
        assert_eq!(entry.name(), "wikijs.sql");
        assert_eq!(entry.compression(), zip::CompressionMethod::Deflated);
        let mut contents = String::new();
        entry.read_to_string(&mut contents).unwrap();
        assert_eq!(contents, "CREATE TABLE pages(id int);");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
