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
