import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { RevealContext } from "./reveal";

/** Which conversation boxes (a user prompt, or the agent's reply of a turn) are folded to one line. */
export interface Folds {
  isFolded(key: string): boolean;
  toggle(key: string): void;
  /** Folds or unfolds exactly these boxes, leaving the rest as they are. */
  setMany(keys: string[], folded: boolean): void;
  readonly count: number;
}

export const FoldContext = createContext<Folds | null>(null);

/** The key of a turn's agent box; user boxes use `userKey(turn.id)`. */
export const agentKey = (turnId: string) => `${turnId}:agent`;

export function useFoldState(): Folds {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setFolded((s) => {
        const next = new Set(s);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const setMany = useCallback(
    (keys: string[], value: boolean) =>
      setFolded((s) => {
        const next = new Set(s);
        for (const k of keys) value ? next.add(k) : next.delete(k);
        return next;
      }),
    [],
  );
  return useMemo(() => ({ isFolded: (k) => folded.has(k), toggle, setMany, count: folded.size }), [folded, toggle, setMany]);
}

/**
 * Whether the box `key` is folded, plus a toggle. A search hit or bookmark jump that lands inside it
 * (`covers` says which unit keys do) unfolds it; the user can fold it again afterwards.
 */
export function useFolded(key: string, covers: (unit: string) => boolean): [boolean, () => void] {
  const folds = useContext(FoldContext);
  const reveal = useContext(RevealContext);
  const hit = reveal && covers(reveal.key) ? reveal.nonce : null;
  useEffect(() => {
    if (hit !== null) folds?.setMany([key], false);
  }, [hit]);
  return [folds?.isFolded(key) ?? false, () => folds?.toggle(key)];
}
