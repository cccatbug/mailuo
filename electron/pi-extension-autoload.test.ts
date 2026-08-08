import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

describe("Pi extension autoload", () => {
  it("lets Pi activate tools registered during session_start without an allowlist", async () => {
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{
        name: "dynamic-tool-fixture",
        factory(pi) {
          pi.on("session_start", () => {
            pi.registerTool({
              name: "dynamic_search",
              label: "Dynamic Search",
              description: "Registered by Pi after session creation",
              parameters: Type.Object({}),
              async execute() {
                return {
                  content: [{ type: "text", text: "ok" }],
                  details: {},
                };
              },
            });
          });
        },
      }],
    });
    await resourceLoader.reload();
    // Deliberately omit `tools`: a defined array becomes Pi's permanent allowlist.
    const { session } = await createAgentSession({
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(process.cwd()),
    });

    try {
      await session.bindExtensions({ mode: "print" });
      expect(session.getAllTools().map((tool) => tool.name)).toContain("dynamic_search");
      expect(session.getActiveToolNames()).toContain("dynamic_search");
    } finally {
      session.dispose();
    }
  });
});
