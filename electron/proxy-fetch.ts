/**
 * 让全局 fetch 尊重 HTTP(S)_PROXY / NO_PROXY 环境变量。
 * Node 内置 fetch 默认无视代理环境变量（pi CLI 自带同等处理，但未从 SDK 导出），
 * 这里用 undici 的 EnvHttpProxyAgent 替换全局 fetch —— 必须在 pi SDK 首次发请求前生效。
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

const agent = new EnvHttpProxyAgent();

globalThis.fetch = ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
  undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof fetch;
