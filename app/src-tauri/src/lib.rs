mod files;
mod git;
mod marks;
mod qa;
mod session;

use std::io::BufRead;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use qa::{Qa, SharedQa};
use session::{Poll, SessionState, Snapshot};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

type Shared = Arc<Mutex<SessionState>>;

const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppendedEvent {
    generation: u64,
    start: usize,
    entries: Vec<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LeafEvent {
    generation: u64,
    leaf: Option<String>,
}

/// What the agent is doing right now ("thinking", "writing", "tool"; empty or "idle" when nothing).
/// Kept so a window that finishes loading mid-run can still show it.
#[derive(Clone, Default, Serialize)]
struct Activity {
    state: String,
    detail: Option<String>,
}

type SharedActivity = Arc<Mutex<Activity>>;

/// The terminal footer's data (model, thinking level, context fill), as reported by the extension.
#[derive(Clone, Default, Serialize)]
struct HostStatus {
    model: Option<Value>,
    thinking: Option<String>,
    context: Option<Value>,
}

type SharedStatus = Arc<Mutex<HostStatus>>;

/// Control messages sent by the pi extension, one JSON object per stdin line.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HostMessage {
    Session { file: Option<String>, leaf: Option<String> },
    Leaf { id: Option<String> },
    Focus,
    Activity { state: String, detail: Option<String> },
    /// How to start the host's own pi, used to fork the session for side questions.
    Host { node: String, cli: String, #[serde(default)] args: Vec<String>, guard: Option<String> },
    Status { model: Option<Value>, thinking: Option<String>, context: Option<Value> },
}

#[tauri::command]
fn get_snapshot(state: State<'_, Shared>) -> Snapshot {
    state.lock().unwrap().snapshot()
}

#[tauri::command]
fn get_status(status: State<'_, SharedStatus>) -> HostStatus {
    status.lock().unwrap().clone()
}

#[tauri::command]
fn get_activity(activity: State<'_, SharedActivity>) -> Activity {
    activity.lock().unwrap().clone()
}

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn spawn_poller(app: AppHandle, state: Shared) {
    std::thread::spawn(move || loop {
        let (result, generation) = {
            let mut s = state.lock().unwrap();
            (s.poll(), s.generation)
        };
        match result {
            Poll::Unchanged => {}
            Poll::Reset => {
                let _ = app.emit("session-reset", generation);
            }
            Poll::Appended { start, entries } => {
                let _ = app.emit("entries-appended", AppendedEvent { generation, start, entries });
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    });
}

/// Reads host control messages. EOF means pi exited; the window stays open for reading.
fn spawn_stdin_reader(app: AppHandle, state: Shared, activity: SharedActivity, status: SharedStatus, qa: SharedQa) {
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<HostMessage>(&line) else { continue };
            match msg {
                HostMessage::Session { file, leaf } => {
                    let generation = {
                        let mut s = state.lock().unwrap();
                        s.switch_to(file.map(PathBuf::from), leaf);
                        s.generation
                    };
                    let _ = app.emit("session-reset", generation);
                }
                HostMessage::Leaf { id } => {
                    let generation = {
                        let mut s = state.lock().unwrap();
                        s.leaf_override = id.clone();
                        s.generation
                    };
                    let _ = app.emit("leaf-changed", LeafEvent { generation, leaf: id });
                }
                HostMessage::Focus => focus_main(&app),
                HostMessage::Activity { state, detail } => {
                    let a = Activity { state, detail };
                    *activity.lock().unwrap() = a.clone();
                    let _ = app.emit("activity", a);
                }
                HostMessage::Host { node, cli, args, guard } => qa.lock().unwrap().set_launch(node, cli, args, guard),
                HostMessage::Status { model, thinking, context } => {
                    let s = HostStatus { model, thinking, context };
                    *status.lock().unwrap() = s.clone();
                    let _ = app.emit("host-status", s);
                }
            }
        }
        *activity.lock().unwrap() = Activity::default();
        let _ = app.emit("host-disconnected", ());
    });
}

fn initial_session_arg() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--session" {
            return args.next().map(PathBuf::from);
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: Shared = Arc::new(Mutex::new(SessionState::default()));
    state.lock().unwrap().switch_to(initial_session_arg(), None);
    let activity: SharedActivity = Arc::default();
    let status: SharedStatus = Arc::default();
    let qa: SharedQa = Arc::new(Mutex::new(Qa::default()));
    Qa::sweep_stale();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .manage(activity.clone())
        .manage(status.clone())
        .manage(qa.clone())
        .setup({
            let qa = qa.clone();
            move |app| {
                spawn_poller(app.handle().clone(), state.clone());
                spawn_stdin_reader(app.handle().clone(), state.clone(), activity.clone(), status.clone(), qa.clone());
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_activity,
            get_status,
            git::git_info,
            marks::load_marks,
            marks::save_marks,
            files::read_file,
            files::check_paths,
            qa::qa_start,
            qa::qa_send,
            qa::qa_set_write,
            qa::qa_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_, event| {
            // Closing the window discards the side-question thread and its fork.
            if let RunEvent::Exit = event {
                qa.lock().unwrap().stop_all();
            }
        });
}
