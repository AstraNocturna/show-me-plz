import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What the agent is doing right now, as reported by the pi extension. */
export interface Activity {
  state: "idle" | "thinking" | "writing" | "tool" | "waiting" | "";
  detail?: string | null;
}

const IDLE: Activity = { state: "idle" };

export const isWorking = (a: Activity) =>
  a.state === "thinking" || a.state === "writing" || a.state === "tool" || a.state === "waiting";
/** The terminal is showing a confirmation dialog and the agent is blocked until the user answers. */
export const isWaiting = (a: Activity) => a.state === "waiting";

/** Live agent activity: entries only reach the session file once complete, this fills the gap. */
export function useActivity(): Activity {
  const [activity, setActivity] = useState<Activity>(IDLE);

  useEffect(() => {
    let disposed = false;
    const unlisteners = Promise.all([
      listen<Activity>("activity", ({ payload }) => setActivity(payload)),
      listen("host-disconnected", () => setActivity(IDLE)),
    ]);
    // Listen first, then read the current state, so a change in between is not lost.
    void unlisteners
      .then(() => invoke<Activity>("get_activity"))
      .then((a) => !disposed && setActivity((cur) => (cur === IDLE ? a : cur)));
    return () => {
      disposed = true;
      void unlisteners.then((fns) => fns.forEach((f) => f()));
    };
  }, []);

  return activity;
}
