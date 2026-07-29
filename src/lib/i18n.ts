import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  "zh-CN": {
    translation: {
      common: {
        allowOnce: "仅本次允许",
        deny: "拒绝",
      },
      dock: {
        close: "关闭当前",
        closeOthers: "关闭其他",
        closeAll: "关闭全部",
      },
      appearance: {
        theme: "主题",
        mode: "明暗模式",
        modeDescription: "跟随系统，或固定使用浅色与深色界面。",
        system: "跟随系统",
        light: "浅色",
        dark: "深色",
        palette: "全局色板",
        paletteDescription: "改变主色、背景、图表和脉络图的整体气质。",
        paper: "米纸朱砂",
        moon: "月白靛蓝",
        celadon: "青瓷松绿",
        graphite: "石墨紫",
        language: "界面语言",
        languageDescription: "本次新增与修改的界面支持中文和英文。",
        interface: "界面",
      },
      browser: {
        title: "浏览器",
        tabs: "浏览器标签页",
        tasks: "任务",
        mentionHint: "引用任务或浏览器标签页（↑↓ 选择，⏎ 确认）",
        agentMode: "小枢浏览器权限",
        agentModeDescription: "控制小枢操作内置浏览器时的确认范围。",
        confirmSensitive: "敏感操作确认",
        confirmSensitiveDescription: "读取和普通交互自动执行，提交、上传和敏感写入需要确认。",
        alwaysAllow: "完全自动",
        alwaysAllowDescription: "允许小枢直接执行所有浏览器操作。",
        readOnly: "逐项确认",
        readOnlyDescription: "读取以外的每个浏览器操作都需要确认。",
        approvalTitle: "浏览器操作需要确认",
        openDevTools: "打开开发者工具",
        toggleConsole: "切换网页控制台",
        clearData: "清除 Cookie 与缓存…",
        tools: "浏览器工具",
        address: "网址或搜索",
        openExternal: "在系统浏览器打开",
      },
    },
  },
  en: {
    translation: {
      common: {
        allowOnce: "Allow once",
        deny: "Deny",
      },
      dock: {
        close: "Close",
        closeOthers: "Close Others",
        closeAll: "Close All",
      },
      appearance: {
        theme: "Theme",
        mode: "Appearance",
        modeDescription: "Follow the system or keep a fixed light or dark appearance.",
        system: "System",
        light: "Light",
        dark: "Dark",
        palette: "Color palette",
        paletteDescription: "Changes the accent, surfaces, charts, and task graph colors.",
        paper: "Rice Paper",
        moon: "Moon Indigo",
        celadon: "Celadon Pine",
        graphite: "Graphite Violet",
        language: "Language",
        languageDescription: "New and updated surfaces are available in Chinese and English.",
        interface: "Interface",
      },
      browser: {
        title: "Browser",
        tabs: "Browser tabs",
        tasks: "Tasks",
        mentionHint: "Reference a task or browser tab (↑↓ select, Enter confirm)",
        agentMode: "Shu browser permissions",
        agentModeDescription: "Choose when Shu must ask before controlling the built-in browser.",
        confirmSensitive: "Confirm sensitive actions",
        confirmSensitiveDescription: "Reading and ordinary interaction run automatically; submissions, uploads, and sensitive writes need approval.",
        alwaysAllow: "Always allow",
        alwaysAllowDescription: "Allow Shu to perform every browser action automatically.",
        readOnly: "Confirm each action",
        readOnlyDescription: "Every browser action other than reading needs approval.",
        approvalTitle: "Browser action needs approval",
        openDevTools: "Open Developer Tools",
        toggleConsole: "Toggle Web Console",
        clearData: "Clear cookies and cache…",
        tools: "Browser tools",
        address: "Address or search",
        openExternal: "Open in system browser",
      },
    },
  },
} as const;

function initialLocale(): "zh-CN" | "en" {
  try {
    const stored = JSON.parse(
      localStorage.getItem("mailuo-settings") ?? "{}"
    ) as { locale?: string };
    return stored.locale === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});

export default i18n;
