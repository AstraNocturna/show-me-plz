//! Read-only git facts for the status bar (branch and number of changed files).

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Clone, Default, Serialize)]
pub struct GitInfo {
    /// None when `cwd` is not inside a git work tree.
    branch: Option<String>,
    changed: usize,
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    // --no-optional-locks: `status` must not write .git/index while the agent is working in the repo.
    cmd.args(["--no-optional-locks", "-C", cwd]).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok().filter(|o| o.status.success())?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn read(cwd: &str) -> GitInfo {
    if !Path::new(cwd).is_dir() {
        return GitInfo::default();
    }
    let Some(name) = git(cwd, &["branch", "--show-current"]) else { return GitInfo::default() };
    let name = name.trim();
    // Detached HEAD has no branch name; show the short commit instead.
    let branch = if name.is_empty() { git(cwd, &["rev-parse", "--short", "HEAD"]).map(|s| s.trim().to_string()) } else { Some(name.to_string()) };
    let changed = git(cwd, &["status", "--porcelain"]).map_or(0, |s| s.lines().count());
    GitInfo { branch, changed }
}

#[tauri::command]
pub async fn git_info(cwd: String) -> GitInfo {
    tauri::async_runtime::spawn_blocking(move || read(&cwd)).await.unwrap_or_default()
}
