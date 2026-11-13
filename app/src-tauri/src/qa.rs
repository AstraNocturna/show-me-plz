//! Side questions: a separate `pi --fork <session> --mode rpc` process that inherits the main session's
//! context. It loads the same extensions and declares the same tools as the main session, so its request
//! prefix matches and the main session's prompt cache is reused. Modification is held back by the
//! `qa-guard` extension (see extension/qa-guard.ts), which checks the `allow-write` file in the fork
//! directory on every tool call. It never touches the main session itself. The fork lives in a throwaway
//! directory that is removed when the thread ends or the viewer exits.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

/// Extensions (MCP servers, ...) can take a while to start; a cold start has been seen to take ~50 s.
const READY_TIMEOUT: Duration = Duration::from_secs(150);
const READY_ID: &str = "smp-ready";
/// Files in the fork directory shared with extension/qa-guard.ts.
const ALLOW_WRITE: &str = "allow-write";
const GUARD_OK: &str = "guard-ok";
/// Fork directories left behind by a crash are swept on the next start once this old.
const STALE_AFTER: Duration = Duration::from_secs(24 * 3600);
const STDERR_TAIL: usize = 4000;

struct Thread {
    id: u64,
    child: Child,
    stdin: ChildStdin,
    dir: PathBuf,
}

/// How to run the same pi as the host (sent by the extension).
#[derive(Clone)]
struct Launch {
    node: String,
    cli: String,
    /// Flags that shape the tool list and system prompt (extensions, skills, ...), copied from the host.
    args: Vec<String>,
    guard: Option<String>,
}

/// The launch recipe and the one live thread.
#[derive(Default)]
pub struct Qa {
    launch: Option<Launch>,
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
    pub fn set_launch(&mut self, node: String, cli: String, args: Vec<String>, guard: Option<String>) {
        self.launch = Some(Launch { node, cli, args, guard });
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

/// Spawns the fork and returns a channel that reports when it is ready (or why it cannot be used).
fn spawn_thread(
    app: AppHandle,
    qa: &SharedQa,
    id: u64,
    session: &str,
    cwd: Option<String>,
    allow_write: bool,
) -> Result<mpsc::Receiver<Result<(), String>>, String> {
    let mut q = qa.lock().unwrap();
    q.stop();
    let launch = q.launch.clone().ok_or("还不知道 pi 的位置：请在 pi 里执行 /viewer 后再试")?;
    // Without the guard the fork would have write tools and nothing holding them back.
    let guard = launch.guard.clone().ok_or("拦截扩展的位置未知：请在 pi 里先 /reload 再执行 /viewer")?;
    let dir = root().join(format!("{}-{}", std::process::id(), id));
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    let _ = std::fs::write(dir.join(ALLOW_WRITE), if allow_write { "1" } else { "0" });

    let mut cmd = Command::new(&launch.node);
    cmd.arg(&launch.cli)
        .arg("--fork")
        .arg(session)
        .arg("--session-dir")
        .arg(&dir)
        .args(&launch.args)
        .arg("-e")
        .arg(&guard)
        .args(["--mode", "rpc"])
        .env("SMP_QA_DIR", &dir)
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
    let (Some(mut stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
        unreachable!("all three streams are piped")
    };
    // The answer to this arrives only once startup (extensions included) is done.
    let _ = stdin.write_all(format!("{{\"id\":\"{READY_ID}\",\"type\":\"get_state\"}}\n").as_bytes());
    let _ = stdin.flush();

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
    let (tx, rx) = mpsc::channel();
    let guard_flag = dir.join(GUARD_OK);
    std::thread::spawn(move || {
        let mut ready = Some(tx);
        // RPC records are LF-delimited JSON; lines() splits on LF only (and drops a trailing CR).
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(record) = serde_json::from_str::<Value>(&line) {
                if record.get("id").and_then(Value::as_str) == Some(READY_ID) {
                    if let Some(tx) = ready.take() {
                        let ok = record.get("success").and_then(Value::as_bool).unwrap_or(false);
                        let _ = tx.send(if !ok {
                            Err("子代理没有正常启动".into())
                        } else if !guard_flag.exists() {
                            Err("拦截扩展没有加载，为安全起见已取消。请在 pi 里 /reload 后重试".into())
                        } else {
                            Ok(())
                        });
                    }
                }
                let _ = app.emit("qa-event", QaEvent { id, record });
            }
        }
        // Let stderr drain before reporting why the process ended.
        std::thread::sleep(Duration::from_millis(100));
        let stderr = tail.lock().unwrap().clone();
        let _ = app.emit("qa-exit", QaExit { id, stderr });
    });

    q.current = Some(Thread { id, child, stdin, dir });
    Ok(rx)
}

/// Starts a new thread (ending any previous one) and returns once the forked pi is up and the guard is
/// confirmed loaded. `id` comes from the frontend so it can match events that arrive before this returns.
#[tauri::command]
pub async fn qa_start(
    app: AppHandle,
    qa: State<'_, SharedQa>,
    id: u64,
    session: String,
    cwd: Option<String>,
    allow_write: bool,
) -> Result<(), String> {
    let ready = spawn_thread(app, &qa, id, &session, cwd, allow_write)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || ready.recv_timeout(READY_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?;
    let why = match outcome {
        Ok(Ok(())) => return Ok(()),
        Ok(Err(why)) => why,
        Err(RecvTimeoutError::Timeout) => format!("子代理 {} 秒内没有启动完成", READY_TIMEOUT.as_secs()),
        Err(RecvTimeoutError::Disconnected) => "子代理启动时就退出了".into(),
    };
    let mut q = qa.lock().unwrap();
    if q.current.as_ref().is_some_and(|t| t.id == id) {
        q.stop();
    }
    Err(why)
}

/// Turns the subagent's permission to modify things on or off, effective from its next tool call.
#[tauri::command]
pub fn qa_set_write(qa: State<'_, SharedQa>, id: u64, allow: bool) -> Result<(), String> {
    let q = qa.lock().unwrap();
    let t = q.current.as_ref().filter(|t| t.id == id).ok_or("问答已结束")?;
    // Written, never deleted: see extension/qa-guard.ts for why the content is what counts.
    std::fs::write(t.dir.join(ALLOW_WRITE), if allow { "1" } else { "0" }).map_err(|e| format!("切换失败：{e}"))
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
