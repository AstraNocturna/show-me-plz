import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../actions";

export const MARK_COLORS = ["#e3b341", "#f85149", "#3fb950", "#4493f8"] as const;

export interface Mark {
  /** Unit key (see session/units.ts). */
  key: string;
  turnId: string;
  preview: string;
  note: string;
  color: number;
  createdAt: number;
}

interface MarksFile {
  version: 1;
  marks: Mark[];
}

export interface MarksApi {
  marks: Mark[];
  has(key: string): boolean;
  toggle(m: Pick<Mark, "key" | "turnId" | "preview">): void;
  update(key: string, patch: Partial<Pick<Mark, "note" | "color">>): void;
  remove(key: string): void;
}

const SAVE_DELAY = 300;

const serialize = (marks: Mark[]) => JSON.stringify({ version: 1, marks } satisfies MarksFile, null, 1);

/** Bookmarks for one session, persisted by the backend in the app data dir (not in pi's session). */
export function useMarks(sessionId: string | undefined): MarksApi {
  const [marks, setMarks] = useState<Mark[]>([]);
  const loadedFor = useRef<string | undefined>(undefined);
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    loadedFor.current = undefined;
    setMarks([]);
    if (!sessionId) return;
    let cancelled = false;
    invoke<string | null>("load_marks", { sessionId })
      .then((json) => {
        if (cancelled) return;
        const file = json ? (JSON.parse(json) as MarksFile) : null;
        const loaded = file?.marks ?? [];
        setMarks(loaded);
        lastWritten.current = serialize(loaded);
        loadedFor.current = sessionId;
      })
      .catch((e) => toast(`书签读取失败: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    // Only save after this session's marks were loaded, so an early empty state never overwrites the file.
    if (!sessionId || loadedFor.current !== sessionId) return;
    const json = serialize(marks);
    if (json === lastWritten.current) return;
    const timer = setTimeout(() => {
      lastWritten.current = json;
      invoke("save_marks", { sessionId, json }).catch((e) => toast(`书签保存失败: ${String(e)}`));
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [marks, sessionId]);

  const has = useCallback((key: string) => marks.some((m) => m.key === key), [marks]);
  const toggle = useCallback<MarksApi["toggle"]>((m) => {
    setMarks((ms) =>
      ms.some((x) => x.key === m.key)
        ? ms.filter((x) => x.key !== m.key)
        : [...ms, { ...m, note: "", color: 0, createdAt: Date.now() }],
    );
  }, []);
  const update = useCallback<MarksApi["update"]>((key, patch) => {
    setMarks((ms) => ms.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }, []);
  const remove = useCallback((key: string) => setMarks((ms) => ms.filter((x) => x.key !== key)), []);

  return { marks, has, toggle, update, remove };
}

export const MarksContext = createContext<MarksApi | null>(null);

export function MarkButton({ unitKey, turnId, preview }: { unitKey: string; turnId: string; preview: string }) {
  const api = useContext(MarksContext);
  if (!api) return null;
  const marked = api.has(unitKey);
  const color = marked ? MARK_COLORS[api.marks.find((m) => m.key === unitKey)!.color] : undefined;
  return (
    <button
      className={`mark-btn ${marked ? "on" : ""}`}
      style={color ? { color } : undefined}
      title={marked ? "取消书签 (m)" : "加书签 (m)"}
      onClick={() => api.toggle({ key: unitKey, turnId, preview: preview.slice(0, 200) })}
    >
      {marked ? "★" : "☆"}
    </button>
  );
}
