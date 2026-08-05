import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { openResource } from "@/features/files/resource-navigation";

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
                onClick={(event) => {
                  event.stopPropagation();
                  void openResource(href ?? "", projectId).catch((error) =>
                    toast.error(error instanceof Error ? error.message : "无法打开引用文件")
                  );
                }}
              >{children}</button>
            ) : (
              <a
                href={href}
                className="text-primary underline underline-offset-2"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void openResource(href ?? "", projectId).catch((error) =>
                    toast.error(error instanceof Error ? error.message : "无法打开链接")
                  );
                }}
              >
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
