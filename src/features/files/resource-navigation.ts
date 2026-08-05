import { openBrowserPanel, openFilePanel } from "@/components/DockLayout";
import { bridge } from "@/lib/bridge";
import { resourceTarget } from "@/shared/resource-target";

/** 在脉络内部打开任务引用：项目资产进文件面板，网页进内置浏览器。 */
export async function openResource(
  href: string,
  projectId: string | null
): Promise<void> {
  const target = resourceTarget(href);
  if (target.kind === "asset") {
    if (!projectId) throw new Error("请先选择项目");
    if (!bridge) throw new Error("当前环境无法打开项目资产");
    const { asset, absolutePath } = await bridge.resolveAsset(
      projectId,
      target.assetId
    );
    openFilePanel(absolutePath, asset.mimeType, asset.name);
    return;
  }
  if (target.kind === "browser") {
    if (!openBrowserPanel(target.url)) throw new Error("内置浏览器尚未就绪");
    return;
  }
  if (target.kind === "file") {
    openFilePanel(target.path);
    return;
  }
  throw new Error("不支持此链接");
}
