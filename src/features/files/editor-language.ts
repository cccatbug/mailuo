const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  css: "css",
  csv: "plaintext",
  htm: "html",
  html: "html",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  log: "plaintext",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  cjs: "javascript",
  cts: "typescript",
  scss: "scss",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export function fileEditorLanguage(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return (extension && LANGUAGE_BY_EXTENSION[extension]) || "plaintext";
}

export function wrapsLongLines(language: string): boolean {
  return language === "markdown" || language === "plaintext";
}
