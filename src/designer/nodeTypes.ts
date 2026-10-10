// The kinds of node a creator can place, with how each looks on the canvas and in the palette.

import { t } from "../i18n";
import { PHASE_KEYS } from "../model/names";
import { defaultCharacteristics } from "../model/rules";
import { entrance, entranceNode, startNode, makeId } from "../model/story";
import { isBlank, localizedText, resolve } from "../model/storyText";
import type { Choice, EventTrigger, NodeKind, NodeType, Story, StoryCharacter, StoryMonster, StoryText } from "../model/types";
import { Port } from "../model/types";

export const NODE_TYPES: NodeType[] = ["entrance", "chapterStart", "narration", "choice", "check", "event", "battle", "end", "chapterJump"];

interface NodeTypeInfo {
  name: string;
  summary: string;
  symbol: string;
  color: string;
}

const INFO: Record<NodeType, NodeTypeInfo> = {
  entrance: {
    name: "Entrance",
    summary: "The beginning: title, world, intro, and hero. Every story has exactly one.",
    symbol: "door.left.hand.open",
    color: "rgb(143, 219, 214)",
  },
  narration: { name: "Narration", summary: "A passage of text with a single way forward.", symbol: "text.alignleft", color: "rgb(158, 173, 242)" },
  choice: {
    name: "Choice",
    summary: "The player picks an action. Each option is its own output.",
    symbol: "arrow.triangle.branch",
    color: "rgb(245, 199, 107)",
  },
  check: {
    name: "Check",
    summary: "Roll a d20 plus an attribute against a difficulty: success or failure.",
    symbol: "dice",
    color: "rgb(189, 153, 242)",
  },
  battle: { name: "Battle", summary: "A fight that lasts until someone falls: victory or defeat.", symbol: "flame", color: "rgb(240, 122, 128)" },
  end: {
    name: "End",
    summary: "Where the story finishes. Any number of branches can lead to the same end.",
    symbol: "flag.checkered",
    color: "rgb(179, 219, 140)",
  },
  chapterStart: {
    name: "Chapter Start",
    summary: "Where play enters this chapter, with its title card. One per chapter.",
    symbol: "bookmark",
    color: "rgb(235, 168, 209)",
  },
  chapterJump: {
    name: "Next Chapter",
    summary: "Ends this branch by moving on to another chapter’s start.",
    symbol: "arrowshape.turn.up.right",
    color: "rgb(235, 168, 209)",
  },
  event: {
    name: "Event",
    summary: "Something happens: always (Eventually), or only by chance, by characteristics, or after another event (Perhaps).",
    symbol: "sparkles",
    color: "rgb(250, 158, 97)",
  },
};

export function typeName(type: NodeType): string {
  return t(INFO[type].name);
}

export function typeSummary(type: NodeType): string {
  return t(INFO[type].summary);
}

export function typeSymbol(type: NodeType): string {
  return INFO[type].symbol;
}

export function typeColor(type: NodeType): string {
  return INFO[type].color;
}

/// A color with transparency, from one of the `rgb(…)` colors above.
export function withAlpha(color: string, alpha: number): string {
  return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

/// Whether the palette offers this type in a chapter. The story has one entrance, and each chapter one start.
export function isPlaceable(type: NodeType, chapterId: string, story: Story): boolean {
  if (type === "entrance") return !entranceNode(story);
  if (type === "chapterStart") return !startNode(story, chapterId);
  return true;
}

export function defaultTrigger(): EventTrigger {
  return { mode: "chance", chance: 50, conditions: [], requiresAll: true, priorEventId: "", earliestDay: 0, latestDay: 0, phases: PHASE_KEYS.map((_, index) => index) };
}

/// A fresh node of this type for `chapterId`, pre-filled with placeholder text in `language` and sensible sheet
/// references.
export function makeKind(type: NodeType, language: string, story: Story, chapterId: string): NodeKind {
  const text = (key: string) => localizedText(key, language);
  switch (type) {
    case "entrance":
      return {
        type,
        title: text("Untitled Story"),
        background: [],
        intro: [],
        heroId: story.characters[0]?.id ?? "",
        quest: { title: text("A new journey"), objective: [] },
        startDay: 1,
        startPhase: 0,
      };
    case "narration":
      return { type, presence: [], title: text("New passage"), body: [], quote: [] };
    case "choice":
      return {
        type,
        presence: [],
        title: text("A choice"),
        body: [],
        quote: [],
        options: [newOption(text("First option")), newOption(text("Second option"))],
      };
    case "check":
      return { type, title: text("A test of skill"), body: [], target: { type: "characteristic", characteristic: "dexterity" }, difficulty: "regular" };
    case "battle": {
      // Default to the first monster, or a character that isn't the hero, so a new battle is usually ready to go.
      const heroId = entrance(story)?.heroId;
      const enemyId = story.monsters[0]?.id ?? story.characters.find((c) => c.id !== heroId)?.id ?? "";
      return { type, presence: [], title: text("A fight"), body: [], enemyId };
    }
    case "end":
      return { type, title: text("The end"), body: [], quote: [], outcome: "neutral" };
    case "chapterStart":
      return { type, body: [], quote: [] };
    case "chapterJump": {
      // Default to the chapter after this one.
      const index = story.chapters.findIndex((c) => c.id === chapterId);
      return { type, targetChapterId: story.chapters[index + 1]?.id ?? "" };
    }
    case "event":
      return {
        type,
        title: text("Something happens"),
        body: [],
        quote: [],
        eventId: story.events[0]?.id ?? "",
        occurrence: "eventually",
        trigger: defaultTrigger(),
        hp: 0,
        mp: 0,
        stamina: 0,
        sanity: 0,
        gold: 0,
        xp: 0,
      };
  }
}

export function newOption(title: StoryText = []): Choice {
  return {
    id: makeId(),
    title,
    detail: [],
    symbol: "arrow.right",
    tag: [],
    apCost: 0,
    effect: { hp: 0, mp: 0, stamina: 0, xp: 0, gold: 0, sanity: 0, passesTime: false, objective: null, gainItems: [], loseItems: [], moveTo: null },
  };
}

/// A new character with average characteristics, named in `language`.
export function characterTemplate(language: string): StoryCharacter {
  return {
    id: makeId(),
    name: localizedText("New character", language),
    lineage: [],
    calling: [],
    summary: [],
    symbol: "person.fill",
    age: 25,
    characteristics: defaultCharacteristics(),
    occupationId: "",
    skills: [],
    level: 1,
    stamina: 50,
    ap: 3,
    xp: 0,
    xpToNext: 100,
    gold: 0,
    itemIds: [],
    carryCapacity: 30,
    effects: [],
    minDamage: 4,
    maxDamage: 9,
    xpReward: 50,
    goldReward: 0,
  };
}

export function monsterTemplate(language: string): StoryMonster {
  return {
    id: makeId(),
    name: localizedText("New monster", language),
    detail: [],
    symbol: "pawprint.fill",
    strength: 50,
    constitution: 50,
    size: 50,
    dexterity: 50,
    power: 50,
    hitPoints: 10,
    fighting: 40,
    attackName: localizedText("Claw", language),
    damage: { count: 1, sides: 6, bonus: 0 },
    addsDamageBonus: true,
    impales: false,
    attacksPerRound: 1,
    dodge: 25,
    armor: 0,
    xpReward: 30,
    goldReward: 0,
  };
}

// MARK: Ports

/// The label shown next to an output port on the canvas.
export function portLabel(kind: NodeKind, port: string, language: string): string {
  switch (port) {
    case Port.next:
      return kind.type === "entrance" || kind.type === "chapterStart" ? t("Begin") : t("Next");
    case Port.success:
      return t("Success");
    case Port.failure:
      return t("Failure");
    case Port.victory:
      return t("Victory");
    case Port.defeat:
      return t("Defeat");
    case Port.happens:
      return t("Happens");
    case Port.death:
      return t("Death");
    case Port.otherwise:
      return t("Doesn’t happen");
  }
  if (kind.type === "choice") {
    const index = kind.options.findIndex((o) => o.id === port);
    if (index !== -1) {
      const title = kind.options[index].title;
      return isBlank(title) ? t("Option %lld", index + 1) : resolve(title, language);
    }
  }
  return port;
}

/// Wires leaving good outcomes are tinted green, bad outcomes orange.
export function portColor(kind: NodeKind, port: string): string {
  switch (port) {
    case Port.success:
    case Port.victory:
    case Port.happens:
      return "rgb(140, 219, 158)";
    case Port.failure:
    case Port.defeat:
      return "rgb(245, 158, 115)";
    case Port.death:
      return "rgb(240, 122, 128)";
    default:
      return typeColor(kind.type);
  }
}
