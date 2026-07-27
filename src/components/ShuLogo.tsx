import { cn } from "@/lib/utils";

/**
 * 小枢 Shu —— AI 助手的品牌形象。
 * 意象：枢纽节点，中心圆点向外生长脉络连线与卫星节点，右上一点 AI 星芒。
 * 单色设计（currentColor），配合 text-primary 即为朱砂色，明暗主题自适应。
 */
export function ShuLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={cn("size-5", className)}
    >
      {/* 底盘 */}
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.1" />
      {/* 脉络连线 */}
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.55">
        <path d="M 21 21.5 Q 15 17 11.5 15.5" />
        <path d="M 26.5 21 Q 31 15.5 35 13.5" />
        <path d="M 25.5 27 Q 30 33 33.5 35" />
        <path d="M 21 26 Q 15.5 30 12.5 34.5" />
      </g>
      {/* 卫星节点 */}
      <g fill="currentColor">
        <circle cx="10" cy="14.5" r="3" opacity="0.75" />
        <circle cx="36.5" cy="12.5" r="2.6" opacity="0.75" />
        <circle cx="35" cy="36" r="3" opacity="0.75" />
        <circle cx="11.5" cy="36" r="2.4" opacity="0.6" />
      </g>
      {/* 枢心（双环，印章感） */}
      <circle cx="24" cy="24" r="6.4" fill="currentColor" />
      <circle cx="24" cy="24" r="2.4" fill="var(--background, #fff)" opacity="0.9" />
      {/* AI 星芒 */}
      <path
        d="M 39.5 21.5 l 1.1 2.6 2.6 1.1 -2.6 1.1 -1.1 2.6 -1.1 -2.6 -2.6 -1.1 2.6 -1.1 z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}
