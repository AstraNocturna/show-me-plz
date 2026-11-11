import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SessionEntry, Snapshot } from "./types";

interface AppendedEvent { generation: number; start: number; entries: SessionEntry[] }
interface LeafEvent { generation: number; leaf: string | null }

export interface SessionView extends Snapshot {
  hostConnected: boolean;
}

const EMPTY: SessionView = { generation: -1, file: null, entries: [], leafOverride: null, hostConnected: true };

/** Live mirror of the backend session state: snapshot first, then incremental events. */
export function useSession(): SessionView {
  const [view, setView] = useState<SessionView>(EMPTY);

  useEffect(() => {
    let disposed = false;
    const refetch = async () => {
      const snap = await invoke<Snapshot>("get_snapshot");
      if (!disposed) setView((v) => ({ ...snap, hostConnected: v.hostConnected }));
    };

    const unlisteners = Promise.all([
      listen<number>("session-reset", () => void refetch()),
      listen<AppendedEvent>("entries-appended", ({ payload }) => {
        setView((v) => {
          if (payload.generation !== v.generation || payload.start > v.entries.length) {
            // Missed something: resync. (Updater may re-run in StrictMode; a duplicate refetch is harmless.)
            queueMicrotask(() => void refetch());
            return v;
          }
          // Events may overlap the snapshot taken before listeners were attached.
          const fresh = payload.entries.slice(v.entries.length - payload.start);
          return fresh.length ? { ...v, entries: [...v.entries, ...fresh], leafOverride: null } : v;
        });
      }),
      listen<LeafEvent>("leaf-changed", ({ payload }) =>
        setView((v) => (payload.generation === v.generation ? { ...v, leafOverride: payload.leaf } : v)),
      ),
      listen("host-disconnected", () => setView((v) => ({ ...v, hostConnected: false }))),
    ]);
    // Snapshot after listeners are attached so nothing falls in between.
    void unlisteners.then(refetch);

    return () => {
      disposed = true;
      void unlisteners.then((fns) => fns.forEach((f) => f()));
    };
  }, []);

  return view;
}
