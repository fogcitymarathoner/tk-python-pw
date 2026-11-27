use crate::compute_filter_hash;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, PartialEq, Eq)]
pub enum CliAction {
    RunGui { initial_file: Option<String> },
    ExitWithCode(i32),
}

#[cfg(windows)]
pub fn attach_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
pub fn attach_console() {}

pub fn print_help() {
    println!(
        r#"Gmail Filter Editor 0.1.0
A desktop editor, validator, and tester for Gmail filter XML files.

USAGE:
    gmail-filter-editor [OPTIONS] [FILTER_FILE]

ARGS:
    <FILTER_FILE>    Optional path to a Gmail filter XML file (.xml) to open on launch

OPTIONS:
    -f, --file <PATH>       Path to a Gmail filter XML file to open on launch
    -v, --validate [PATH]   Validate the specified filter XML file (or default mailFilters.xml) and exit
    -h, --help              Print this help information
    -V, --version           Print version information

EXAMPLES:
    # Open default mailFilters.xml in the GUI
    gmail-filter-editor

    # Launch GUI with a specific XML filter file (allows multiple instances)
    gmail-filter-editor client_filters.xml
    gmail-filter-editor --file C:\data\mailFiltersFog.xml

    # Validate an XML filter file from the terminal without opening GUI
    gmail-filter-editor --validate
    gmail-filter-editor --validate mailFiltersRRG.xml
"#
    );
}

pub fn parse_cli_args<I: IntoIterator<Item = String>>(args: I) -> CliAction {
    let args_vec: Vec<String> = args.into_iter().collect();
    let mut initial_file: Option<String> = None;
    let mut i = 1;

    while i < args_vec.len() {
        let arg = &args_vec[i];
        match arg.as_str() {
            "-h" | "--help" => {
                attach_console();
                print_help();
                return CliAction::ExitWithCode(0);
            }
            "-V" | "--version" => {
                attach_console();
                println!("gmail-filter-editor 0.1.0");
                return CliAction::ExitWithCode(0);
            }
            "-v" | "--validate" => {
                attach_console();
                let file_to_validate = if i + 1 < args_vec.len() && !args_vec[i + 1].starts_with('-') {
                    i += 1;
                    args_vec[i].clone()
                } else {
                    "mailFilters.xml".to_string()
                };

                let success = validate_filter_file(&file_to_validate);
                return CliAction::ExitWithCode(if success { 0 } else { 1 });
            }
            "-f" | "--file" => {
                if i + 1 < args_vec.len() {
                    i += 1;
                    initial_file = Some(args_vec[i].clone());
                } else {
                    attach_console();
                    eprintln!("Error: Flag '--file' requires a file path argument.");
                    return CliAction::ExitWithCode(1);
                }
            }
            _ => {
                if !arg.starts_with('-') && initial_file.is_none() {
                    initial_file = Some(arg.clone());
                } else {
                    attach_console();
                    eprintln!("Unknown argument: '{}'. Use --help for usage details.", arg);
                    return CliAction::ExitWithCode(1);
                }
            }
        }
        i += 1;
    }

    CliAction::RunGui { initial_file }
}

#[derive(Debug, Default)]
pub struct ParsedFilterItem {
    pub properties: BTreeMap<String, String>,
}

pub fn parse_filters_xml(content: &str) -> Result<Vec<ParsedFilterItem>, String> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut entries = Vec::new();
    let mut in_entry = false;
    let mut current_properties = BTreeMap::new();

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.local_name();
                if name.as_ref() == b"entry" {
                    in_entry = true;
                    current_properties.clear();
                } else if in_entry && (name.as_ref() == b"property" || name.as_ref().ends_with(b":property")) {
                    extract_property_attrs(&e, &mut current_properties)?;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = e.local_name();
                if in_entry && (name.as_ref() == b"property" || name.as_ref().ends_with(b":property")) {
                    extract_property_attrs(&e, &mut current_properties)?;
                }
            }
            Ok(Event::End(e)) => {
                let name = e.local_name();
                if name.as_ref() == b"entry" {
                    in_entry = false;
                    entries.push(ParsedFilterItem {
                        properties: current_properties.clone(),
                    });
                    current_properties.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML syntax error at position {}: {:?}", reader.buffer_position(), e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(entries)
}

fn extract_property_attrs(e: &quick_xml::events::BytesStart, props: &mut BTreeMap<String, String>) -> Result<(), String> {
    let mut name = None;
    let mut value = None;

    for attr in e.attributes() {
        let attr = attr.map_err(|err| format!("Attribute parse error: {}", err))?;
        if attr.key.as_ref() == b"name" {
            name = Some(String::from_utf8_lossy(&attr.value).into_owned());
        } else if attr.key.as_ref() == b"value" {
            value = Some(String::from_utf8_lossy(&attr.value).into_owned());
        }
    }

    if let (Some(n), Some(v)) = (name, value) {
        props.insert(n, v);
    }

    Ok(())
}

pub fn validate_filter_file(path_str: &str) -> bool {
    let path = Path::new(path_str);
    println!("Validating Gmail filter file: {:?}", path);

    if !path.exists() {
        eprintln!("✗ File not found: {:?}", path);
        return false;
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("✗ Failed to read file: {}", e);
            return false;
        }
    };

    let entries = match parse_filters_xml(&content) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("✗ XML validation error: {}", e);
            return false;
        }
    };

    let total_count = entries.len();
    if total_count == 0 {
        println!("ℹ File contains 0 filter entries.");
        return true;
    }

    // Check for duplicates using compute_filter_hash
    let mut hash_map: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut empty_filters: Vec<usize> = Vec::new();

    for (idx, entry) in entries.iter().enumerate() {
        let hash = compute_filter_hash(&entry.properties);
        hash_map.entry(hash).or_default().push(idx + 1);

        // Check if filter has no matching criteria
        let has_criteria = entry.properties.contains_key("from")
            || entry.properties.contains_key("to")
            || entry.properties.contains_key("subject")
            || entry.properties.contains_key("hasTheWord")
            || entry.properties.contains_key("doesNotHaveTheWord");

        if !has_criteria {
            empty_filters.push(idx + 1);
        }
    }

    let mut duplicates: Vec<(String, Vec<usize>)> = Vec::new();
    for (hash, indexes) in hash_map {
        if indexes.len() > 1 {
            duplicates.push((hash, indexes));
        }
    }

    println!("------------------------------------------------------------");
    println!("Validation Summary for: {}", path.display());
    println!("Total Filters Found: {}", total_count);
    let duplicate_extras: usize = duplicates.iter().map(|(_, idxs)| idxs.len() - 1).sum();
    println!("Distinct Filters:    {}", total_count - duplicate_extras);

    if !empty_filters.is_empty() {
        println!("Empty/Unconfigured Filters ({}): #{:?}", empty_filters.len(), empty_filters);
    }

    if !duplicates.is_empty() {
        eprintln!("✗ DUPLICATES DETECTED: Found {} set(s) of identical filters:", duplicates.len());
        for (hash, idxs) in &duplicates {
            let filter_num_str = idxs.iter().map(|n| format!("#{}", n)).collect::<Vec<_>>().join(", ");
            let hash_preview = if hash.len() >= 8 { &hash[..8] } else { hash.as_str() };
            eprintln!("  • Filters {} (hash: {}...)", filter_num_str, hash_preview);
        }
        println!("------------------------------------------------------------");
        eprintln!("Result: FAILED (Duplicate filters detected. All filters must be distinct.)");
        return false;
    }

    println!("------------------------------------------------------------");
    println!("Result: PASSED (All {} filters are valid and distinct)", total_count);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cli_args_help() {
        let args = vec!["app".to_string(), "--help".to_string()];
        assert_eq!(parse_cli_args(args), CliAction::ExitWithCode(0));

        let args_short = vec!["app".to_string(), "-h".to_string()];
        assert_eq!(parse_cli_args(args_short), CliAction::ExitWithCode(0));
    }

    #[test]
    fn test_parse_cli_args_file() {
        let args = vec!["app".to_string(), "my_filters.xml".to_string()];
        assert_eq!(
            parse_cli_args(args),
            CliAction::RunGui {
                initial_file: Some("my_filters.xml".to_string()),
            }
        );

        let args_flag = vec!["app".to_string(), "-f".to_string(), "custom.xml".to_string()];
        assert_eq!(
            parse_cli_args(args_flag),
            CliAction::RunGui {
                initial_file: Some("custom.xml".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_filters_xml() {
        let xml = r#"<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
            <entry>
                <apps:property name='from' value='alice@example.com'/>
                <apps:property name='label' value='Work'/>
            </entry>
        </feed>"#;
        let items = parse_filters_xml(xml).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].properties.get("from").unwrap(), "alice@example.com");
        assert_eq!(items[0].properties.get("label").unwrap(), "Work");
    }
}
