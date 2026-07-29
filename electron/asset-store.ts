import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MAILUO_HOME, workspaceDir } from "./pi";
import type { AssetRecord, AssetSource } from "../src/shared/assets";

const INDEX_PATH = path.join(MAILUO_HOME, "assets.json");

interface AssetIndex {
  version: 1;
  assets: AssetRecord[];
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", pdf: "application/pdf", html: "text/html",
  htm: "text/html", md: "text/markdown", txt: "text/plain", json: "application/json",
  csv: "text/csv", xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4",
  webm: "video/webm", mov: "video/quicktime", js: "text/javascript",
  ts: "text/typescript", tsx: "text/typescript", jsx: "text/javascript", css: "text/css",
};

export function inferMime(name: string): string {
  return MIME[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";
}

async function readIndex(): Promise<AssetIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(INDEX_PATH, "utf8")) as AssetIndex;
    return parsed.version === 1 && Array.isArray(parsed.assets)
      ? parsed
      : { version: 1, assets: [] };
  } catch {
    return { version: 1, assets: [] };
  }
}

async function writeIndex(index: AssetIndex): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  const temp = `${INDEX_PATH}.tmp`;
  await fs.writeFile(temp, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(temp, INDEX_PATH);
}

function safeProjectId(projectId: string): string {
  return projectId.replace(/[^\w-]/g, "");
}

function inProject(projectId: string, relativePath: string): string {
  const root = workspaceDir(safeProjectId(projectId));
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep)) throw new Error("资产路径越界");
  return resolved;
}

async function walk(root: string, relative = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (child === ".trash") continue;
      result.push(...(await walk(root, child)));
    } else if (entry.isFile()) {
      result.push(child);
    }
  }
  return result;
}

export async function listProjectAssets(projectId: string): Promise<AssetRecord[]> {
  const root = workspaceDir(safeProjectId(projectId));
  await fs.mkdir(root, { recursive: true });
  const index = await readIndex();
  const files = await walk(root);
  const known = new Map(
    index.assets
      .filter((asset) => asset.projectId === projectId)
      .map((asset) => [asset.relativePath, asset])
  );
  const fresh: AssetRecord[] = [];
  for (const relativePath of files) {
    const stat = await fs.stat(path.join(root, relativePath));
    const existing = known.get(relativePath);
    const source: AssetSource = relativePath.startsWith(`.attachments${path.sep}`)
      ? "attachment"
      : existing?.source ?? "ai";
    fresh.push({
      id: existing?.id ?? crypto.randomUUID(),
      projectId,
      name: path.basename(relativePath),
      relativePath,
      mimeType: inferMime(relativePath),
      size: stat.size,
      createdAt: stat.birthtimeMs || stat.ctimeMs,
      modifiedAt: stat.mtimeMs,
      source,
      tags: existing?.tags ?? [],
      favorite: existing?.favorite ?? false,
      trashed: false,
    });
  }
  const trashed = index.assets.filter(
    (asset) => asset.projectId === projectId && asset.trashed
  );
  index.assets = [
    ...index.assets.filter((asset) => asset.projectId !== projectId),
    ...fresh,
    ...trashed,
  ];
  await writeIndex(index);
  return [...fresh, ...trashed].sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function resolveAsset(projectId: string, assetId: string): Promise<{
  asset: AssetRecord;
  absolutePath: string;
}> {
  const assets = await listProjectAssets(projectId);
  const asset = assets.find((entry) => entry.id === assetId && !entry.trashed);
  if (!asset) throw new Error("资产不存在或已在回收站");
  return { asset, absolutePath: inProject(projectId, asset.relativePath) };
}

export async function updateAsset(
  projectId: string,
  assetId: string,
  patch: { name?: string; tags?: string[]; favorite?: boolean }
): Promise<AssetRecord> {
  const index = await readIndex();
  const asset = index.assets.find((entry) => entry.projectId === projectId && entry.id === assetId);
  if (!asset) throw new Error("资产不存在");
  if (patch.name && patch.name !== asset.name) {
    const safeName = path.basename(patch.name.trim());
    if (!safeName || safeName !== patch.name.trim()) throw new Error("文件名无效");
    const nextRelative = path.join(path.dirname(asset.relativePath), safeName);
    await fs.rename(inProject(projectId, asset.relativePath), inProject(projectId, nextRelative));
    asset.name = safeName;
    asset.relativePath = nextRelative;
    asset.mimeType = inferMime(safeName);
  }
  if (patch.tags) asset.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (typeof patch.favorite === "boolean") asset.favorite = patch.favorite;
  await writeIndex(index);
  return asset;
}

export async function trashAsset(projectId: string, assetId: string): Promise<void> {
  const index = await readIndex();
  const asset = index.assets.find((entry) => entry.projectId === projectId && entry.id === assetId);
  if (!asset || asset.trashed) throw new Error("资产不存在");
  const trashRelative = path.join(".trash", `${asset.id}-${asset.name}`);
  await fs.mkdir(path.dirname(inProject(projectId, trashRelative)), { recursive: true });
  await fs.rename(inProject(projectId, asset.relativePath), inProject(projectId, trashRelative));
  asset.trashed = true;
  await writeIndex(index);
}

export async function restoreAsset(projectId: string, assetId: string): Promise<void> {
  const index = await readIndex();
  const asset = index.assets.find((entry) => entry.projectId === projectId && entry.id === assetId);
  if (!asset || !asset.trashed) throw new Error("回收站中没有此资产");
  let nextRelative = path.join("restored", asset.name);
  await fs.mkdir(path.dirname(inProject(projectId, nextRelative)), { recursive: true });
  try {
    await fs.access(inProject(projectId, nextRelative));
    nextRelative = path.join("restored", `${Date.now()}-${asset.name}`);
  } catch {}
  const trashRelative = path.join(".trash", `${asset.id}-${asset.name}`);
  await fs.rename(inProject(projectId, trashRelative), inProject(projectId, nextRelative));
  asset.relativePath = nextRelative;
  asset.trashed = false;
  await writeIndex(index);
}

export async function importAssets(projectId: string, sourcePaths: string[]): Promise<void> {
  const root = workspaceDir(safeProjectId(projectId));
  const targetDir = path.join(root, "imports");
  await fs.mkdir(targetDir, { recursive: true });
  for (const source of sourcePaths) {
    const stat = await fs.stat(source);
    if (!stat.isFile()) continue;
    const base = path.basename(source);
    let target = path.join(targetDir, base);
    try {
      await fs.access(target);
      target = path.join(targetDir, `${Date.now()}-${base}`);
    } catch {}
    await fs.copyFile(source, target);
  }
  const assets = await listProjectAssets(projectId);
  const index = await readIndex();
  for (const asset of assets) {
    if (asset.relativePath.startsWith(`imports${path.sep}`)) {
      const stored = index.assets.find((entry) => entry.id === asset.id);
      if (stored) stored.source = "import";
    }
  }
  await writeIndex(index);
}

export async function emptyAssetTrash(projectId: string): Promise<void> {
  const root = workspaceDir(safeProjectId(projectId));
  await fs.rm(path.join(root, ".trash"), { recursive: true, force: true });
  const index = await readIndex();
  index.assets = index.assets.filter(
    (asset) => asset.projectId !== projectId || !asset.trashed
  );
  await writeIndex(index);
}
