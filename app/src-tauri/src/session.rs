//! Incremental, read-only tail of a pi session JSONL file.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

#[derive(Default)]
pub struct SessionState {
    pub file: Option<PathBuf>,
    /// Bumped whenever the viewed file changes or is rewritten; lets the UI drop stale events.
    pub generation: u64,
    pub entries: Vec<Value>,
    /// Leaf reported by the pi host (`/tree` navigation). Cleared when new entries arrive,
    /// because pi appends new entries at the current leaf.
    pub leaf_override: Option<String>,
    offset: u64,
    partial: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generation: u64,
    pub file: Option<String>,
    pub entries: Vec<Value>,
    pub leaf_override: Option<String>,
}

pub enum Poll {
    Unchanged,
    /// File shrank or was replaced: state was reset and fully re-read.
    Reset,
    Appended { start: usize, entries: Vec<Value> },
}

impl SessionState {
    pub fn switch_to(&mut self, file: Option<PathBuf>, leaf: Option<String>) {
        self.file = file;
        self.generation += 1;
        self.entries.clear();
        self.leaf_override = leaf;
        self.offset = 0;
        self.partial.clear();
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            generation: self.generation,
            file: self.file.as_ref().map(|p| p.to_string_lossy().into_owned()),
            entries: self.entries.clone(),
            leaf_override: self.leaf_override.clone(),
        }
    }

    /// Reads any bytes appended since the last poll. Missing files are treated as empty,
    /// because pi may create the session file lazily.
    pub fn poll(&mut self) -> Poll {
        let Some(path) = self.file.clone() else {
            return Poll::Unchanged;
        };
        let Ok(mut f) = File::open(&path) else {
            return Poll::Unchanged;
        };
        let Ok(len) = f.metadata().map(|m| m.len()) else {
            return Poll::Unchanged;
        };

        let mut reset = false;
        if len < self.offset {
            let leaf = self.leaf_override.take();
            self.switch_to(Some(path), leaf);
            reset = true;
        }
        if len == self.offset {
            return if reset { Poll::Reset } else { Poll::Unchanged };
        }

        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        if f.seek(SeekFrom::Start(self.offset)).is_err() || f.read_to_end(&mut buf).is_err() {
            return if reset { Poll::Reset } else { Poll::Unchanged };
        }
        self.offset += buf.len() as u64;
        self.partial.extend_from_slice(&buf);

        // Only consume complete lines; keep the trailing partial line for the next poll.
        let Some(last_nl) = self.partial.iter().rposition(|&b| b == b'\n') else {
            return if reset { Poll::Reset } else { Poll::Unchanged };
        };
        let complete: Vec<u8> = self.partial.drain(..=last_nl).collect();
        let start = self.entries.len();
        for line in complete.split(|&b| b == b'\n') {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                self.entries.push(v);
            }
        }
        if self.entries.len() > start {
            self.leaf_override = None;
        }

        if reset {
            Poll::Reset
        } else if self.entries.len() > start {
            Poll::Appended { start, entries: self.entries[start..].to_vec() }
        } else {
            Poll::Unchanged
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn ids(s: &SessionState) -> Vec<String> {
        s.entries.iter().map(|e| e["id"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn tails_complete_lines_and_handles_rewrite() {
        let path = std::env::temp_dir().join(format!("smp-test-{}.jsonl", std::process::id()));
        std::fs::write(&path, "").unwrap();
        let mut s = SessionState::default();
        s.switch_to(Some(path.clone()), Some("x".into()));

        // A partially written line must not be parsed yet.
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        write!(f, "{{\"id\":\"a\"}}\r\n{{\"id\":").unwrap();
        assert!(matches!(s.poll(), Poll::Appended { start: 0, .. }));
        assert_eq!(ids(&s), ["a"]);
        assert_eq!(s.leaf_override, None, "new entries clear the host leaf override");

        write!(f, "\"b\"}}\n\n").unwrap();
        assert!(matches!(s.poll(), Poll::Appended { start: 1, .. }));
        assert_eq!(ids(&s), ["a", "b"]);
        assert!(matches!(s.poll(), Poll::Unchanged));
        drop(f);

        // A shorter file means pi rewrote it (e.g. migration): re-read from scratch.
        let gen_before = s.generation;
        std::fs::write(&path, "{\"id\":\"c\"}\n").unwrap();
        assert!(matches!(s.poll(), Poll::Reset));
        assert_eq!(ids(&s), ["c"]);
        assert!(s.generation > gen_before);

        std::fs::remove_file(&path).unwrap();
    }
}
