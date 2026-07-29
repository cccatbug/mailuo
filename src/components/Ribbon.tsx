import { FolderKanban, FolderOpen, Globe2, MoonStar, Search, Settings, SunMedium } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShuLogo } from "@/components/ShuLogo";
import { useAppStore } from "@/store/useAppStore";
import { MOD_KEY, modLabel } from "@/lib/platform";
import { openAssetPanel, openBrowserPanel } from "@/components/DockLayout";

function RibbonButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "relative flex size-8 items-center justify-center rounded-md transition-colors [&_svg]:size-[18px]",
            active
              ? "bg-sidebar-accent text-foreground after:absolute after:top-1/2 after:-left-[6px] after:h-4 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-primary"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          )}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** 第一栏左缘功能区：全局动作（视图切换在第二栏头部） */
export function Ribbon() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const panelLeft = useAppStore((s) => s.panelLeft);
  const togglePanel = useAppStore((s) => s.togglePanel);

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
      <RibbonButton
        label={`项目栏（${MOD_KEY}B）`}
        active={panelLeft}
        onClick={() => togglePanel("left")}
      >
        <FolderKanban />
      </RibbonButton>
      <div className="my-1 h-px w-6 bg-border" />
      <RibbonButton
        label={`搜索与命令（${MOD_KEY}K）`}
        onClick={() => setCommandOpen(true)}
      >
        <Search />
      </RibbonButton>
      <RibbonButton
        label={`小枢 · AI 助手（${modLabel("J")}）`}
        onClick={() => setAssistantOpen(true)}
      >
        <ShuLogo className="text-primary" />
      </RibbonButton>
      <RibbonButton label="浏览器 · 小枢网页助手" onClick={() => openBrowserPanel()}>
        <Globe2 />
      </RibbonButton>
      <RibbonButton label="项目资产" onClick={() => openAssetPanel()}>
        <FolderOpen />
      </RibbonButton>

      <div className="flex-1" />

      <RibbonButton
        label={theme === "dark" ? "切换浅色" : "切换深色"}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <SunMedium /> : <MoonStar />}
      </RibbonButton>
      <RibbonButton
        label={`设置（${modLabel(",")}）`}
        onClick={() => setSettingsOpen(true)}
      >
        <Settings />
      </RibbonButton>
    </nav>
  );
}
