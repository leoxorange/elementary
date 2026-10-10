import zhHans from "./zh-Hans.json";

/// The language picked in Settings. `system` follows the operating system.
export type AppLanguage = "system" | "english" | "simplifiedChinese";
/// The languages the interface is translated into. English is the source language.
export type UILanguage = "en" | "zh-Hans";

export const APP_LANGUAGES: AppLanguage[] = ["system", "english", "simplifiedChinese"];

const tables: Record<UILanguage, Record<string, string>> = {
  en: {},
  "zh-Hans": {
    ...(zhHans as Record<string, string>),
    // Strings this port added; the rest come from the original app's string catalog.
    "Make an editable copy of %@": "制作“%@”的可编辑副本",
    "Elementary": "Elementary",
    "Story files": "故事文件",
    "Audio": "音频",
    "Search icons": "搜索图标",
    "Icon": "图标",
    "Cancel": "取消",
    "Couldn't export story": "无法导出故事",
    // Action points only come back with time, and events can change more than health and trigger by time.
    "Needs %lld AP — it comes back when time passes.": "需要%lld AP——时间流逝后恢复。",
    "Passes time": "时间流逝",
    "Time": "时间",
    "From day": "起始日",
    "Until day": "截止日",
    "Window": "时段",
    "A day of 0 means no limit.": "日期为0表示不限。",
    "day %lld": "第%lld天",
    "days %lld–%lld": "第%lld–%lld天",
    "from day %lld": "第%lld天起",
    "until day %lld": "直到第%lld天",
    "never": "永不",
    "any time": "任何时候",
    "Happens when play reaches this node within the days and at one of the times of day chosen. Time only moves on through options that pass time. When it doesn’t happen, play moves straight on through Doesn’t Happen without stopping.":
      "游戏在所选日期范围内、且在所选时段之一到达此节点时发生。时间只会随“时间流逝”的选项推进。未发生时，游戏会直接经由“未发生”继续，不会停留。",
    "Applied when the event happens. Mana, stamina, and sanity stay within the hero’s limits, and gold can’t drop below zero.":
      "事件发生时生效。法力、耐力和理智值不会超出英雄的上下限，金币不会低于零。",
    "Pick at least one time of day, and make sure the last day isn’t before the first, or this event never happens.":
      "请至少选择一个时段，并确保截止日不早于起始日，否则此事件永远不会发生。",
    "Every option costs action points. A hero who has spent theirs is stuck here, so add a free option.":
      "每个选项都需要行动点。行动点耗尽的英雄会卡在这里，请添加一个免费选项。",
  },
};

let current: UILanguage = "en";

export function resolveLanguage(language: AppLanguage): UILanguage {
  switch (language) {
    case "english":
      return "en";
    case "simplifiedChinese":
      return "zh-Hans";
    case "system":
      return navigator.language.toLowerCase().startsWith("zh") ? "zh-Hans" : "en";
  }
}

export function setUILanguage(language: UILanguage) {
  current = language;
  document.documentElement.lang = language;
}

export function uiLanguage(): UILanguage {
  return current;
}

/// Each language is listed in its own script so people can find it regardless of the current UI language.
export function appLanguageName(language: AppLanguage): string {
  switch (language) {
    case "system":
      return t("System");
    case "english":
      return "English";
    case "simplifiedChinese":
      return "简体中文";
  }
}

/// Looks up `key` (the English text, with printf-style placeholders as in the original string catalog) in the
/// interface language and fills in `args`.
export function t(key: string, ...args: (string | number)[]): string {
  return tIn(current, key, ...args);
}

/// `t` in a specific language, for story text written in the designer's language.
export function tIn(language: string, key: string, ...args: (string | number)[]): string {
  const table = tables[language === "zh-Hans" ? "zh-Hans" : "en"];
  return format(table[key] ?? key, args);
}

/// Replaces `%@`, `%lld`, and their positional forms (`%2$@`) with arguments, and `%%` with `%`.
function format(template: string, args: (string | number)[]): string {
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?(lld|ld|d|@|lf|f|%)/g, (_match, position: string | undefined, spec: string) => {
    if (spec === "%") return "%";
    const index = position ? Number(position) - 1 : next++;
    const value = args[index];
    return value === undefined ? "" : String(value);
  });
}

/// A list joined with “or”, like Foundation's `.list(type: .or)`.
export function formatOrList(values: string[]): string {
  if (values.length <= 1) return values.join("");
  if (current === "zh-Hans") return values.slice(0, -1).join("、") + "或" + values[values.length - 1];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return values.slice(0, -1).join(", ") + ", or " + values[values.length - 1];
}

/// A relative time such as “5 minutes ago”.
export function formatRelative(date: Date): string {
  const formatter = new Intl.RelativeTimeFormat(current, { numeric: "auto" });
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, "second");
}

export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return unit === 0 ? `${value} ${units[0]}` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
