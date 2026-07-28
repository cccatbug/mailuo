import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AiConfigStore,
  AiConfigValidationError,
  AiConfigWriteConflictError,
  MailuoCredentialStore,
} from "./ai-config-store";
import {
  createDefaultAiConfig,
  runtimeProviderId,
  type AiConfigV1,
} from "../src/shared/ai-config";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mailuo-ai-config-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("AiConfigStore", () => {
  it("returns an unconfigured V1 document with built-in context profiles when config.json is missing", async () => {
    const store = new AiConfigStore(await tempRoot());

    const snapshot = await store.load();

    expect(snapshot.etag).toBeNull();
    expect(snapshot.config.version).toBe(1);
    expect(snapshot.config.providers).toEqual([]);
    expect(snapshot.config.contextProfiles.map((profile) => profile.name)).toEqual([
      "助手完整",
      "任务精简",
    ]);
  });

  it("rejects stale etags instead of overwriting an externally edited file", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const initial = await store.save(createDefaultAiConfig(), null);
    const file = path.join(root, "config.json");
    await writeFile(file, `${await readFile(file, "utf8")}\n`, "utf8");

    await expect(store.save(initial.config, initial.etag)).rejects.toBeInstanceOf(
      AiConfigWriteConflictError
    );
  });

  it("rejects broken route references without replacing the last valid file", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const initial = await store.save(createDefaultAiConfig(), null);
    const invalid = structuredClone(initial.config) as AiConfigV1;
    invalid.routes.assistant.model = {
      providerId: "a9173512-b61c-4b13-bfe2-f42ea09575e1",
      modelId: "missing",
    };

    await expect(store.save(invalid, initial.etag)).rejects.toBeInstanceOf(
      AiConfigValidationError
    );
    expect(JSON.parse(await readFile(path.join(root, "config.json"), "utf8"))).toEqual(
      initial.config
    );
  });

  it("surfaces bad JSON and unknown versions without replacing the file", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const file = path.join(root, "config.json");
    await writeFile(file, '{"version":2}', "utf8");

    await expect(store.load()).rejects.toBeInstanceOf(AiConfigValidationError);
    expect(await readFile(file, "utf8")).toBe('{"version":2}');

    await writeFile(file, "{broken", "utf8");
    await expect(store.load()).rejects.toBeInstanceOf(AiConfigValidationError);
    expect(await readFile(file, "utf8")).toBe("{broken");
  });

  it("rejects known sensitive headers from config.json", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const config = createDefaultAiConfig();
    config.providers.push({
      id: "a9173512-b61c-4b13-bfe2-f42ea09575e1",
      name: "Unsafe",
      preset: "custom",
      enabled: true,
      baseUrl: "https://example.com/v1",
      api: "openai-completions",
      authMode: "none",
      authHeader: false,
      headers: { Authorization: "Bearer must-not-be-persisted" },
      secretHeaderNames: [],
      discovery: { adapter: "manual" },
    });

    await expect(store.save(config, null)).rejects.toThrow(
      "必须保存到 auth.json"
    );
  });

  it("normalizes pre-release V1 compat keys without reading external config", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const config = createDefaultAiConfig() as unknown as Record<string, unknown>;
    const providerId = "a9173512-b61c-4b13-bfe2-f42ea09575e1";
    config.providers = [
      {
        id: providerId,
        name: "Legacy",
        preset: "custom",
        enabled: true,
        baseUrl: "https://example.com/v1",
        api: "openai-responses",
        authMode: "none",
        authHeader: false,
        headers: {},
        secretHeaderNames: [],
        discovery: { adapter: "manual" },
        compat: {
          openai: {
            supportsDeveloperRole: true,
            supportsReasoningEffort: true,
          },
        },
      },
    ];
    await writeFile(
      path.join(root, "config.json"),
      JSON.stringify(config),
      "utf8"
    );

    const loaded = await store.load();
    expect(loaded.config.providers[0].compat).toEqual({
      openaiResponses: { supportsDeveloperRole: true },
    });
  });
});

describe("MailuoCredentialStore", () => {
  it("stores only pi-compatible credentials in auth.json with 0600 permissions", async () => {
    const root = await tempRoot();
    const credentials = new MailuoCredentialStore(path.join(root, "auth.json"));
    const providerId = runtimeProviderId(
      "a9173512-b61c-4b13-bfe2-f42ea09575e1"
    );

    await credentials.modify(providerId, async () => ({
      type: "api_key",
      key: "secret-key",
      env: { MAILUO_HEADER_X_GATEWAY_KEY: "header-secret" },
    }));

    const file = path.join(root, "auth.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      [providerId]: {
        type: "api_key",
        key: "secret-key",
        env: { MAILUO_HEADER_X_GATEWAY_KEY: "header-secret" },
      },
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await credentials.list()).toEqual([
      { providerId, type: "api_key" },
    ]);
  });

  it("repairs permissive auth.json permissions when loading existing credentials", async () => {
    const root = await tempRoot();
    const file = path.join(root, "auth.json");
    await writeFile(
      file,
      '{"mailuo-provider":{"type":"api_key","key":"secret"}}',
      { encoding: "utf8", mode: 0o644 }
    );
    await (await import("node:fs/promises")).chmod(file, 0o644);

    const credentials = new MailuoCredentialStore(file);
    expect(await credentials.read("mailuo-provider")).toEqual({
      type: "api_key",
      key: "secret",
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
