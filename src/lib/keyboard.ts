interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** True when application-wide shortcuts must yield to a text editor. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as ElementLike;
  const tagName = element.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea") return true;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest?.(
      "[contenteditable='true'], [contenteditable=''], .monaco-editor, [data-text-editor]"
    )
  );
}

/** The subset of a keyboard event this module needs; works for React and DOM events. */
export interface KeyEventLike {
  key?: string;
  keyCode?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/**
 * True while an IME candidate window is open — Enter belongs to the composition,
 * not to us. 中文/日文/韩文输入法按回车是「选词」，不是「提交」。
 *
 * React 的合成事件不转发 isComposing，所以要看 nativeEvent；keyCode 229 是
 * 部分 WebKit 版本在 compositionend 那一帧不置 isComposing 时的兜底。
 */
export function isImeComposing(event: KeyEventLike | null | undefined): boolean {
  if (!event) return false;
  if (event.nativeEvent?.isComposing || event.isComposing) return true;
  return (event.nativeEvent?.keyCode ?? event.keyCode) === 229;
}

/**
 * True when Enter should be treated as "submit this input".
 *
 * Never true while an IME is composing. By default Shift+Enter is a newline
 * rather than a submit; pass `allowShift` for single-line inputs where Shift
 * carries no meaning.
 */
export function isSubmitKey(
  event: KeyEventLike | null | undefined,
  options: { allowShift?: boolean } = {}
): boolean {
  if (!event || event.key !== "Enter") return false;
  if (isImeComposing(event)) return false;
  if (!options.allowShift && event.shiftKey) return false;
  return true;
}
