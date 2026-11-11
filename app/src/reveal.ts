import { createContext, useContext, useEffect } from "react";
import { within } from "./session/units";

/** A request to make a unit visible (search hit, bookmark jump). `nonce` re-triggers the same key. */
export interface Reveal {
  key: string;
  nonce: number;
}

export const RevealContext = createContext<Reveal | null>(null);

/** Calls `open` when a reveal targets `key` or something nested in it; the user can fold it again later. */
export function useRevealOpen(key: string, open: () => void): void {
  const reveal = useContext(RevealContext);
  const hit = reveal && within(reveal.key, key) ? reveal.nonce : null;
  useEffect(() => {
    if (hit !== null) open();
  }, [hit]);
}
