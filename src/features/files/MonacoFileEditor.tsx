import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/find/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/features/json/register";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import { wrapsLongLines } from "./editor-language";

type MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

(globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment })
  .MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export function MonacoFileEditor({
  path,
  value,
  language,
  theme,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  language: string;
  theme: "light" | "dark";
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const onMount: OnMount = (editor) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave());
    editor.focus();
  };

  return (
    <div className="min-h-0 flex-1" data-text-editor>
      <Editor
        path={path}
        value={value}
        language={language}
        theme={theme === "dark" ? "vs-dark" : "light"}
        keepCurrentModel
        saveViewState
        onMount={onMount}
        onChange={(next) => onChange(next ?? "")}
        loading={
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            正在加载编辑器…
          </div>
        }
        options={{
          automaticLayout: true,
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 20,
          minimap: { enabled: false },
          padding: { top: 12, bottom: 12 },
          renderWhitespace: "selection",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: wrapsLongLines(language) ? "on" : "off",
        }}
      />
    </div>
  );
}
