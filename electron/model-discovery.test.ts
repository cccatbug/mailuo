import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { Credential } from "@earendil-works/pi-ai";
import {
  discoverModels,
  ModelDiscoveryError,
  testProviderConnection,
} from "./model-discovery";
import type { AiProviderConfig } from "../src/shared/ai-config";

const servers: Array<ReturnType<typeof createServer>> = [];

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

function provider(
  patch: Partial<AiProviderConfig> = {}
): AiProviderConfig {
  return {
    id: "a9173512-b61c-4b13-bfe2-f42ea09575e1",
    name: "Test",
    preset: "custom",
    enabled: true,
    baseUrl: "http://127.0.0.1",
    api: "openai-completions",
    authMode: "api-key",
    authHeader: true,
    headers: { "X-Plain": "plain" },
    secretHeaderNames: [],
    discovery: { adapter: "openai" },
    ...patch,
  };
}

const credential: Credential = { type: "api_key", key: "top-secret-key" };

describe("discoverModels", () => {
  it("discovers an OpenAI-compatible catalog with draft credentials and inferred defaults", async () => {
    let requestedPath = "";
    let authorization = "";
    let plainHeader = "";
    const baseUrl = await serve((request, response) => {
      requestedPath = request.url ?? "";
      authorization = request.headers.authorization ?? "";
      plainHeader = String(request.headers["x-plain"] ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "acme-chat" }] }));
    });

    const models = await discoverModels(
      provider({ baseUrl: `${baseUrl}/v1/` }),
      credential
    );

    expect(requestedPath).toBe("/v1/models");
    expect(authorization).toBe("Bearer top-secret-key");
    expect(plainHeader).toBe("plain");
    expect(models).toEqual([
      {
        modelId: "acme-chat",
        name: "acme-chat",
        input: ["text"],
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 16384,
        metadataSource: "inferred",
      },
    ]);
  });

  it("follows Gemini pagination and keeps returned token limits", async () => {
    const paths: string[] = [];
    const baseUrl = await serve((request, response) => {
      paths.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      if ((request.url ?? "").includes("pageToken=next")) {
        response.end(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-vision",
                displayName: "Gemini Vision",
                inputTokenLimit: 1000000,
                outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          })
        );
      } else {
        response.end(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-text",
                inputTokenLimit: 32000,
                outputTokenLimit: 4096,
              },
            ],
            nextPageToken: "next",
          })
        );
      }
    });

    const models = await discoverModels(
      provider({
        baseUrl: `${baseUrl}/v1beta`,
        api: "google-generative-ai",
        discovery: { adapter: "gemini" },
      }),
      { type: "api_key", key: "gemini-key" }
    );

    expect(paths).toEqual([
      "/v1beta/models?key=gemini-key&pageSize=1000",
      "/v1beta/models?key=gemini-key&pageSize=1000&pageToken=next",
    ]);
    expect(models[1]).toMatchObject({
      modelId: "gemini-vision",
      contextWindow: 1000000,
      maxTokens: 8192,
      metadataSource: "remote",
    });
  });

  it("uses the service origin for Ollama tags", async () => {
    let requestedPath = "";
    const baseUrl = await serve((request, response) => {
      requestedPath = request.url ?? "";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
    });

    const models = await discoverModels(
      provider({
        baseUrl: `${baseUrl}/v1`,
        authMode: "none",
        discovery: { adapter: "ollama" },
      })
    );

    expect(requestedPath).toBe("/api/tags");
    expect(models[0].modelId).toBe("qwen3:8b");
  });

  it("truncates provider errors without echoing credentials", async () => {
    const baseUrl = await serve((_request, response) => {
      response.statusCode = 401;
      response.end(`denied top-secret-key ${"x".repeat(3000)}`);
    });

    await expect(
      discoverModels(provider({ baseUrl }), credential)
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ModelDiscoveryError);
      const message = (error as Error).message;
      expect(message).not.toContain("top-secret-key");
      expect(message.length).toBeLessThan(1400);
      return true;
    });
  });
});

describe("testProviderConnection", () => {
  it("verifies the configured message protocol with a real streamed turn", async () => {
    let requestedPath = "";
    let requestedBody = "";
    const baseUrl = await serve((request, response) => {
      requestedPath = request.url ?? "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        requestedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "keep-alive",
        });
        const base = {
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat-model",
        };
        response.write(
          `data: ${JSON.stringify({
            ...base,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
              },
            ],
          })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({
            ...base,
            choices: [
              {
                index: 0,
                delta: { content: "OK" },
                finish_reason: null,
              },
            ],
          })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({
            ...base,
            choices: [
              { index: 0, delta: {}, finish_reason: "stop" },
            ],
          })}\n\n`
        );
        response.end("data: [DONE]\n\n");
      });
    });

    const result = await testProviderConnection(
      provider({ baseUrl: `${baseUrl}/v1` }),
      credential,
      { modelId: "chat-model" }
    );

    expect(requestedPath).toBe("/v1/chat/completions");
    expect(JSON.parse(requestedBody)).toMatchObject({
      model: "chat-model",
      stream: true,
    });
    expect(result.message).toContain("流式消息成功");
  });

  it("reports a message-endpoint error instead of accepting catalog availability", async () => {
    const baseUrl = await serve((_request, response) => {
      response.statusCode = 404;
      response.end();
    });

    await expect(
      testProviderConnection(
        provider({ baseUrl: `${baseUrl}/v1` }),
        credential,
        { modelId: "chat-model" }
      )
    ).rejects.toThrow("404");
  });
});
