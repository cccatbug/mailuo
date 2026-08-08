import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, promises as fs, statSync } from "node:fs";
import path from "node:path";
import {
  DefaultPackageManager,
  loadSkills,
  type PackageManager,
  type ResolvedPaths,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type { AiConfigV1, AiPiPathConfig } from "../src/shared/ai-config";
import type {
  PiExtensionCatalogItem,
  PiExtensionResource,
  PiPackagePreview,
  PiPackageResource,
  PiResourceDiagnostic,
  PiResourcePathSummary,
  PiResourceProgressEvent,
  PiResourcesSnapshot,
  PiSkillResource,
  SkillsShCatalogItem,
  SkillsShCommandResult,
  SkillsShListResult,
} from "../src/shared/pi-resources";
import { AiConfigStore } from "./ai-config-store";

function stableId(kind: string, source: string, resourcePath: string): string {
  return createHash("sha256")
    .update(`${kind}\0${source}\0${path.resolve(resourcePath)}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizePath(value: string, cwd: string): string {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value));
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function extensionFiles(resourcePath: string): Promise<string[]> {
  try {
    const stat = await fs.stat(resourcePath);
    if (stat.isFile()) return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(resourcePath) ? [resourcePath] : [];
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const out: string[] = [];
  const entries = await fs.readdir(resourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(resourcePath, entry.name);
    if (entry.isDirectory()) out.push(...await extensionFiles(child));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) out.push(child);
  }
  return out;
}

async function readPackageInfo(
  installedPath: string | undefined
): Promise<{ installed: boolean; version?: string }> {
  if (!installedPath) return { installed: false };
  try {
    const raw = await fs.readFile(path.join(installedPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return {
      installed: true,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch (error) {
    if (isMissing(error)) return { installed: false };
    return { installed: await exists(installedPath) };
  }
}

function toDiagnostic(
  error: unknown,
  type: PiResourceDiagnostic["type"] = "error",
  resourcePath?: string
): PiResourceDiagnostic {
  return {
    type,
    message: error instanceof Error ? error.message : String(error),
    ...(resourcePath ? { path: resourcePath } : {}),
  };
}

function skillFilePath(resourcePath: string): string {
  try {
    const stat = statSync(resourcePath);
    if (stat.isDirectory()) {
      const candidate = path.join(resourcePath, "SKILL.md");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Diagnostics are emitted by loadSkills for invalid paths.
  }
  return resourcePath;
}

function packageSourceFor(
  source: string,
  packageSources: Map<string, AiConfigV1["pi"]["packages"][number]>
): AiConfigV1["pi"]["packages"][number] | undefined {
  return packageSources.get(source);
}

function packageInstalledPath(
  manager: PackageManager,
  source: string
): string | undefined {
  try {
    return manager.getInstalledPath(source, "user");
  } catch {
    return undefined;
  }
}

const MAX_CLI_OUTPUT = 64 * 1024;
const SKILLS_CLI_TIMEOUT_MS = 120_000;
const CATALOG_TIMEOUT_MS = 15_000;

function clipOutput(value: string): string {
  return value.length > MAX_CLI_OUTPUT
    ? `${value.slice(0, MAX_CLI_OUTPUT)}\n…（输出已截断）`
    : value;
}

function validateCliSource(source: string): string {
  const value = source.trim();
  if (!value) throw new Error("source 不能为空");
  if (value.length > 2_000 || /[\u0000\r\n]/.test(value)) {
    throw new Error("source 格式无效");
  }
  return value;
}

function validatePackageSource(source: string): string {
  const value = validateCliSource(source);
  const allowed =
    path.isAbsolute(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.startsWith("npm:") ||
    value.startsWith("git:") ||
    value.startsWith("git@") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("ssh://");
  if (!allowed) {
    throw new Error("只允许 npm、git、HTTP(S)、SSH 或本地路径形式的 pi package source");
  }
  return value;
}

function validateSearchQuery(query: string): string {
  const value = query.trim();
  if (value.length < 2) throw new Error("搜索词至少需要 2 个字符");
  if (value.length > 200 || /[\u0000\r\n]/.test(value)) {
    throw new Error("搜索词格式无效");
  }
  return value;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function htmlAttribute(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeHtml(match[1]) : undefined;
}

/** Parse the server-rendered pi.dev catalog so search does not depend on private APIs. */
export function parsePiCatalogHtml(html: string): PiExtensionCatalogItem[] {
  const articles = html.match(/<article\b[^>]*data-package-card="true"[\s\S]*?<\/article>/gi) ?? [];
  return articles.flatMap((article) => {
    const name = htmlAttribute(article, "data-package-name");
    const types = htmlAttribute(article, "data-package-types")?.split(/\s+/) ?? [];
    if (!name || !types.includes("extension")) return [];
    const description = htmlText(
      article.match(/<p\b[^>]*class="[^"]*packages-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""
    );
    const author = htmlText(
      article.match(/<div\b[^>]*class="[^"]*packages-meta[^"]*"[^>]*>\s*<span>([\s\S]*?)<\/span>/i)?.[1] ?? ""
    );
    const packagePath = htmlAttribute(article, "data-package-path") ?? `/packages/${name}`;
    const versionMatch = article.match(/package-version=([^&"\s]+)/i);
    const npmUrl = article.match(/href="(https:\/\/www\.npmjs\.com\/package\/[^"]+)"/i)?.[1];
    const repositoryUrl = article.match(/href="(https:\/\/github\.com\/[^"]+)"/i)?.[1];
    return [{
      name,
      source: `npm:${name}`,
      description,
      ...(author ? { author } : {}),
      ...(versionMatch ? { version: decodeURIComponent(decodeHtml(versionMatch[1])) } : {}),
      downloads: Number(htmlAttribute(article, "data-package-downloads")) || 0,
      packageUrl: new URL(packagePath, "https://pi.dev").toString(),
      ...(npmUrl ? { npmUrl: decodeHtml(npmUrl) } : {}),
      ...(repositoryUrl ? { repositoryUrl: decodeHtml(repositoryUrl) } : {}),
    }];
  });
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n")
    .replace(/\u0007/g, "");
}

function installsFromLabel(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return 0;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    (match[2] ?? "").toUpperCase()
  ] ?? 1;
  return Math.round(Number(match[1]) * multiplier);
}

export function parseSkillsFindOutput(output: string): SkillsShCatalogItem[] {
  const lines = stripAnsi(output).split("\n").map((line) => line.trim()).filter(Boolean);
  const results: SkillsShCatalogItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([^\s/]+\/[^\s@]+)@(\S+)\s+([\d.]+\s*[KMB]?) installs$/i);
    if (!match) continue;
    const source = match[1];
    const name = match[2];
    const installsLabel = match[3].replace(/\s+/g, "");
    const urlLine = lines[index + 1]?.replace(/^└\s*/, "");
    results.push({
      id: `${source}@${name}`,
      name,
      source,
      installs: installsFromLabel(installsLabel),
      installsLabel,
      url: urlLine?.startsWith("https://skills.sh/")
        ? urlLine
        : `https://skills.sh/${source}/${name}`,
    });
  }
  return results;
}

export function parseSkillsListOutput(
  output: string
): Array<{ name: string; description?: string }> {
  const lines = stripAnsi(output).split("\n");
  const skills: Array<{ name: string; description?: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^│\s{4}(\S[^\s]*)\s*$/);
    if (!match) continue;
    const description = lines[index + 2]?.match(/^│\s{6}(.+?)\s*$/)?.[1]?.trim();
    skills.push({ name: match[1], ...(description ? { description } : {}) });
  }
  return skills;
}

function npmPackageName(source: string): { name: string; version: string } | null {
  if (!source.startsWith("npm:")) return null;
  const spec = source.slice(4);
  const separator = spec.startsWith("@")
    ? spec.lastIndexOf("@") > spec.indexOf("/") ? spec.lastIndexOf("@") : -1
    : spec.lastIndexOf("@");
  return separator > 0
    ? { name: spec.slice(0, separator), version: spec.slice(separator + 1) || "latest" }
    : { name: spec, version: "latest" };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function catalogFetch(url: URL, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      accept,
      "user-agent": "Mailuo-Pi-Resources/1.0",
    },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`资源目录请求失败（HTTP ${response.status}）`);
  }
  return response;
}

function repositoryUrl(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object" && "url" in value && typeof value.url === "string"
      ? value.url
      : undefined;
  return raw?.replace(/^git\+/, "").replace(/\.git$/, "");
}

function authorName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value && typeof value.name === "string") {
    return value.name;
  }
  return undefined;
}

function skillFromResult(
  result: ReturnType<typeof loadSkills>,
  requestedPath: string
): Skill | undefined {
  return result.skills.find((skill) =>
    path.resolve(skill.filePath) === path.resolve(requestedPath) ||
    path.resolve(skill.baseDir) === path.resolve(requestedPath)
  ) ?? result.skills[0];
}

export class PiResourcesManager {
  private readonly activeProcesses = new Set<ChildProcess>();
  private readonly progressListeners = new Set<
    (event: PiResourceProgressEvent) => void
  >();

  constructor(readonly store: AiConfigStore = new AiConfigStore()) {}

  onProgress(listener: (event: PiResourceProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  createPackageManager(config: AiConfigV1): PackageManager {
    const settingsManager = SettingsManager.inMemory({
      packages: config.pi.packages.map((entry) => entry.source),
    });
    const manager = new DefaultPackageManager({
      cwd: this.store.root,
      agentDir: this.store.packagesDir,
      settingsManager,
    });
    manager.setProgressCallback((event) => {
      for (const listener of this.progressListeners) listener(event);
    });
    return manager;
  }

  async searchPiExtensions(query: string): Promise<PiExtensionCatalogItem[]> {
    const normalized = validateSearchQuery(query);
    const url = new URL("https://pi.dev/packages");
    url.searchParams.set("name", normalized);
    url.searchParams.set("type", "extension");
    url.searchParams.set("sort", "downloads");
    const response = await catalogFetch(url, "text/html");
    return parsePiCatalogHtml(await response.text());
  }

  async previewPackage(source: string): Promise<PiPackagePreview> {
    const normalized = validatePackageSource(source);
    const npmSpec = npmPackageName(normalized);
    if (!npmSpec) {
      return {
        source: normalized,
        name: normalized,
        extensions: [],
        skills: [],
      };
    }
    const url = new URL(
      `${encodeURIComponent(npmSpec.name)}/${encodeURIComponent(npmSpec.version)}`,
      "https://registry.npmjs.org/"
    );
    const response = await catalogFetch(url, "application/json");
    const manifest = await response.json() as {
      name?: unknown;
      version?: unknown;
      description?: unknown;
      author?: unknown;
      license?: unknown;
      homepage?: unknown;
      repository?: unknown;
      pi?: { extensions?: unknown; skills?: unknown };
    };
    return {
      source: normalized,
      name: typeof manifest.name === "string" ? manifest.name : npmSpec.name,
      ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
      ...(typeof manifest.description === "string" ? { description: manifest.description } : {}),
      ...(authorName(manifest.author) ? { author: authorName(manifest.author) } : {}),
      ...(typeof manifest.license === "string" ? { license: manifest.license } : {}),
      ...(typeof manifest.homepage === "string" ? { homepage: manifest.homepage } : {}),
      ...(repositoryUrl(manifest.repository) ? { repositoryUrl: repositoryUrl(manifest.repository) } : {}),
      extensions: stringArray(manifest.pi?.extensions),
      skills: stringArray(manifest.pi?.skills),
    };
  }

  async installPackage(config: AiConfigV1, source: string): Promise<string | undefined> {
    const normalized = validatePackageSource(source);
    const manager = this.createPackageManager(config);
    await manager.install(normalized);
    return packageInstalledPath(manager, normalized);
  }

  async removePackage(config: AiConfigV1, source: string): Promise<void> {
    const normalized = validatePackageSource(source);
    const manager = this.createPackageManager(config);
    await manager.remove(normalized);
  }

  async updatePackage(config: AiConfigV1, source?: string): Promise<void> {
    const manager = this.createPackageManager(config);
    await manager.update(source ? validatePackageSource(source) : undefined);
  }

  cancel(): void {
    for (const child of this.activeProcesses) child.kill("SIGTERM");
  }

  private runSkillsCli(
    args: string[],
    cwd: string
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    return new Promise((resolve, reject) => {
      const child = spawn(command, ["--yes", "skills", ...args], {
        cwd,
        env: { ...process.env, CI: "1" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.activeProcesses.add(child);
      const cleanup = () => this.activeProcesses.delete(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const next = target === "stdout" ? stdout + chunk.toString() : stderr + chunk.toString();
        if (target === "stdout") stdout = next.slice(0, MAX_CLI_OUTPUT);
        else stderr = next.slice(0, MAX_CLI_OUTPUT);
      };
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGTERM");
        settled = true;
        cleanup();
        reject(new Error(`skills CLI 超时（${SKILLS_CLI_TIMEOUT_MS / 1000}s）`));
      }, SKILLS_CLI_TIMEOUT_MS);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ code: code ?? 1, stdout: clipOutput(stdout), stderr: clipOutput(stderr) });
      });
    });
  }

  private skillsShRoot(id: string): string {
    const root = path.resolve(this.store.skillsShDir, id);
    const parent = path.resolve(this.store.skillsShDir);
    if (root !== parent && !root.startsWith(`${parent}${path.sep}`)) {
      throw new Error("skills.sh 安装目录越界");
    }
    return root;
  }

  private async findSkillsShPath(root: string): Promise<string | undefined> {
    const candidates = [
      path.join(root, ".pi", "skills"),
      path.join(root, ".agents", "skills"),
      path.join(root, "skills"),
    ];
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        const result = loadSkills({
          cwd: root,
          agentDir: root,
          skillPaths: [candidate],
          includeDefaults: false,
        });
        if (result.skills.length > 0) return candidate;
      }
    }
    return undefined;
  }

  async searchSkillsSh(query: string): Promise<SkillsShCatalogItem[]> {
    const normalized = validateSearchQuery(query);
    const result = await this.runSkillsCli(["find", normalized], this.store.skillsShDir);
    if (result.code !== 0) {
      throw new Error(
        `skills.sh 搜索失败（退出码 ${result.code}）：${result.stderr || result.stdout}`
      );
    }
    return parseSkillsFindOutput(`${result.stdout}\n${result.stderr}`);
  }

  async listSkillsSh(source: string): Promise<SkillsShListResult> {
    const normalized = validateCliSource(source);
    const result = await this.runSkillsCli(["add", normalized, "--list"], this.store.skillsShDir);
    if (result.code !== 0) {
      throw new Error(
        `skills.sh 预览失败（退出码 ${result.code}）：${result.stderr || result.stdout}`
      );
    }
    return {
      source: normalized,
      skills: parseSkillsListOutput(`${result.stdout}\n${result.stderr}`),
      output: result.stdout,
      ...(result.stderr ? { stderr: result.stderr } : {}),
    };
  }

  async installSkillsSh(
    source: string,
    skillNames: string[] = []
  ): Promise<SkillsShCommandResult & { install: { id: string; source: string; skillNames: string[]; root: string; createdAt: number } }> {
    const normalized = validateCliSource(source);
    const names = [...new Set(skillNames.map((name) => name.trim()).filter(Boolean))];
    if (names.some((name) => name.length > 200 || /[\u0000\r\n]/.test(name))) {
      throw new Error("skill 名称格式无效");
    }
    const id = stableId("skills-sh", normalized, names.join("\0") || "*");
    const root = this.skillsShRoot(id);
    await fs.mkdir(root, { recursive: true });
    const args = ["add", normalized, "--agent", "pi", "--copy", "--yes"];
    for (const name of names) args.push("--skill", name);
    const result = await this.runSkillsCli(args, root);
    if (result.code !== 0) {
      throw new Error(
        `skills.sh 安装失败（退出码 ${result.code}）：${result.stderr || result.stdout}`
      );
    }
    const skillPath = await this.findSkillsShPath(root);
    if (!skillPath) {
      throw new Error(`安装完成但没有发现 SKILL.md：${root}`);
    }
    const install = {
      id,
      source: normalized,
      skillNames: names,
      root,
      createdAt: Date.now(),
    };
    return {
      installId: id,
      root,
      skillPath,
      stdout: result.stdout,
      stderr: result.stderr,
      install,
    };
  }

  async updateSkillsSh(
    root: string,
    skillNames: string[] = []
  ): Promise<SkillsShCommandResult> {
    const resolvedRoot = path.resolve(root);
    const parent = path.resolve(this.store.skillsShDir);
    if (!resolvedRoot.startsWith(`${parent}${path.sep}`)) {
      throw new Error("只允许更新应用管理的 skills.sh 目录");
    }
    const args = ["update", ...skillNames.filter(Boolean), "--yes"];
    const result = await this.runSkillsCli(args, resolvedRoot);
    if (result.code !== 0) {
      throw new Error(`skills.sh 更新失败（退出码 ${result.code}）：${result.stderr || result.stdout}`);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async removeSkillsSh(root: string, skillNames: string[] = []): Promise<SkillsShCommandResult> {
    const resolvedRoot = path.resolve(root);
    const parent = path.resolve(this.store.skillsShDir);
    if (!resolvedRoot.startsWith(`${parent}${path.sep}`)) {
      throw new Error("只允许删除应用管理的 skills.sh 目录");
    }
    const args = skillNames.length
      ? ["remove", ...skillNames, "--agent", "pi", "--yes"]
      : ["remove", "--all"];
    const result = await this.runSkillsCli(args, resolvedRoot);
    if (result.code !== 0) {
      throw new Error(`skills.sh 删除失败（退出码 ${result.code}）：${result.stderr || result.stdout}`);
    }
    await fs.rm(resolvedRoot, { recursive: true, force: true });
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async discover(config: AiConfigV1): Promise<PiResourcesSnapshot> {
    await this.store.ensureDirectories();
    const manager = this.createPackageManager(config);
    const packageSources = new Map(
      config.pi.packages.map((entry) => [entry.source, entry] as const)
    );
    const diagnostics: PiResourceDiagnostic[] = [];
    const extensions: PiExtensionResource[] = [];
    const skills: PiSkillResource[] = [];
    const pathSummaries = new Map<string, PiResourcePathSummary>();

    let resolved: ResolvedPaths = {
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };
    try {
      // Discovery must never install an unconfirmed package as a side effect.
      resolved = await manager.resolve(async () => "skip");
    } catch (error) {
      diagnostics.push(toDiagnostic(error));
    }

    const addExtension = async (input: {
      resourcePath: string;
      source: string;
      sourceKind: PiExtensionResource["sourceKind"];
      packageSource?: string;
      pathConfig?: AiPiPathConfig;
    }) => {
      const resourcePath = normalizePath(input.resourcePath, this.store.root);
      const packageConfig = input.packageSource
        ? packageSourceFor(input.packageSource, packageSources)
        : undefined;
      const installedPath = input.packageSource
        ? packageInstalledPath(manager, input.packageSource)
        : undefined;
      const info = await readPackageInfo(installedPath);
      const id = stableId("extension", input.source, resourcePath);
      if (extensions.some((entry) => entry.id === id)) return;
      extensions.push({
        id,
        kind: "extension",
        name: path.basename(resourcePath),
        path: resourcePath,
        source: input.source,
        sourceKind: input.sourceKind,
        ...(input.packageSource ? { packageSource: input.packageSource } : {}),
        ...(installedPath ? { packageInstalledPath: installedPath } : {}),
        ...(info.version ? { version: info.version } : {}),
        enabled:
          (packageConfig?.enabled ?? input.pathConfig?.enabled ?? true) &&
          config.pi.extensionOverrides[id] !== false,
        diagnostics: [],
      });
    };

    const addSkill = async (input: {
      resourcePath: string;
      source: string;
      sourceKind: PiSkillResource["sourceKind"];
      packageSource?: string;
      pathConfig?: AiPiPathConfig;
    }) => {
      const requestedPath = normalizePath(input.resourcePath, this.store.root);
      const filePath = skillFilePath(requestedPath);
      const packageConfig = input.packageSource
        ? packageSourceFor(input.packageSource, packageSources)
        : undefined;
      const installedPath = input.packageSource
        ? packageInstalledPath(manager, input.packageSource)
        : undefined;
      const info = await readPackageInfo(installedPath);
      let result: ReturnType<typeof loadSkills>;
      try {
        result = loadSkills({
          cwd: this.store.root,
          agentDir: this.store.root,
          skillPaths: [filePath],
          includeDefaults: false,
        });
      } catch (error) {
        diagnostics.push(toDiagnostic(error, "error", filePath));
        return;
      }
      const skill = skillFromResult(result, filePath);
      if (!skill) {
        for (const diagnostic of result.diagnostics) {
          diagnostics.push({
            type: diagnostic.type === "error" ? "error" : "warning",
            message: diagnostic.message,
            path: diagnostic.path,
          });
        }
        return;
      }
      const id = stableId("skill", input.source, skill.filePath);
      if (skills.some((entry) => entry.id === id)) return;
      const profileIds = config.pi.skillProfileIds[id];
      skills.push({
        id,
        kind: "skill",
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        source: input.source,
        sourceKind: input.sourceKind,
        ...(input.packageSource ? { packageSource: input.packageSource } : {}),
        ...(installedPath ? { packageInstalledPath: installedPath } : {}),
        ...(info.version ? { version: info.version } : {}),
        enabled: packageConfig?.enabled ?? input.pathConfig?.enabled ?? true,
        profileIds: profileIds === undefined ? null : profileIds,
        diagnostics: result.diagnostics.map((diagnostic) => ({
          type: diagnostic.type === "error" ? "error" : "warning",
          message: diagnostic.message,
          path: diagnostic.path,
        })),
      });
    };

    for (const resource of resolved.extensions) {
      if (!resource.enabled) continue;
      const packageConfig = packageSourceFor(resource.metadata.source, packageSources);
      if (!packageConfig) continue;
      for (const extensionPath of await extensionFiles(resource.path)) {
        await addExtension({
          resourcePath: extensionPath,
          source: resource.metadata.source,
          sourceKind: "package",
          packageSource: resource.metadata.source,
        });
      }
    }
    for (const resource of resolved.skills) {
      if (!resource.enabled) continue;
      const packageConfig = packageSourceFor(resource.metadata.source, packageSources);
      if (!packageConfig) continue;
      await addSkill({
        resourcePath: resource.path,
        source: resource.metadata.source,
        sourceKind: "package",
        packageSource: resource.metadata.source,
      });
    }

    for (const entry of config.pi.extensionPaths) {
      const source = normalizePath(entry.path, this.store.root);
      try {
        const local = await manager.resolveExtensionSources([source], {
          temporary: true,
        });
        const before = extensions.length;
        for (const resource of local.extensions) {
          if (!resource.enabled) continue;
          for (const extensionPath of await extensionFiles(resource.path)) {
            await addExtension({
              resourcePath: extensionPath,
              source,
              sourceKind: entry.sourceKind,
              pathConfig: entry,
            });
          }
        }
        pathSummaries.set(`extension:${source}`, {
          path: source,
          kind: "extension",
          sourceKind: entry.sourceKind,
          enabled: entry.enabled,
          resourceCount: extensions.length - before,
          diagnostics: [],
        });
      } catch (error) {
        const diagnostic = toDiagnostic(error, "error", source);
        diagnostics.push(diagnostic);
        pathSummaries.set(`extension:${source}`, {
          path: source,
          kind: "extension",
          sourceKind: entry.sourceKind,
          enabled: entry.enabled,
          resourceCount: 0,
          diagnostics: [diagnostic],
        });
      }
    }

    for (const entry of config.pi.skillPaths) {
      const source = normalizePath(entry.path, this.store.root);
      const before = skills.length;
      const localResult = loadSkills({
        cwd: this.store.root,
        agentDir: this.store.root,
        skillPaths: [source],
        includeDefaults: false,
      });
      for (const diagnostic of localResult.diagnostics) {
        diagnostics.push({
          type: diagnostic.type === "error" ? "error" : "warning",
          message: diagnostic.message,
          path: diagnostic.path,
        });
      }
      for (const skill of localResult.skills) {
        await addSkill({
          resourcePath: skill.filePath,
          source,
          sourceKind: entry.sourceKind,
          pathConfig: entry,
        });
      }
      pathSummaries.set(`skill:${source}`, {
        path: source,
        kind: "skill",
        sourceKind: entry.sourceKind,
        enabled: entry.enabled,
        resourceCount: skills.length - before,
        diagnostics: localResult.diagnostics.map((item) => ({
          type: item.type === "error" ? "error" : "warning",
          message: item.message,
          path: item.path,
        })),
      });
    }

    const packages: PiPackageResource[] = await Promise.all(
      config.pi.packages.map(async (entry) => {
        const installedPath =
          entry.installedPath || packageInstalledPath(manager, entry.source);
        const info = await readPackageInfo(installedPath);
        const packageExtensions = extensions.filter(
          (resource) => resource.packageSource === entry.source
        ).length;
        const packageSkills = skills.filter(
          (resource) => resource.packageSource === entry.source
        ).length;
        const packageDiagnostics: PiResourceDiagnostic[] = [];
        if (!info.installed) {
          packageDiagnostics.push({
            type: "warning",
            message: "Package 尚未安装或安装目录已不存在",
          });
        }
        return {
          source: entry.source,
          enabled: entry.enabled,
          installed: info.installed,
          ...(installedPath ? { installedPath } : {}),
          ...(info.version ? { version: info.version } : {}),
          resources: { extensions: packageExtensions, skills: packageSkills },
          diagnostics: packageDiagnostics,
        };
      })
    );

    return {
      packages,
      extensions,
      skills,
      paths: [...pathSummaries.values()],
      diagnostics,
      skillsShInstalls: config.pi.skillsSh.installs,
      generatedAt: Date.now(),
    };
  }
}

export const PI_RESOURCES = new PiResourcesManager();
