import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiConfigStore } from "./ai-config-store";
import {
  parsePiCatalogHtml,
  parseSkillsFindOutput,
  parseSkillsListOutput,
  PiResourcesManager,
} from "./pi-resources";
import { createDefaultAiConfig } from "../src/shared/ai-config";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mailuo-pi-resources-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resource catalog parsers", () => {
  it("parses extension packages from the pi.dev server-rendered catalog", () => {
    const result = parsePiCatalogHtml(`
      <article data-package-card="true" data-package-name="@acme/pi-tools" data-package-types="extension skill" data-package-downloads="4200" data-package-path="/packages/@acme/pi-tools">
        <p class="packages-desc">Tools &amp; helpers.</p>
        <div class="packages-meta"><span>Acme</span><span>4.2K/mo</span></div>
        <a href="https://www.npmjs.com/package/@acme/pi-tools">npm</a>
        <a href="https://github.com/acme/pi-tools">repo</a>
        <a href="https://github.com/earendil-works/pi/issues/new?package-version=1.2.3&amp;package-name=x">report</a>
      </article>
      <article data-package-card="true" data-package-name="skill-only" data-package-types="skill" data-package-downloads="9"></article>
    `);

    expect(result).toEqual([expect.objectContaining({
      name: "@acme/pi-tools",
      source: "npm:@acme/pi-tools",
      description: "Tools & helpers.",
      author: "Acme",
      version: "1.2.3",
      downloads: 4200,
    })]);
  });

  it("parses skills.sh find and repository preview output", () => {
    const found = parseSkillsFindOutput(`
      \u001b[32mvercel-labs/agent-skills@vercel-react-best-practices\u001b[0m \u001b[36m616.4K installs\u001b[0m
      \u001b[32m└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices\u001b[0m
    `);
    const listed = parseSkillsListOutput(`
◇  Available Skills
│
│    vercel-react-best-practices
│
│      React and Next.js performance guidelines.
    `);

    expect(found).toEqual([expect.objectContaining({
      source: "vercel-labs/agent-skills",
      name: "vercel-react-best-practices",
      installs: 616400,
    })]);
    expect(listed).toEqual([{
      name: "vercel-react-best-practices",
      description: "React and Next.js performance guidelines.",
    }]);
  });
});

describe("PiResourcesManager", () => {
  it("discovers explicit extension and skill paths with stable ids", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const extensionDir = path.join(root, "extensions");
    const skillsDir = path.join(root, "skills");
    const skillDir = path.join(skillsDir, "review");
    await mkdir(extensionDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(extensionDir, "logger.ts"),
      "export default function () {}\n",
      "utf8"
    );
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: review\ndescription: Review code carefully.\n---\n\n# Review\n",
      "utf8"
    );

    const config = createDefaultAiConfig();
    config.pi.extensionPaths.push({
      path: extensionDir,
      enabled: true,
      sourceKind: "terminal",
    });
    config.pi.skillPaths.push({
      path: skillsDir,
      enabled: true,
      sourceKind: "local",
    });
    const manager = new PiResourcesManager(store);

    const first = await manager.discover(config);
    const second = await manager.discover(config);

    expect(first.extensions).toHaveLength(1);
    expect(first.extensions[0].name).toBe("logger.ts");
    expect(first.extensions[0].sourceKind).toBe("terminal");
    expect(first.skills).toHaveLength(1);
    expect(first.skills[0].name).toBe("review");
    expect(first.skills[0].description).toBe("Review code carefully.");
    expect(first.extensions[0].id).toBe(second.extensions[0].id);
    expect(first.skills[0].id).toBe(second.skills[0].id);
  });

  it("rejects package sources that could be mistaken for shell input", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const manager = new PiResourcesManager(store);

    await expect(manager.installPackage(createDefaultAiConfig(), "bash -c whoami")).rejects.toThrow(
      "只允许 npm、git、HTTP(S)、SSH 或本地路径形式"
    );
  });

  it("keeps disabled paths visible without enabling their resources", async () => {
    const root = await tempRoot();
    const store = new AiConfigStore(root);
    const skillsDir = path.join(root, "skills");
    await mkdir(path.join(skillsDir, "disabled"), { recursive: true });
    await writeFile(
      path.join(skillsDir, "disabled", "SKILL.md"),
      "---\nname: disabled\ndescription: Disabled skill.\n---\n",
      "utf8"
    );
    const config = createDefaultAiConfig();
    config.pi.skillPaths.push({
      path: skillsDir,
      enabled: false,
      sourceKind: "local",
    });

    const snapshot = await new PiResourcesManager(store).discover(config);

    expect(snapshot.paths[0].enabled).toBe(false);
    expect(snapshot.skills[0].enabled).toBe(false);
  });
});
