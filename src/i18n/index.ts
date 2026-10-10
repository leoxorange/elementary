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
    // Creating a hero before a story begins.
    "Who will you play?": "你要扮演谁？",
    "Take the story’s own hero, or make one of your own.": "扮演故事原本的英雄，或者创建你自己的角色。",
    "Play as %@": "扮演%@",
    "Create your own hero": "创建你自己的英雄",
    "Roll your characteristics, choose an occupation, and spend skill points by the Call of Cthulhu rules. Different skills open different paths through the story.":
      "按照《克苏鲁的呼唤》规则掷骰生成属性、选择职业、分配技能点。不同的技能会在故事中开辟不同的道路。",
    "You’ll still start with what the story gives its hero: %@.": "你仍会带着故事给英雄准备的东西出发：%@。",
    "Create a Hero": "创建英雄",
    "Identity": "身份",
    "Roll dice": "掷骰",
    "Point buy": "购点",
    "Roll Again": "重新掷骰",
    "%lld of %lld points left": "剩余 %lld / %lld 点",
    "Rolled as 3D6 × 5, or (2D6 + 6) × 5 for SIZ, INT, and EDU. Roll as often as you like.":
      "按 3D6 × 5 掷骰，体型、智力和教育按 (2D6 + 6) × 5。可以随意重掷。",
    "Spread %lld points over every characteristic but Luck, each from %lld to %lld. Luck is rolled.":
      "将 %1$lld 点分配给除幸运外的各项属性，每项在 %2$lld 到 %3$lld 之间。幸运仍需掷骰。",
    "Your occupation sets your occupation skill points and which skills they can go into.": "职业决定你的职业技能点数，以及这些点数可以分配给哪些技能。",
    "Credit rating %lld–%lld": "信用评级 %lld–%lld",
    "Occupation points go into %@’s skills; personal points (INT × 2) into any skill. Skills can’t go above 99.":
      "职业技能点只能分配给%@的职业技能；兴趣技能点（智力 × 2）可分配给任意技能。技能不能超过 99。",
    "Spend for Me": "帮我分配",
    "Personal points": "兴趣技能点",
    "Other skills": "其他技能",
    "Base": "基础",
    "You’ve spent %lld occupation points but have %lld.": "你分配了 %1$lld 职业技能点，但只有 %2$lld 点。",
    "You’ve spent %lld personal points but have %lld.": "你分配了 %1$lld 兴趣技能点，但只有 %2$lld 点。",
    "Credit Rating must be from %lld to %lld for this occupation.": "该职业的信用评级必须在 %1$lld 到 %2$lld 之间。",
    "%@ isn’t one of your occupation’s skills.": "%@不是你的职业技能。",
    "These skills break the character creation rules.": "这些技能不符合角色创建规则。",
    "Name your hero. Age only changes how fast they move once they’re past 40.": "为你的英雄取个名字。年龄只在 40 岁以后影响移动速度。",
    "Required": "必填",
    "Optional, e.g. Grew up by the sea": "可选，例如：在海边长大",
    "Your hero": "你的英雄",
    "From the story: %@.": "来自故事：%@。",
    "Begin Story": "开始故事",
    // Story-made skills, occupations, and abilities.
    "Skills": "技能",
    "Occupations": "职业",
    "New skill": "新技能",
    "New ability": "新能力",
    "New occupation": "新职业",
    "New Skill": "新建技能",
    "New Ability": "新建能力",
    "New Occupation": "新建职业",
    "Combat": "战斗",
    "Interpersonal": "人际",
    "Knowledge": "学识",
    "Perception": "感知",
    "Physical": "体能",
    "Technical": "技术",
    "Magic": "魔法",
    "Other": "其他",
    "Missing skill": "缺失的技能",
    "Total": "总值",
    "Starting value": "初始值",
    "Occupation points go into the occupation’s skills and its wealth skill, which must stay within the range above.":
      "职业技能点只能分配给该职业的技能及其财富技能，财富技能必须保持在上面的范围内。",
    "Adds this occupation’s named skills and its wealth skill to the list, ready for points.": "把该职业指定的技能和财富技能加入列表，以便分配点数。",
    "Edit Occupation": "编辑职业",
    "Each skill is its base value plus occupation and personal-interest points (INT × 2). Skills not listed stay at their base. Skills can’t go above 99, and some, like Cthulhu Mythos, can’t be bought at creation.":
      "每项技能等于基础值加上职业技能点和兴趣技能点（智力 × 2）。未列出的技能保持基础值。技能不能超过 99，有些技能（如克苏鲁神话）不能在创建角色时购买。",
    "A character can attack with a weapon only if its skill is on their sheet. Whether a weapon is melee or ranged comes from its skill on the skill sheet. Melee weapons usually add the wielder’s damage bonus (from STR + SIZ); ranged ones don’t. Impaling weapons — blades, spears, bullets — deal extra damage on an extreme success. Ranged weapons can’t be dodged and let the shooter act first.":
      "角色只有在角色卡上拥有对应技能时才能用这件武器攻击。武器是近战还是远程，由技能表中它所用的技能决定。近战武器通常会加上使用者的伤害加值（来自力量 + 体型），远程武器则不会。贯穿武器（刀刃、长矛、子弹）在极难成功时造成额外伤害。远程攻击无法闪避，并让射手先行动。",
    "Only checks roll this skill.": "只有检定会使用这项技能。",
    "Weapons that use this skill attack with it. Melee attacks can be dodged or fought back; ranged ones can’t, and the shooter acts first. A skill usable bare-handed gives everyone who has it an unarmed attack.":
      "使用这项技能的武器以它进行攻击。近战攻击可以被闪避或反击；远程攻击不行，并且射手先行动。可徒手使用的技能会让拥有它的人获得一种徒手攻击。",
    "Rolled to get out of the way. In a fight the hero can spend a round dodging, and enemies dodge with their best dodge skill.":
      "用于躲开攻击。战斗中英雄可以花一回合专心闪避，敌人则用他们最好的闪避技能闪避。",
    "A battle action of its own, like a spell: the cost is paid, then the skill is rolled, and a success deals damage or heals. Characters can use abilities on their sheet. With one opponent, “all enemies” means that one.":
      "一种独立的战斗行动，就像法术：先支付消耗，再进行技能检定，成功则造成伤害或治疗。角色可以使用角色卡上拥有的能力。只有一个对手时，“所有敌人”就是指这一个。",
    "This story uses the built-in skills. Your first change copies them into the story, where you can change or delete any of them.":
      "这个故事使用内置技能。你第一次修改时会把它们复制进故事，之后可以修改或删除其中任何一项。",
    "What the skill covers, for your own reference.": "这项技能涵盖的内容，供你自己参考。",
    "Group": "分组",
    "Base Value": "基础值",
    "Where the skill starts before any points: a fixed number, or a share of a characteristic, as Dodge starts at half DEX.":
      "技能在分配点数前的起始值：一个固定数字，或某项属性的一部分，比如闪避从敏捷的一半开始。",
    "Starts at": "起始于",
    "Fixed": "固定值",
    "Share": "比例",
    "All of it": "全部",
    "Half": "一半",
    "A fifth": "五分之一",
    "Hero’s value": "英雄的数值",
    "Rules": "规则",
    "Uncommon skills only show on a character sheet once a character has them. The wealth skill is the one occupations give a range for, like Credit Rating; a story has at most one.":
      "罕见技能只有在角色拥有时才会显示在角色卡上。财富技能是职业规定范围的那项技能，比如信用评级；一个故事最多只有一个。",
    "Takes a specialty": "需要专攻",
    "Uncommon": "罕见",
    "Points at character creation": "创建角色时可分配点数",
    "Measures wealth": "代表财富",
    "Use": "用途",
    "Weapon skill": "武器技能",
    "Ability": "能力",
    "Range": "距离",
    "Melee": "近战",
    "Ranged": "远程",
    "Usable bare-handed": "可徒手使用",
    "Bare-handed damage": "徒手伤害",
    "Effect": "效果",
    "Heal": "治疗",
    "Healing": "治疗量",
    "Target": "目标",
    "One enemy": "一个敌人",
    "All enemies": "所有敌人",
    "Yourself": "自己",
    "Can be dodged": "可被闪避",
    "Ignores armor": "无视护甲",
    "Costs magic points": "消耗魔法值",
    "Costs hit points": "消耗生命值",
    "Costs stamina": "消耗耐力",
    "Costs sanity": "消耗理智值",
    "Nothing uses this skill yet.": "目前没有任何东西使用这项技能。",
    "Deleting a skill removes it from every character, occupation, and weapon. Checks that roll it are flagged so you can pick another.":
      "删除技能会把它从所有角色、职业和武器中移除。使用它的检定会被标出，方便你另选技能。",
    "Duplicate Skill": "复制技能",
    "Delete Skill": "删除技能",
    "One of": "其中之一",
    "Count": "数量",
    "from": "来自",
    "other skills of the player’s choice": "项由玩家自选的其他技能",
    "This story uses the built-in occupations. Your first change copies them into the story, where you can change or delete any of them.":
      "这个故事使用内置职业。你第一次修改时会把它们复制进故事，之后可以修改或删除其中任何一项。",
    "Shown to players choosing an occupation.": "玩家选择职业时会看到。",
    "Lowest": "最低",
    "Highest": "最高",
    "Occupation Points": "职业技能点",
    "Each line adds the best of its characteristics times its multiplier. EDU × 4 is the usual formula; EDU × 2 + DEX/STR × 2 rewards a strong or nimble character.":
      "每一行取其中最高的属性乘以倍数，再相加。通常是教育 × 4；教育 × 2 + 敏捷/力量 × 2 则偏向强壮或灵巧的角色。",
    "Multiplier": "倍数",
    "Add Term": "添加一项",
    "Formula": "公式",
    "Occupation Skills": "职业技能",
    "Occupation points can go into these skills and the wealth skill. Any “other skills” slot opens every skill.":
      "职业技能点可以分配给这些技能和财富技能。任何“其他技能”栏位都会开放所有技能。",
    "Add Skill Slot": "添加技能栏位",
    "Add “One Of” Slot": "添加“其中之一”栏位",
    "Add Group Slot": "添加分组栏位",
    "Add “Any Skill” Slot": "添加“任意技能”栏位",
    "No character has this occupation yet. Players can still pick it when they create a hero.": "还没有角色拥有这个职业。玩家创建英雄时仍然可以选择它。",
    "Duplicate Occupation": "复制职业",
    "Delete Occupation": "删除职业",
    "This story uses the built-in Call of Cthulhu skills. Change, add, or delete any of them to give the story its own.":
      "这个故事使用内置的《克苏鲁的呼唤》技能。修改、添加或删除任何一项，故事就会拥有自己的技能表。",
    "This story has its own skills. Checks, weapons, characters, and occupations all draw on this sheet.": "这个故事有自己的技能表。检定、武器、角色和职业都使用这张表。",
    "Restore Built-in Skills": "恢复内置技能",
    "Restore the built-in skills?": "恢复内置技能？",
    "Skills you added or changed are lost. Anything that used a skill that no longer exists is flagged so you can fix it.":
      "你添加或修改的技能将会丢失。使用了已不存在的技能的地方会被标出，方便你修正。",
    "Restore": "恢复",
    "This story uses the built-in Call of Cthulhu occupations. Change, add, or delete any of them to give the story its own.":
      "这个故事使用内置的《克苏鲁的呼唤》职业。修改、添加或删除任何一项，故事就会拥有自己的职业表。",
    "Players pick one of these when they create a hero; it sets their occupation skill points and skills.": "玩家创建英雄时从中选择一个，它决定职业技能点和职业技能。",
    "Restore Built-in Occupations": "恢复内置职业",
    "Restore the built-in occupations?": "恢复内置职业？",
    "Occupations you added or changed are lost. Characters with an occupation that no longer exists have none.": "你添加或修改的职业将会丢失。拥有已不存在职业的角色将没有职业。",
    "%@ can’t be bought with skill points at creation.": "%@不能在创建角色时用技能点购买。",
    "The weapon %@ uses a skill that isn’t a weapon skill, so no one can attack with it.": "武器%@使用的技能不是武器技能，所以没人能用它攻击。",
    "The ability %@ has no dice, so it can’t do anything.": "能力%@没有设置骰子，所以不会产生任何效果。",
    "The occupation %@ offers “%@”, which isn’t on the skill sheet.": "职业%1$@提供的“%2$@”不在技能表中。",
    "%@ should be between %lld and %lld for this occupation.": "该职业的%1$@应在 %2$lld 到 %3$lld 之间。",
    "one enemy": "一个敌人",
    "all enemies": "所有敌人",
    "yourself": "自己",
    "heals %@": "治疗 %@",
    "%lld MP": "%lld 魔法",
    "%lld HP": "%lld 生命",
    "%lld stamina": "%lld 耐力",
    "%lld SAN": "%lld 理智",
    "Can’t pay %@": "无法支付 %@",
    "%@ (%lld vs %lld) strikes with full force for %lld damage!": "%1$@（%2$lld 对 %3$lld）全力命中，造成 %4$lld 点伤害！",
    "%@ (%lld vs %lld) hits for %lld damage.": "%1$@（%2$lld 对 %3$lld）命中，造成 %4$lld 点伤害。",
    "%@ (%lld vs %lld) restores %lld HP.": "%1$@（%2$lld 对 %3$lld）恢复了 %4$lld 点生命值。",
    "%@ fails (%lld vs %lld).": "%1$@失败了（%2$lld 对 %3$lld）。",
    "%@ evades your %@ (%lld vs %lld).": "%1$@躲开了你的%2$@（%3$lld 对 %4$lld）。",
    "%lld %@ (%@)": "%1$lld 项%2$@（%3$@）",
    "%lld %@": "%1$lld 项%2$@",
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
