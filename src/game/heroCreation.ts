// Creating a hero of the player's own before a story begins. The story's hero still supplies everything the story
// is balanced around (action points, stamina, starting items, gold, level, carry capacity); the player decides who
// they are: characteristics, occupation, skills, name, age, and background. Skills and occupations come from the
// story's own sheets.

import { CHARACTERISTICS, rollCharacteristics, rollDice } from "../model/rules";
import {
  allowsOccupationPoints,
  entryValue,
  occupationPointBudget,
  occupationPointsSpent,
  occupationSkillIds,
  personalPointBudget,
  personalPointsSpent,
  skillValue,
  wealthSkill,
  type SkillCatalog,
} from "../model/skills";
import { makeId } from "../model/story";
import type { Characteristic, Characteristics, SkillEntry, StoryCharacter } from "../model/types";
import { skillIssues, type IssueKind } from "../model/validator";

export type CharacteristicMethod = "roll" | "pointBuy";

/// Point buy spreads 460 points over every characteristic but Luck, which is always rolled.
export const POINT_BUY_TOTAL = 460;
export const POINT_BUY_RANGE: [number, number] = [15, 90];
export const POINT_BUY_CHARACTERISTICS: Characteristic[] = CHARACTERISTICS.filter((c) => c !== "luck");
export const AGE_RANGE: [number, number] = [15, 89];

/// A new hero built on the story's hero, with freshly rolled characteristics and nothing else chosen yet.
export function newDraft(template: StoryCharacter): StoryCharacter {
  return {
    ...structuredClone(template),
    name: [],
    lineage: [],
    calling: [],
    summary: [],
    age: 25,
    characteristics: rollCharacteristics(),
    occupationId: "",
    skills: [],
  };
}

/// An even starting spread for point buy: 55 in each, which leaves 20 points to place.
export function pointBuyStart(luck: number): Characteristics {
  const values = Object.fromEntries(CHARACTERISTICS.map((c) => [c, 55])) as Characteristics;
  values.luck = luck;
  return values;
}

export function pointBuySpent(characteristics: Characteristics): number {
  return POINT_BUY_CHARACTERISTICS.reduce((sum, c) => sum + characteristics[c], 0);
}

export function rollLuck(): number {
  return rollDice(3, 6) * 5;
}

// MARK: Occupation and skills

/// The skills a player can spend points on at creation: every skill the sheet allows at creation, leaving out
/// uncommon ones unless the occupation names them (a Mage's Fireball, say).
export function creationSkillIds(catalog: SkillCatalog, occupationId: string): string[] {
  const occupation = catalog.occupation(occupationId);
  const named = new Set(occupation ? occupationSkillIds(catalog, occupation) : []);
  return catalog.skills.filter((s) => s.atCreation && (!s.isUncommon || named.has(s.id))).map((s) => s.id);
}

/// Picks an occupation. Points already spent are cleared, and the wealth skill starts at the bottom of its range.
export function chooseOccupation(catalog: SkillCatalog, draft: StoryCharacter, occupationId: string) {
  draft.occupationId = occupationId;
  draft.skills = [];
  const job = catalog.occupation(occupationId);
  const wealth = wealthSkill(catalog);
  if (job && wealth) setPoints(catalog, draft, wealth.id, "occupationPoints", job.wealth[0]);
}

export function entryFor(draft: StoryCharacter, skillId: string): SkillEntry | undefined {
  return draft.skills.find((s) => s.skillId === skillId);
}

/// Sets one budget's points in a skill, adding the skill (with the occupation's suggested specialty) when needed
/// and dropping it once it holds no points.
export function setPoints(catalog: SkillCatalog, draft: StoryCharacter, skillId: string, key: "occupationPoints" | "personalPoints", value: number) {
  let entry = entryFor(draft, skillId);
  if (!entry) {
    const suggested = catalog.occupation(draft.occupationId)?.slots.find((slot) => slot.type === "skill" && slot.skillId === skillId);
    const specialty = suggested?.type === "skill" ? structuredClone(suggested.specialty) : [];
    entry = { id: makeId(), skillId, specialty, occupationPoints: 0, personalPoints: 0 };
    draft.skills.push(entry);
  }
  entry[key] = Math.max(0, value);
  draft.skills = draft.skills.filter((s) => s.occupationPoints + s.personalPoints > 0);
}

/// Skills most stories call on, which personal points favor when spent automatically: the perception skills and
/// the ways of staying alive in a fight.
function generallyUseful(catalog: SkillCatalog): string[] {
  return catalog.skills
    .filter((s) => s.atCreation && !s.isUncommon && (s.group === "perception" || s.combat.type === "dodge"))
    .map((s) => s.id);
}

/// Spends whatever is left of both budgets: occupation points over the occupation's skills, personal points over
/// those and a few generally useful ones. Skills stop at 75, so a hero comes out broad rather than lopsided.
export function autoSpend(catalog: SkillCatalog, draft: StoryCharacter) {
  const job = catalog.occupation(draft.occupationId);
  if (!job) return;
  const cap = 75;
  const room = (id: string) => cap - skillValue(catalog, draft.skills, draft.characteristics, id);
  const spread = (key: "occupationPoints" | "personalPoints", left: number, ids: string[]) => {
    let remaining = left;
    let open = ids.filter((id) => room(id) > 0);
    while (remaining > 0 && open.length > 0) {
      const share = Math.max(1, Math.floor(remaining / open.length));
      for (const id of open) {
        const given = Math.min(share, room(id), remaining);
        if (given <= 0) continue;
        setPoints(catalog, draft, id, key, (entryFor(draft, id)?.[key] ?? 0) + given);
        remaining -= given;
      }
      open = open.filter((id) => room(id) > 0);
    }
  };
  const allowed = new Set(creationSkillIds(catalog, job.id));
  const wealth = wealthSkill(catalog)?.id;
  const named = occupationSkillIds(catalog, job).filter((id) => id !== wealth && allowed.has(id));
  spread("occupationPoints", occupationPointBudget(catalog, draft) - occupationPointsSpent(draft), named);
  spread("personalPoints", personalPointBudget(draft) - personalPointsSpent(draft), [...new Set([...named, ...generallyUseful(catalog)])]);
}

/// Clears every point but the wealth the occupation requires.
export function clearPoints(catalog: SkillCatalog, draft: StoryCharacter) {
  chooseOccupation(catalog, draft, draft.occupationId);
}

export function canTakeOccupationPoints(catalog: SkillCatalog, draft: StoryCharacter, skillId: string): boolean {
  const job = catalog.occupation(draft.occupationId);
  return job ? allowsOccupationPoints(catalog, job, skillId) : false;
}

export function draftEntryValue(catalog: SkillCatalog, draft: StoryCharacter, entry: SkillEntry): number {
  return entryValue(catalog, entry, draft.characteristics);
}

// MARK: Readiness

export type CharacteristicIssue = "overspent" | "outOfRange";

/// What keeps point-bought characteristics from being used, or an empty list when they're fine.
export function characteristicIssues(draft: StoryCharacter, method: CharacteristicMethod): CharacteristicIssue[] {
  if (method !== "pointBuy") return [];
  const issues: CharacteristicIssue[] = [];
  if (pointBuySpent(draft.characteristics) > POINT_BUY_TOTAL) issues.push("overspent");
  const [low, high] = POINT_BUY_RANGE;
  if (POINT_BUY_CHARACTERISTICS.some((c) => draft.characteristics[c] < low || draft.characteristics[c] > high)) issues.push("outOfRange");
  return issues;
}

/// The character-sheet rules the skills break, as the story validator reports them for a story's hero.
export function skillProblems(catalog: SkillCatalog, draft: StoryCharacter): IssueKind[] {
  return skillIssues(catalog, draft);
}
