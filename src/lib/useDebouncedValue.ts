import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Local-first text state that commits upstream on a debounce.
 *
 * Typing into a fully controlled field that writes straight to the global store
 * costs a full `tasks.map()` + reconcile + persist per keystroke, and re-renders
 * every subscriber — which is what makes typing feel sticky and the caret jump.
 * Holding the draft locally keeps the caret stable and collapses the writes.
 *
 * `value` wins whenever it changes from the outside (switching tasks, undo), so
 * the field never shows a stale draft.
 */
export function useDebouncedCommit(
  value: string,
  commit: (next: string) => void,
  delay = 300
): [string, (next: string) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draftRef = useRef(draft);
  const commitRef = useRef(commit);
  const upstreamRef = useRef(value);

  draftRef.current = draft;
  commitRef.current = commit;

  // 外部值变了（切任务、撤销）就丢掉本地草稿，避免显示上一条的内容
  useEffect(() => {
    if (value === upstreamRef.current) return;
    upstreamRef.current = value;
    clearTimeout(timerRef.current);
    setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    if (draftRef.current === upstreamRef.current) return;
    upstreamRef.current = draftRef.current;
    commitRef.current(draftRef.current);
  }, []);

  const set = useCallback(
    (next: string) => {
      setDraft(next);
      draftRef.current = next;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delay);
    },
    [delay, flush]
  );

  // 卸载前把未提交的改动写出去，否则关面板会吞掉最后几个字
  useEffect(() => () => flush(), [flush]);

  return [draft, set, flush];
}
