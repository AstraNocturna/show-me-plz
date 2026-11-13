import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What pi's terminal footer shows, as reported by the extension. */
export interface HostStatus {
  model?: { provider: string; id: string; name?: string } | null;
  thinking?: string | null;
  context?: { tokens: number | null; window: number; percent: number | null } | null;
}

/** Live model, thinking level and context fill; empty until pi has reported (or when run standalone). */
export function useHostStatus(): HostStatus {
  const [status, setStatus] = useState<HostStatus>({});

  useEffect(() => {
    let disposed = false;
    const unlisten = listen<HostStatus>("host-status", ({ payload }) => setStatus(payload));
    // Listen first, then read the current state, so a change in between is not lost.
    void unlisten
      .then(() => invoke<HostStatus>("get_status"))
      .then((s) => !disposed && setStatus((cur) => (Object.keys(cur).length ? cur : s)));
    return () => {
      disposed = true;
      void unlisten.then((f) => f());
    };
  }, []);

  return status;
}

export interface GitInfo {
  branch: string | null;
  changed: number;
}

const GIT_POLL_MS = 8000;

/** Branch and changed-file count of `cwd`, refreshed on a timer and whenever `tick` changes. */
export function useGit(cwd: string | undefined, tick: unknown): GitInfo | null {
  const [info, setInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    if (!cwd) {
      setInfo(null);
      return;
    }
    let disposed = false;
    const read = () =>
      void invoke<GitInfo>("git_info", { cwd })
        .then((g) => !disposed && setInfo((cur) => (cur && cur.branch === g.branch && cur.changed === g.changed ? cur : g)))
        .catch(() => {});
    read();
    const timer = window.setInterval(read, GIT_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
    // `tick` is a re-read trigger only.
  }, [cwd, tick]);

  return info;
}
