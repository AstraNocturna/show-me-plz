//! Bookmark storage, one JSON file per session in the app's own data dir. Never touches pi's files.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn marks_path(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let safe: String = session_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe.is_empty() {
        return Err("empty session id".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("marks");
    Ok(dir.join(format!("{safe}.json")))
}

#[tauri::command]
pub fn load_marks(app: AppHandle, session_id: String) -> Result<Option<String>, String> {
    let path = marks_path(&app, &session_id)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_marks(app: AppHandle, session_id: String, json: String) -> Result<(), String> {
    let path = marks_path(&app, &session_id)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write-then-rename so a crash never leaves a truncated file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
