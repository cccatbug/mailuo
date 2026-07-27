import { bridge } from "./bridge";

/** 是否运行在桌面壳（Electron）内 */
export const hasNative = bridge !== null;

export const isMac = bridge
  ? bridge.platform === "darwin"
  : typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/** 平台修饰键的展示符号（快捷键本身两平台都已支持 meta/ctrl） */
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

export const modLabel = (key: string) =>
  isMac ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`;
