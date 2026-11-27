// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_app_lib::cli::{parse_cli_args, CliAction};

fn main() {
    let args = std::env::args();
    match parse_cli_args(args) {
        CliAction::ExitWithCode(code) => {
            std::process::exit(code);
        }
        CliAction::RunGui { initial_file } => {
            tauri_app_lib::run(initial_file);
        }
    }
}
