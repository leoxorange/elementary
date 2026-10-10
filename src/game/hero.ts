import { hitPoints, magicPoints, moveRate as characteristicsMoveRate, startingSanity } from "../model/rules";
import { skillValue, valueForTarget, type SkillCatalog } from "../model/skills";
import { entrance, heroCharacter } from "../model/story";
import type {
  Characteristics,
  CheckTarget,
  Item,
  Quest,
  SkillEntry,
  StatusEffect,
  Story,
  StoryCharacter,
  StoryText,
} from "../model/types";

/// The player character. A story's entrance supplies the starting hero; the game then changes a copy as play goes on.
export interface Hero {
  name: StoryText;
  lineage: StoryText;
  calling: StoryText;
  level: number;
  hp: number;
  maxHP: number;
  mp: number;
  maxMP: number;
  stamina: number;
  maxStamina: number;
  ap: number;
  maxAP: number;
  xp: number;
  xpToNext: number;
  gold: number;
  age: number;
  characteristics: Characteristics;
  /// Sanity, starting at POW. It can never rise above `maxSanity`.
  sanity: number;
  maxSanity: number;
  /// Luck, starting at LUC.
  luck: number;
  occupationId: string;
  skills: SkillEntry[];
  equipment: Item[];
  effects: StatusEffect[];
  quest: Quest;
  /// The most weight the hero can carry, or `null` for no limit.
  carryCapacity: number | null;
}

/// Builds the starting hero from a character-sheet entry, carrying copies of its items. Hit points, magic points,
/// sanity, and luck start full, derived from the characteristics.
export function makeHero(character: StoryCharacter, items: Item[], quest: Quest): Hero {
  const c = character.characteristics;
  return {
    name: character.name,
    lineage: character.lineage,
    calling: character.calling,
    level: character.level,
    hp: hitPoints(c),
    maxHP: hitPoints(c),
    mp: magicPoints(c),
    maxMP: magicPoints(c),
    stamina: character.stamina,
    maxStamina: character.stamina,
    ap: character.ap,
    maxAP: character.ap,
    xp: character.xp,
    xpToNext: character.xpToNext,
    gold: character.gold,
    age: character.age,
    characteristics: { ...c },
    sanity: startingSanity(c),
    maxSanity: 99,
    luck: c.luck,
    occupationId: character.occupationId,
    skills: structuredClone(character.skills),
    equipment: character.itemIds.flatMap((id) => items.filter((i) => i.id === id).slice(0, 1)).map((i) => structuredClone(i)),
    effects: structuredClone(character.effects),
    quest: structuredClone(quest),
    carryCapacity: character.carryCapacity > 0 ? character.carryCapacity : null,
  };
}

/// The hero as they begin play, with copies of their starting items: the story's own hero, or one the player made.
export function storyHero(story: Story, character = heroCharacter(story)): Hero | undefined {
  const entranceNode = entrance(story);
  if (!entranceNode || !character) return undefined;
  return makeHero(character, story.items, entranceNode.quest);
}

export function heroMoveRate(hero: Hero): number {
  return characteristicsMoveRate(hero.characteristics, hero.age);
}

/// A skill's value: the best entry for it, or its base value if the hero has none.
export function heroSkillValue(catalog: SkillCatalog, hero: Hero, skillId: string): number {
  return skillValue(catalog, hero.skills, hero.characteristics, skillId);
}

/// The value a check rolls against.
export function heroValue(catalog: SkillCatalog, hero: Hero, target: CheckTarget): number {
  return valueForTarget(catalog, hero.skills, hero.characteristics, target);
}

/// Armor: damage soaked from every hit by carried armor and trinkets.
export function defenseBonus(hero: Hero): number {
  return hero.equipment.reduce((sum, i) => sum + Math.max(0, i.defense), 0);
}

/// The total weight of everything the hero carries.
export function carriedWeight(hero: Hero): number {
  return hero.equipment.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
}
