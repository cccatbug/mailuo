import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MAILUO_HOME, workspaceDir } from "./pi";
import type {
  AssetLibrarySnapshot,
  AssetRecord,
  AssetSource,
  AssetTagMode,
  AssetTagRecord,
} from "../src/shared/assets";

const INDEX_PATH = path.join(MAILUO_HOME, "assets.json");

interface AssetIndex {
  version: 2;
  assets: AssetRecord[];
  tags: Record<string, AssetTagRecord[]>;
}

interface LegacyAssetIndex {
  version: 1;
  assets: AssetRecord[];
}

const TAG_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  ico: "image/x-icon", pdf: "application/pdf", html: "text/html",
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
    const parsed = JSON.parse(await fs.readFile(INDEX_PATH, "utf8")) as AssetIndex | LegacyAssetIndex;
    if (parsed.version === 2 && Array.isArray(parsed.assets)) {
      return { ...parsed, tags: parsed.tags && typeof parsed.tags === "object" ? parsed.tags : {} };
    }
    if (parsed.version === 1 && Array.isArray(parsed.assets)) {
      const tags: Record<string, AssetTagRecord[]> = {};
      for (const asset of parsed.assets) {
        const projectTags = (tags[asset.projectId] ??= []);
        for (const name of asset.tags ?? []) {
          if (!projectTags.some((tag) => tag.name === name)) {
            projectTags.push({
              id: crypto.randomUUID(),
              name,
              color: TAG_COLORS[projectTags.length % TAG_COLORS.length],
            });
          }
        }
      }
      return { version: 2, assets: parsed.assets, tags };
    }
    return { version: 2, assets: [], tags: {} };
  } catch {
    return { version: 2, assets: [], tags: {} };
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

function normalizeRelative(relativePath: string, allowRoot = true): string {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized && allowRoot) return "";
  if (
    !normalized ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("路径无效");
  }
  return path.normalize(normalized);
}

function safeEntryName(name: string): string {
  const value = name.trim();
  if (
    !value ||
    value === "." ||
    value === ".." ||
    path.basename(value) !== value ||
    /[/\\\u0000-\u001f]/.test(value)
  ) {
    throw new Error("名称无效");
  }
  return value;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueRelativePath(
  projectId: string,
  parent: string,
  requestedName: string
): Promise<string> {
  const parsed = path.parse(requestedName);
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? " 副本" : ` 副本 ${index}`;
    const name = `${parsed.name}${suffix}${parsed.ext}`;
    const relative = path.join(parent, name);
    if (!(await pathExists(inProject(projectId, relative)))) return relative;
  }
  throw new Error("无法生成可用的副本名称");
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

export async function listAssetTags(projectId: string): Promise<AssetTagRecord[]> {
  const index = await readIndex();
  const tags = (index.tags[projectId] ??= []);
  const names = new Set(tags.map((tag) => tag.name));
  for (const asset of index.assets.filter((entry) => entry.projectId === projectId)) {
    for (const name of asset.tags) {
      if (!names.has(name)) {
        tags.push({
          id: crypto.randomUUID(),
          name,
          color: TAG_COLORS[tags.length % TAG_COLORS.length],
        });
        names.add(name);
      }
    }
  }
  await writeIndex(index);
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export async function listAssetLibrary(projectId: string): Promise<AssetLibrarySnapshot> {
  // 先同步磁盘索引，再并行读取派生视图，避免两个 read-modify-write 覆盖彼此。
  const assets = await listProjectAssets(projectId);
  const [folders, tags] = await Promise.all([
    listProjectFolders(projectId),
    listAssetTags(projectId),
  ]);
  return { assets, folders, tags };
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

export async function listProjectFolders(projectId: string): Promise<string[]> {
  const root = workspaceDir(safeProjectId(projectId));
  const folders: string[] = [""];
  const visit = async (relative = ""): Promise<void> => {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".trash") continue;
      const child = path.join(relative, entry.name);
      folders.push(child);
      await visit(child);
    }
  };
  await visit();
  return folders.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export async function createProjectFolder(projectId: string, relativePath: string): Promise<void> {
  const clean = normalizeRelative(relativePath, false);
  await fs.mkdir(inProject(projectId, clean), { recursive: true });
}

export async function moveAsset(projectId: string, assetId: string, folder: string): Promise<AssetRecord> {
  const index = await readIndex();
  const asset = index.assets.find((entry) => entry.projectId === projectId && entry.id === assetId);
  if (!asset || asset.trashed) throw new Error("资产不存在");
  const nextRelative = path.join(folder, asset.name);
  if (path.normalize(nextRelative) === path.normalize(asset.relativePath)) return asset;
  await fs.mkdir(path.dirname(inProject(projectId, nextRelative)), { recursive: true });
  try {
    await fs.access(inProject(projectId, nextRelative));
    throw new Error("目标文件夹中已有同名文件");
  } catch (error) {
    if (error instanceof Error && error.message === "目标文件夹中已有同名文件") throw error;
  }
  await fs.rename(inProject(projectId, asset.relativePath), inProject(projectId, nextRelative));
  asset.relativePath = nextRelative;
  await writeIndex(index);
  return asset;
}

export async function createProjectFile(
  projectId: string,
  folder: string,
  name: string,
  content = ""
): Promise<AssetRecord> {
  const parent = normalizeRelative(folder);
  const safeName = safeEntryName(name);
  const relativePath = path.join(parent, safeName);
  const target = inProject(projectId, relativePath);
  if (await pathExists(target)) throw new Error("已有同名文件或文件夹");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  const assets = await listProjectAssets(projectId);
  const asset = assets.find((entry) => entry.relativePath === relativePath);
  if (!asset) throw new Error("文件创建后未能加入索引");
  return asset;
}

export async function renameProjectFolder(
  projectId: string,
  relativePath: string,
  name: string
): Promise<void> {
  const current = normalizeRelative(relativePath, false);
  const safeName = safeEntryName(name);
  const next = path.join(path.dirname(current), safeName);
  if (current === next) return;
  if (await pathExists(inProject(projectId, next))) throw new Error("已有同名文件或文件夹");
  await listProjectAssets(projectId);
  await fs.rename(inProject(projectId, current), inProject(projectId, next));
  const index = await readIndex();
  const prefix = `${current}${path.sep}`;
  for (const asset of index.assets) {
    if (asset.projectId === projectId && !asset.trashed && asset.relativePath.startsWith(prefix)) {
      asset.relativePath = path.join(next, asset.relativePath.slice(prefix.length));
    }
  }
  await writeIndex(index);
}

export async function moveProjectFolder(
  projectId: string,
  relativePath: string,
  destinationFolder: string
): Promise<void> {
  const current = normalizeRelative(relativePath, false);
  const destination = normalizeRelative(destinationFolder);
  if (destination === current || destination.startsWith(`${current}${path.sep}`)) {
    throw new Error("不能把文件夹移动到自身或其子文件夹");
  }
  const next = path.join(destination, path.basename(current));
  if (await pathExists(inProject(projectId, next))) throw new Error("目标位置已有同名项目");
  if (destination) {
    await fs.mkdir(inProject(projectId, destination), { recursive: true });
  }
  await listProjectAssets(projectId);
  await fs.rename(inProject(projectId, current), inProject(projectId, next));
  const index = await readIndex();
  const prefix = `${current}${path.sep}`;
  for (const asset of index.assets) {
    if (asset.projectId === projectId && !asset.trashed && asset.relativePath.startsWith(prefix)) {
      asset.relativePath = path.join(next, asset.relativePath.slice(prefix.length));
    }
  }
  await writeIndex(index);
}

export async function duplicateAsset(projectId: string, assetId: string): Promise<void> {
  const { asset } = await resolveAsset(projectId, assetId);
  const parent = path.dirname(asset.relativePath);
  await copyAsset(projectId, assetId, parent === "." ? "" : parent);
}

export async function copyAsset(
  projectId: string,
  assetId: string,
  destinationFolder: string
): Promise<void> {
  const { asset } = await resolveAsset(projectId, assetId);
  const destination = normalizeRelative(destinationFolder);
  const target = await uniqueRelativePath(projectId, destination, asset.name);
  if (destination) await fs.mkdir(inProject(projectId, destination), { recursive: true });
  await fs.copyFile(inProject(projectId, asset.relativePath), inProject(projectId, target));
  await listProjectAssets(projectId);
}

export async function duplicateProjectFolder(
  projectId: string,
  relativePath: string
): Promise<void> {
  const current = normalizeRelative(relativePath, false);
  const parent = path.dirname(current);
  const target = await uniqueRelativePath(
    projectId,
    parent === "." ? "" : parent,
    path.basename(current)
  );
  await fs.cp(inProject(projectId, current), inProject(projectId, target), {
    recursive: true,
    errorOnExist: true,
  });
  await listProjectAssets(projectId);
}

export async function trashProjectFolder(
  projectId: string,
  relativePath: string
): Promise<void> {
  const folder = normalizeRelative(relativePath, false);
  await listProjectAssets(projectId);
  const index = await readIndex();
  const prefix = `${folder}${path.sep}`;
  const assets = index.assets.filter(
    (asset) =>
      asset.projectId === projectId &&
      !asset.trashed &&
      asset.relativePath.startsWith(prefix)
  );
  const trashRoot = inProject(projectId, ".trash");
  await fs.mkdir(trashRoot, { recursive: true });
  for (const asset of assets) {
    await fs.rename(
      inProject(projectId, asset.relativePath),
      inProject(projectId, path.join(".trash", `${asset.id}-${asset.name}`))
    );
    asset.trashed = true;
  }
  await fs.rm(inProject(projectId, folder), { recursive: true, force: true });
  await writeIndex(index);
}

export async function permanentlyDeleteAsset(
  projectId: string,
  assetId: string
): Promise<void> {
  const index = await readIndex();
  const asset = index.assets.find(
    (entry) => entry.projectId === projectId && entry.id === assetId && entry.trashed
  );
  if (!asset) throw new Error("回收站中没有此资产");
  await fs.rm(inProject(projectId, path.join(".trash", `${asset.id}-${asset.name}`)), {
    force: true,
  });
  index.assets = index.assets.filter((entry) => entry !== asset);
  await writeIndex(index);
}

/* ---------- 批量操作：一次读索引、一次写索引，多选时避免逐文件 IPC ---------- */

export async function moveAssets(
  projectId: string,
  assetIds: string[],
  folder: string
): Promise<void> {
  const index = await readIndex();
  const selected = new Set(assetIds);
  const destination = normalizeRelative(folder);
  // 先整体校验目标冲突，再统一执行，避免移动到一半才报错
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id) || asset.trashed) continue;
    const nextRelative = path.join(destination, asset.name);
    if (path.normalize(nextRelative) === path.normalize(asset.relativePath)) continue;
    if (await pathExists(inProject(projectId, nextRelative))) {
      throw new Error(`目标文件夹中已有同名文件：${asset.name}`);
    }
  }
  if (destination) await fs.mkdir(inProject(projectId, destination), { recursive: true });
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id) || asset.trashed) continue;
    const nextRelative = path.join(destination, asset.name);
    if (path.normalize(nextRelative) === path.normalize(asset.relativePath)) continue;
    await fs.rename(
      inProject(projectId, asset.relativePath),
      inProject(projectId, nextRelative)
    );
    asset.relativePath = nextRelative;
  }
  await writeIndex(index);
}

export async function copyAssets(
  projectId: string,
  assetIds: string[],
  folder: string
): Promise<void> {
  const destination = normalizeRelative(folder);
  if (destination) await fs.mkdir(inProject(projectId, destination), { recursive: true });
  const assets = await listProjectAssets(projectId);
  const byId = new Map(
    assets.filter((asset) => !asset.trashed).map((asset) => [asset.id, asset])
  );
  for (const assetId of assetIds) {
    const asset = byId.get(assetId);
    if (!asset) continue;
    const target = await uniqueRelativePath(projectId, destination, asset.name);
    await fs.copyFile(
      inProject(projectId, asset.relativePath),
      inProject(projectId, target)
    );
  }
  await listProjectAssets(projectId);
}

export async function trashAssets(projectId: string, assetIds: string[]): Promise<void> {
  const index = await readIndex();
  const selected = new Set(assetIds);
  const trashRoot = inProject(projectId, ".trash");
  await fs.mkdir(trashRoot, { recursive: true });
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id) || asset.trashed) continue;
    await fs.rename(
      inProject(projectId, asset.relativePath),
      inProject(projectId, path.join(".trash", `${asset.id}-${asset.name}`))
    );
    asset.trashed = true;
  }
  await writeIndex(index);
}

export async function restoreAssets(projectId: string, assetIds: string[]): Promise<void> {
  const index = await readIndex();
  const selected = new Set(assetIds);
  await fs.mkdir(inProject(projectId, "restored"), { recursive: true });
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id) || !asset.trashed) continue;
    let nextRelative = path.join("restored", asset.name);
    try {
      await fs.access(inProject(projectId, nextRelative));
      nextRelative = path.join("restored", `${Date.now()}-${asset.name}`);
    } catch {
      // 目标可用
    }
    const trashRelative = path.join(".trash", `${asset.id}-${asset.name}`);
    await fs.rename(inProject(projectId, trashRelative), inProject(projectId, nextRelative));
    asset.relativePath = nextRelative;
    asset.trashed = false;
  }
  await writeIndex(index);
}

export async function permanentlyDeleteAssets(
  projectId: string,
  assetIds: string[]
): Promise<void> {
  const index = await readIndex();
  const selected = new Set(assetIds);
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id)) continue;
    await fs.rm(inProject(projectId, path.join(".trash", `${asset.id}-${asset.name}`)), {
      force: true,
    });
  }
  index.assets = index.assets.filter(
    (entry) => entry.projectId !== projectId || !selected.has(entry.id)
  );
  await writeIndex(index);
}

export type AssetBatchAction =
  | "move"
  | "copy"
  | "trash"
  | "restore"
  | "delete";

/** 多选操作统一入口：一次调用完成整批，出错即整体失败并保持索引一致。 */
export async function batchAssetOp(
  projectId: string,
  action: AssetBatchAction,
  assetIds: string[],
  folder = ""
): Promise<void> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  if (action === "move") await moveAssets(projectId, ids, folder);
  else if (action === "copy") await copyAssets(projectId, ids, folder);
  else if (action === "trash") await trashAssets(projectId, ids);
  else if (action === "restore") await restoreAssets(projectId, ids);
  else await permanentlyDeleteAssets(projectId, ids);
}

export async function createAssetTag(
  projectId: string,
  name: string,
  color: string
): Promise<AssetTagRecord> {
  const safeName = safeEntryName(name);
  const index = await readIndex();
  const tags = (index.tags[projectId] ??= []);
  if (tags.some((tag) => tag.name.toLocaleLowerCase() === safeName.toLocaleLowerCase())) {
    throw new Error("标签已存在");
  }
  const tag = { id: crypto.randomUUID(), name: safeName, color };
  tags.push(tag);
  await writeIndex(index);
  return tag;
}

export async function updateAssetTag(
  projectId: string,
  tagId: string,
  patch: { name?: string; color?: string }
): Promise<AssetTagRecord> {
  const index = await readIndex();
  const tags = (index.tags[projectId] ??= []);
  const tag = tags.find((entry) => entry.id === tagId);
  if (!tag) throw new Error("标签不存在");
  if (patch.name && patch.name !== tag.name) {
    const nextName = safeEntryName(patch.name);
    if (tags.some((entry) => entry.id !== tagId && entry.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) {
      throw new Error("标签已存在");
    }
    const previous = tag.name;
    tag.name = nextName;
    for (const asset of index.assets.filter((entry) => entry.projectId === projectId)) {
      asset.tags = asset.tags.map((name) => (name === previous ? nextName : name));
    }
  }
  if (patch.color) tag.color = patch.color;
  await writeIndex(index);
  return tag;
}

export async function deleteAssetTag(projectId: string, tagId: string): Promise<void> {
  const index = await readIndex();
  const tags = (index.tags[projectId] ??= []);
  const tag = tags.find((entry) => entry.id === tagId);
  if (!tag) return;
  index.tags[projectId] = tags.filter((entry) => entry.id !== tagId);
  for (const asset of index.assets.filter((entry) => entry.projectId === projectId)) {
    asset.tags = asset.tags.filter((name) => name !== tag.name);
  }
  await writeIndex(index);
}

export async function assignAssetTags(
  projectId: string,
  assetIds: string[],
  tagNames: string[],
  mode: AssetTagMode
): Promise<void> {
  const index = await readIndex();
  const selected = new Set(assetIds);
  const requested = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  for (const asset of index.assets) {
    if (asset.projectId !== projectId || !selected.has(asset.id)) continue;
    if (mode === "set") asset.tags = requested;
    else if (mode === "add") asset.tags = [...new Set([...asset.tags, ...requested])];
    else asset.tags = asset.tags.filter((name) => !requested.includes(name));
  }
  await writeIndex(index);
}
