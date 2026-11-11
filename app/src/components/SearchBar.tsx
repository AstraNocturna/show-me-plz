import { useEffect, useRef } from "react";
import type { Scope } from "../search/search";
import type { SearchState } from "../search/useSearch";

const SCOPES: Array<[Scope, string]> = [
  ["all", "全部"],
  ["user", "提问"],
  ["answer", "回答"],
  ["process", "过程"],
];

export function SearchBar({ s, focusNonce }: { s: SearchState; focusNonce: number }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusNonce]);

  const status = s.error
    ? "正则无效"
    : !s.query
      ? ""
      : s.hits.length
        ? `${s.index + 1}/${s.hits.length}${s.capped ? "+" : ""}`
        : "无结果";

  return (
    <div className="searchbar">
      <input
        ref={input}
        value={s.query}
        placeholder="搜索当前会话（含折叠内容）"
        spellCheck={false}
        title={s.error ?? undefined}
        className={s.error ? "invalid" : ""}
        onChange={(e) => s.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) s.prev();
            else s.next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            s.setOpen(false);
          }
        }}
      />
      <button className={`toggle ${s.caseSensitive ? "on" : ""}`} title="区分大小写" onClick={() => s.setCaseSensitive(!s.caseSensitive)}>
        Aa
      </button>
      <button className={`toggle ${s.regex ? "on" : ""}`} title="正则表达式" onClick={() => s.setRegex(!s.regex)}>
        .*
      </button>
      <div className="segmented small">
        {SCOPES.map(([v, label]) => (
          <button key={v} className={s.scope === v ? "on" : ""} onClick={() => s.setScope(v)}>
            {label}
          </button>
        ))}
      </div>
      <span className={`search-status ${s.error || (s.query && !s.hits.length) ? "err" : ""}`}>{status}</span>
      <button className="toggle" title="上一个 (Shift+Enter)" onClick={s.prev}>↑</button>
      <button className="toggle" title="下一个 (Enter)" onClick={s.next}>↓</button>
      <button className="toggle" title="关闭 (Esc)" onClick={() => s.setOpen(false)}>✕</button>
    </div>
  );
}
