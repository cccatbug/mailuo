import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { bridge } from "@/lib/bridge";
import { openFilePanel } from "@/components/DockLayout";
import { useAppStore } from "@/store/useAppStore";

/** 紧凑型 markdown 渲染（聊天气泡内，流式期间可反复重渲染） */
export const Md = memo(function Md({ text }: { text: string }) {
  const projectId = useAppStore((state) => state.selectedProjectId);
  return (
    <div className="mailuo-md min-w-0 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith("mailuo-asset:") ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            const assetId = href?.startsWith("mailuo-asset:") ? href.slice("mailuo-asset:".length) : null;
            return assetId ? (
              <button
                className="text-primary underline underline-offset-2"
                onClick={() => {
                  if (!projectId) return;
                  void bridge?.resolveAsset(projectId, assetId).then(({ asset, absolutePath }) =>
                    openFilePanel(absolutePath, asset.mimeType, asset.name)
                  );
                }}
              >{children}</button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const inline = !className;
            return inline ? (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            ) : (
              <code className={`${className ?? ""} font-mono text-xs`}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/50 p-3">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border">
              <table className="w-full text-xs [&_td]:border-t [&_td]:px-2 [&_td]:py-1 [&_th]:bg-muted/40 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium">
                {children}
              </table>
            </div>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
