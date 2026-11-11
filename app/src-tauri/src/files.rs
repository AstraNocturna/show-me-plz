//! Read-only file access for the in-app preview. Nothing here writes.

use std::io::Read;
use std::path::Path;

use serde::Serialize;

/// Files larger than this are shown truncated.
const MAX_BYTES: u64 = 4 * 1024 * 1024;
/// A NUL byte in the first chunk marks the file as binary.
const SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    size: u64,
    is_dir: bool,
    binary: bool,
    truncated: bool,
    /// UTF-8 text (invalid sequences replaced); None for directories and binary files.
    text: Option<String>,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Ok(FileContent { size: 0, is_dir: true, binary: false, truncated: false, text: None });
    }
    let size = meta.len();
    let mut buf = Vec::with_capacity(size.min(MAX_BYTES) as usize);
    std::fs::File::open(&path)
        .and_then(|f| f.take(MAX_BYTES).read_to_end(&mut buf))
        .map_err(|e| e.to_string())?;
    let binary = buf[..buf.len().min(SNIFF_BYTES)].contains(&0);
    let text = (!binary).then(|| String::from_utf8_lossy(&buf).into_owned());
    Ok(FileContent { size, is_dir: false, binary, truncated: size > MAX_BYTES, text })
}

/// Which of the given absolute paths exist; used to only turn real files into links.
#[tauri::command]
pub fn check_paths(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_absolute() && Path::new(p).exists()).collect()
}
