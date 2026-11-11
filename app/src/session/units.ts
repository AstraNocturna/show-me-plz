// Stable keys for addressable pieces of a turn ("units"). Rendered as `data-unit` attributes and
// used by search, bookmarks and reveal. Sessions are append-only, so indexes stay stable.

export const userKey = (turnId: string) => `${turnId}:u`;
export const partKey = (turnId: string, i: number) => `${turnId}:p${i}`;
export const stepKey = (processKey: string, j: number) => `${processKey}:s${j}`;

/** True when `key` is `container` itself or nested inside it (e.g. a step inside a process). */
export function within(key: string | undefined, container: string): boolean {
  return !!key && (key === container || key.startsWith(container + ":"));
}
