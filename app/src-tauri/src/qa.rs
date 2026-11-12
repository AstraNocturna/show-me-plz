//! Side questions: a separate `pi --fork <session> --mode rpc` process that inherits the main session's
//! context, with read-only tools and no extensions. It never touches the main session or pi itself. The
//! fork lives in a throwaway directory that is removed when the thread ends or the viewer exits.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

const TOOLS: &str = "read,grep,find,ls";
/// Fork directories left behind by a crash are swept on the next start once this old.
const STALE_AFTER: Duration = Duration::from_secs(24 * 3600);
const STDERR_TAIL: usize = 4000;

struct Thread {
    id: u64,
    child: Child,
    stdin: ChildStdin,
    dir: PathBuf,
}

/// How to run the same pi as the host (sent by the extension), and the one live thread.
#[derive(Default)]
pub struct Qa {
    launch: Option<(String, String)>,
    current: Option<Thread>,
}

pub type SharedQa = Arc<Mutex<Qa>>;

#[derive(Clone, Serialize)]
struct QaEvent {
    id: u64,
    record: Value,
}

#[derive(Clone, Serialize)]
struct QaExit {
    id: u64,
    stderr: String,
}

fn root() -> PathBuf {
    std::env::temp_dir().join("show-me-plz-qa")
}

impl Qa {
    pub fn set_launch(&mut self, node: String, cli: String) {
        self.launch = Some((node, cli));
    }

    /// Ends the live thread and discards its fork.
    pub fn stop(&mut self) {
        if let Some(mut t) = self.current.take() {
            let _ = t.child.kill();
            let _ = t.child.wait();
            let _ = std::fs::remove_dir_all(&t.dir);
        }
    }

    /// Removes fork directories that an earlier, crashed viewer could not clean up.
    pub fn sweep_stale() {
        let Ok(entries) = std::fs::read_dir(root()) else { return };
        for e in entries.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
            if old.is_some_and(|age| age > STALE_AFTER) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

/// Starts a new thread (ending any previous one). `id` comes from the frontend so it can match events
/// that arrive before this call returns.
#[tauri::command]
pub fn qa_start(app: AppHandle, qa: State<'_, SharedQa>, id: u64, session: String, cwd: Option<String>) -> Result<(), String> {
    let mut q = qa.lock().unwrap();
    q.stop();
    let (node, cli) = q.launch.clone().ok_or("还不知道 pi 的位置：请在 pi 里执行 /viewer 后再试")?;
    let dir = root().join(format!("{}-{}", std::process::id(), id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;

    let mut cmd = Command::new(&node);
    cmd.arg(&cli)
        .arg("--fork")
        .arg(&session)
        .arg("--session-dir")
        .arg(&dir)
        .args(["--mode", "rpc", "--tools", TOOLS, "--no-extensions"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(c) = cwd.filter(|c| Path::new(c).is_dir()) {
        cmd.current_dir(c);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console pops up for node
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("启动 pi 失败：{e}"));
        }
    };
    let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
        unreachable!("all three streams are piped")
    };

    let tail = Arc::new(Mutex::new(String::new()));
    let tail_w = tail.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut t = tail_w.lock().unwrap();
            t.push_str(&line);
            t.push('\n');
            if t.len() > STDERR_TAIL {
                let cut = t.len() - STDERR_TAIL;
                let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(t.len());
                t.drain(..cut);
            }
        }
    });
    std::thread::spawn(move || {
        // RPC records are LF-delimited JSON; lines() splits on LF only (and drops a trailing CR).
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(record) = serde_json::from_str::<Value>(&line) {
                let _ = app.emit("qa-event", QaEvent { id, record });
            }
        }
        // Let stderr drain before reporting why the process ended.
        std::thread::sleep(Duration::from_millis(100));
        let stderr = tail.lock().unwrap().clone();
        let _ = app.emit("qa-exit", QaExit { id, stderr });
    });

    q.current = Some(Thread { id, child, stdin, dir });
    Ok(())
}

/// Writes one RPC command (e.g. `prompt`, `abort`, `get_state`) to the thread.
#[tauri::command]
pub fn qa_send(qa: State<'_, SharedQa>, id: u64, command: Value) -> Result<(), String> {
    let mut q = qa.lock().unwrap();
    let t = q.current.as_mut().filter(|t| t.id == id).ok_or("问答已结束，请开始新的问答")?;
    let line = serde_json::to_string(&command).map_err(|e| e.to_string())? + "\n";
    t.stdin
        .write_all(line.as_bytes())
        .and_then(|_| t.stdin.flush())
        .map_err(|e| format!("发送失败：{e}"))
}

#[tauri::command]
pub fn qa_stop(qa: State<'_, SharedQa>, id: u64) {
    let mut q = qa.lock().unwrap();
    if q.current.as_ref().is_some_and(|t| t.id == id) {
        q.stop();
    }
}
