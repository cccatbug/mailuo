import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testRoot = vi.hoisted(() => `/tmp/mailuo-asset-store-${process.pid}`);
vi.mock("./pi", () => ({
  MAILUO_HOME: testRoot,
  workspaceDir: (projectId: string) => path.join(testRoot, "workspace", projectId),
}));

import {
  assignAssetTags,
  batchAssetOp,
  createAssetTag,
  createProjectFile,
  createProjectFolder,
  duplicateAsset,
  listAssetLibrary,
  renameProjectFolder,
  trashProjectFolder,
  inferMime,
} from "./asset-store";

describe("asset-store", () => {
  beforeEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("infers previewable asset MIME types case-insensitively", () => {
    expect(inferMime("diagram.SVG")).toBe("image/svg+xml");
    expect(inferMime("photo.avif")).toBe("image/avif");
    expect(inferMime("legacy.bmp")).toBe("image/bmp");
    expect(inferMime("favicon.ico")).toBe("image/x-icon");
    expect(inferMime("brief.pdf")).toBe("application/pdf");
    expect(inferMime("page.html")).toBe("text/html");
    expect(inferMime("unknown.bin")).toBe("application/octet-stream");
  });

  it("manages files, folders, duplicates, trash, and project tags", async () => {
    await createProjectFolder("project", "设计/终稿");
    const asset = await createProjectFile("project", "设计/终稿", "说明.md", "# hello");
    const tag = await createAssetTag("project", "重要", "#ef4444");
    await assignAssetTags("project", [asset.id], [tag.name], "set");
    await duplicateAsset("project", asset.id);
    await renameProjectFolder("project", "设计/终稿", "发布");

    let library = await listAssetLibrary("project");
    expect(library.folders.map((folder) => folder.replace(/\\/g, "/"))).toContain("设计/发布");
    expect(library.assets).toHaveLength(2);
    expect(library.assets.find((item) => item.id === asset.id)?.tags).toEqual(["重要"]);
    expect(library.tags).toMatchObject([{ name: "重要", color: "#ef4444" }]);

    await trashProjectFolder("project", "设计/发布");
    library = await listAssetLibrary("project");
    expect(library.assets.every((item) => item.trashed)).toBe(true);
  });

  it("batches move / copy / trash / restore / delete in one index write", async () => {
    await createProjectFolder("project", "素材");
    const first = await createProjectFile("project", "", "a.txt", "a");
    const second = await createProjectFile("project", "", "b.md", "b");

    await batchAssetOp("project", "move", [first.id, second.id], "素材");
    let library = await listAssetLibrary("project");
    expect(
      library.assets.map((item) => item.relativePath.replace(/\\/g, "/")).sort()
    ).toEqual(["素材/a.txt", "素材/b.md"]);

    await batchAssetOp("project", "copy", [first.id], "素材");
    library = await listAssetLibrary("project");
    expect(library.assets).toHaveLength(3);
    expect(library.assets.some((item) => item.name === "a 副本.txt")).toBe(true);

    await batchAssetOp("project", "trash", [first.id, second.id]);
    library = await listAssetLibrary("project");
    expect(library.assets.filter((item) => item.trashed)).toHaveLength(2);

    await batchAssetOp("project", "restore", [first.id]);
    library = await listAssetLibrary("project");
    const restored = library.assets.find((item) => item.id === first.id);
    expect(restored?.trashed).toBe(false);
    expect(restored?.relativePath.replace(/\\/g, "/")).toMatch(/^restored\//);

    await batchAssetOp("project", "delete", [second.id]);
    library = await listAssetLibrary("project");
    expect(library.assets.some((item) => item.id === second.id)).toBe(false);
  });

  it("rejects a batch move when a destination name collides", async () => {
    await createProjectFolder("project", "素材");
    const source = await createProjectFile("project", "", "a.txt", "a");
    await createProjectFile("project", "素材", "a.txt", "existing");

    await expect(batchAssetOp("project", "move", [source.id], "素材")).rejects.toThrow(
      "已有同名文件"
    );
    // 冲突时整批不落地：源文件仍在原位
    const library = await listAssetLibrary("project");
    expect(library.assets.find((item) => item.id === source.id)?.relativePath).toBe("a.txt");
  });
});
