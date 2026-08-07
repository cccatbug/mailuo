import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  usesDeepSeekWebSearch,
  type AiProviderConfig,
} from "../src/shared/ai-config";

type JsonObject = Record<string, unknown>;

const DEEPSEEK_WEB_SEARCH_TOOL_TYPES = new Set([
  "web_search",
  "web_search_2025_08_26",
]);

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** Add DeepSeek's server-executed search tool to an OpenAI Responses payload. */
export function injectDeepSeekWebSearch(payload: unknown): unknown {
  const body = jsonObject(payload);
  if (!body) return payload;

  const existing = body.tools;
  if (existing !== undefined && !Array.isArray(existing)) return payload;
  const tools = existing ?? [];
  if (
    tools.some((tool) => {
      const type = jsonObject(tool)?.type;
      return (
        typeof type === "string" && DEEPSEEK_WEB_SEARCH_TOOL_TYPES.has(type)
      );
    })
  ) {
    return payload;
  }

  return {
    ...body,
    tools: [...tools, { type: "web_search" }],
  };
}

/**
 * pi represents client-executed tools as functions. This request hook adds the
 * one DeepSeek tool that is executed by the provider itself.
 */
export function createProviderToolsExtension(
  provider: AiProviderConfig
): InlineExtension {
  return {
    name: "mailuo-provider-tools",
    hidden: true,
    factory(pi) {
      if (!usesDeepSeekWebSearch(provider)) return;
      pi.on("before_provider_request", (event) =>
        injectDeepSeekWebSearch(event.payload)
      );
    },
  };
}
