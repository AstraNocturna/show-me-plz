mod marks;
mod session;

use std::io::BufRead;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use session::{Poll, SessionState, Snapshot};
use tauri::{AppHandle, Emitter, Manager, State};

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

/// Control messages sent by the pi extension, one JSON object per stdin line.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HostMessage {
    Session { file: Option<String>, leaf: Option<String> },
    Leaf { id: Option<String> },
    Focus,
}

#[tauri::command]
fn get_snapshot(state: State<'_, Shared>) -> Snapshot {
    state.lock().unwrap().snapshot()
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
fn spawn_stdin_reader(app: AppHandle, state: Shared) {
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
            }
        }
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .setup(move |app| {
            spawn_poller(app.handle().clone(), state.clone());
            spawn_stdin_reader(app.handle().clone(), state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_snapshot, marks::load_marks, marks::save_marks])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
