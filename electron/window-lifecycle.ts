import type { PiResourceProgressEvent } from "../src/shared/pi-resources";

export interface WindowContentsLike {
  isDestroyed?: () => boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface ProgressWindowLike {
  isDestroyed?: () => boolean;
  readonly webContents: WindowContentsLike;
}

export interface ShowableWindowLike {
  isDestroyed?: () => boolean;
  show(): void;
}

export function isDestroyedError(error: unknown): boolean {
  return error instanceof Error && /Object has been destroyed/i.test(error.message);
}

/** ready-to-show 与窗口关闭可能竞争；销毁后收到事件时静默忽略。 */
export function showWindowWhenReady(target: ShowableWindowLike): void {
  try {
    if (!target.isDestroyed?.()) target.show();
  } catch (error) {
    if (!isDestroyedError(error)) throw error;
  }
}

/** window.loadURL/loadFile 可能在销毁竞态下 reject；不能留下 unhandled rejection。 */
export function reportWindowLoadError(error: unknown): void {
  if (isDestroyedError(error)) return;
  console.error("Electron renderer 加载失败：", error);
}

/**
 * 向 renderer 发消息时同时处理检查与发送之间的销毁竞态。
 * Electron 的 destroyed 对象访问 webContents 本身也可能抛异常，所以不能只检查 webContents。
 */
export function safeSendToContents(
  contents: WindowContentsLike | null,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!contents || contents.isDestroyed?.()) return false;
  try {
    contents.send(channel, ...args);
    return true;
  } catch (error) {
    if (isDestroyedError(error)) return false;
    throw error;
  }
}

export function safeSendToWindow(
  target: ProgressWindowLike | null,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!target || target.isDestroyed?.()) return false;
  try {
    return safeSendToContents(target.webContents, channel, ...args);
  } catch (error) {
    if (isDestroyedError(error)) return false;
    throw error;
  }
}

/** 将资源进度转发给 renderer；窗口销毁时应静默丢弃事件。 */
export function sendPiResourceProgress(
  target: ProgressWindowLike | null,
  event: PiResourceProgressEvent
): void {
  safeSendToWindow(target, "pi:resources:progress", event);
}
