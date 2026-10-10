// Skills and occupations, as game data. Only the mechanics live here (IDs, base values, point formulas, skill
// lists); display names are in `names.ts`.

import type { Characteristic, Characteristics, CheckTarget, SkillEntry, StoryCharacter } from "./types";
import { div } from "./rules";

/// A skill's starting value before any points are spent. Dodge starts at half DEX; Language (Own) at EDU.
export type SkillBase = { type: "fixed"; value: number } | { type: "halfDexterity" } | { type: "education" };

export interface SkillDefinition {
  id: string;
  base: SkillBase;
  /// Skills such as Art/Craft and Science are always taken with a specialty, e.g. Science (Biology).
  takesSpecialty: boolean;
  /// Uncommon skills are only listed on a character sheet once the character has them.
  isUncommon: boolean;
}

function skill(id: string, base: number | SkillBase, options: { specialty?: boolean; uncommon?: boolean } = {}): SkillDefinition {
  return {
    id,
    base: typeof base === "number" ? { type: "fixed", value: base } : base,
    takesSpecialty: options.specialty ?? false,
    isUncommon: options.uncommon ?? false,
  };
}

/// Every skill, in sheet order. Fighting and Firearms are split by weapon because each has its own base.
export const SKILLS: SkillDefinition[] = [
  skill("accounting", 5),
  skill("anthropology", 1),
  skill("appraise", 5),
  skill("archaeology", 1),
  skill("artCraft", 5, { specialty: true }),
  skill("charm", 15),
  skill("climb", 20),
  skill("computerUse", 5),
  skill("creditRating", 0),
  skill("mythos", 0),
  skill("disguise", 5),
  skill("dodge", { type: "halfDexterity" }),
  skill("driveAuto", 20),
  skill("electricalRepair", 10),
  skill("electronics", 1),
  skill("fastTalk", 5),
  skill("fightingBrawl", 25),
  skill("fightingAxe", 15, { uncommon: true }),
  skill("fightingChainsaw", 10, { uncommon: true }),
  skill("fightingFlail", 10, { uncommon: true }),
  skill("fightingGarrote", 15, { uncommon: true }),
  skill("fightingSpear", 20, { uncommon: true }),
  skill("fightingSword", 20, { uncommon: true }),
  skill("fightingWhip", 5, { uncommon: true }),
  skill("firearmsHandgun", 20),
  skill("firearmsRifle", 25),
  skill("firearmsBow", 15, { uncommon: true }),
  skill("firearmsFlamethrower", 10, { uncommon: true }),
  skill("firearmsHeavyWeapons", 10, { uncommon: true }),
  skill("firearmsMachineGun", 10, { uncommon: true }),
  skill("firearmsSubmachineGun", 15, { uncommon: true }),
  skill("firstAid", 30),
  skill("history", 5),
  skill("intimidate", 15),
  skill("jump", 20),
  skill("languageOther", 1, { specialty: true }),
  skill("languageOwn", { type: "education" }, { specialty: true }),
  skill("law", 5),
  skill("libraryUse", 20),
  skill("listen", 20),
  skill("locksmith", 1),
  skill("mechanicalRepair", 10),
  skill("medicine", 1),
  skill("naturalWorld", 10),
  skill("navigate", 10),
  skill("occult", 5),
  skill("operateHeavyMachinery", 1),
  skill("persuade", 10),
  skill("pilot", 1, { specialty: true }),
  skill("psychoanalysis", 1),
  skill("psychology", 10),
  skill("ride", 5),
  skill("science", 1, { specialty: true }),
  skill("sleightOfHand", 10),
  skill("spotHidden", 25),
  skill("stealth", 20),
  skill("survival", 10, { specialty: true }),
  skill("swim", 20),
  skill("throw", 20),
  skill("track", 10),
  skill("animalHandling", 5, { uncommon: true }),
  skill("artillery", 1, { uncommon: true }),
  skill("demolitions", 1, { uncommon: true }),
  skill("diving", 1, { uncommon: true }),
  skill("hypnosis", 1, { uncommon: true }),
  skill("lore", 1, { specialty: true, uncommon: true }),
  skill("readLips", 1, { uncommon: true }),
];

const skillsById = new Map(SKILLS.map((s) => [s.id, s]));

export function skillDefinition(id: string): SkillDefinition | undefined {
  return skillsById.get(id);
}

export function baseValue(base: SkillBase, characteristics: Characteristics): number {
  switch (base.type) {
    case "fixed":
      return base.value;
    case "halfDexterity":
      return div(characteristics.dexterity, 2);
    case "education":
      return characteristics.education;
  }
}

/// The four interpersonal skills; occupations often offer “one interpersonal skill”.
export const INTERPERSONAL = ["charm", "fastTalk", "intimidate", "persuade"];

/// A skill entry's value: the skill's base plus both kinds of points.
export function entryValue(entry: SkillEntry, characteristics: Characteristics): number {
  const definition = skillDefinition(entry.skillId);
  return (definition ? baseValue(definition.base, characteristics) : 0) + entry.occupationPoints + entry.personalPoints;
}

/// The current value of a skill: its best entry (for skills with specialties), or the base value.
export function skillValue(skills: SkillEntry[], characteristics: Characteristics, skillId: string): number {
  const values = skills.filter((s) => s.skillId === skillId).map((s) => entryValue(s, characteristics));
  if (values.length > 0) return Math.max(...values);
  const definition = skillDefinition(skillId);
  return definition ? baseValue(definition.base, characteristics) : 0;
}

/// The value a check rolls against.
export function valueForTarget(skills: SkillEntry[], characteristics: Characteristics, target: CheckTarget): number {
  return target.type === "characteristic" ? characteristics[target.characteristic] : skillValue(skills, characteristics, target.skillId);
}

// MARK: Occupations

/// How many occupation skill points an occupation grants: EDU × 4, or EDU × 2 plus twice one other characteristic.
/// When there's a choice (such as DEX or STR), the higher one is used.
export interface SkillPointFormula {
  others: Characteristic[];
}

export function formulaPoints(formula: SkillPointFormula, characteristics: Characteristics): number {
  if (formula.others.length === 0) return characteristics.education * 4;
  const best = Math.max(...formula.others.map((c) => characteristics[c]));
  return characteristics.education * 2 + best * 2;
}

/// One entry in an occupation's skill list.
export type OccupationSkill =
  /// A specific skill, optionally with a suggested specialty (an English key, translated for display).
  | { type: "skill"; id: string; specialty?: string }
  /// One of several skills, e.g. Navigate or Science.
  | { type: "oneOf"; ids: string[] }
  /// Any interpersonal skills: Charm, Fast Talk, Intimidate, or Persuade.
  | { type: "interpersonal"; count: number }
  /// Any other skills, as personal or era specialties.
  | { type: "any"; count: number };

export interface Occupation {
  id: string;
  creditRating: [number, number];
  points: SkillPointFormula;
  skills: OccupationSkill[];
}

const S = (id: string, specialty?: string): OccupationSkill => ({ type: "skill", id, specialty });
const oneOf = (...ids: string[]): OccupationSkill => ({ type: "oneOf", ids });
const interpersonal = (count: number): OccupationSkill => ({ type: "interpersonal", count });
const any = (count: number): OccupationSkill => ({ type: "any", count });
const eduTimesFour: SkillPointFormula = { others: [] };
const eduTimesTwo = (...others: Characteristic[]): SkillPointFormula => ({ others });

/// The occupations: credit rating range, skill point formula, and occupation skills.
export const OCCUPATIONS: Occupation[] = [
  { id: "accountant", creditRating: [30, 70], points: eduTimesFour, skills: [
    S("accounting"), S("law"), S("libraryUse"), S("listen"), S("persuade"), S("spotHidden"), any(2)] },
  { id: "antiquarian", creditRating: [30, 70], points: eduTimesFour, skills: [
    S("appraise"), S("artCraft"), S("history"), S("libraryUse"), S("languageOther"), interpersonal(1), S("spotHidden"), any(1)] },
  { id: "archaeologist", creditRating: [10, 40], points: eduTimesFour, skills: [
    S("appraise"), S("archaeology"), S("history"), S("languageOther"), S("libraryUse"), S("spotHidden"), S("mechanicalRepair"),
    oneOf("navigate", "science")] },
  { id: "artist", creditRating: [9, 50], points: eduTimesTwo("power", "dexterity"), skills: [
    S("artCraft"), oneOf("history", "naturalWorld"), interpersonal(1), S("languageOther"), S("psychology"), S("spotHidden"), any(2)] },
  { id: "athlete", creditRating: [9, 70], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("climb"), S("jump"), S("fightingBrawl"), S("ride"), interpersonal(1), S("swim"), S("throw"), any(1)] },
  { id: "author", creditRating: [9, 30], points: eduTimesFour, skills: [
    S("artCraft", "Literature"), S("history"), S("libraryUse"), oneOf("naturalWorld", "occult"), S("languageOther"),
    S("languageOwn"), S("psychology"), any(1)] },
  { id: "clergy", creditRating: [9, 60], points: eduTimesFour, skills: [
    S("accounting"), S("history"), S("libraryUse"), S("listen"), S("languageOther"), interpersonal(1), S("psychology"), any(1)] },
  { id: "criminal", creditRating: [5, 65], points: eduTimesTwo("dexterity", "strength"), skills: [
    oneOf("artCraft", "disguise"), S("fightingBrawl"), S("firearmsHandgun"), oneOf("locksmith", "mechanicalRepair"), S("stealth"),
    S("psychology"), S("spotHidden"), any(1)] },
  { id: "dilettante", creditRating: [50, 99], points: eduTimesTwo("appearance"), skills: [
    S("artCraft"), S("firearmsRifle"), S("languageOther"), S("ride"), interpersonal(1), any(3)] },
  { id: "doctorOfMedicine", creditRating: [30, 80], points: eduTimesFour, skills: [
    S("firstAid"), S("languageOther", "Latin"), S("medicine"), S("psychology"), S("science", "Biology"), S("science", "Pharmacy"), any(2)] },
  { id: "drifter", creditRating: [0, 5], points: eduTimesTwo("appearance", "dexterity", "strength"), skills: [
    S("climb"), S("jump"), S("listen"), S("navigate"), interpersonal(1), S("stealth"), any(2)] },
  { id: "engineer", creditRating: [30, 60], points: eduTimesFour, skills: [
    S("artCraft", "Technical Drawing"), S("electricalRepair"), S("libraryUse"), S("mechanicalRepair"), S("operateHeavyMachinery"),
    S("science", "Engineering"), S("science", "Physics"), any(1)] },
  { id: "entertainer", creditRating: [9, 70], points: eduTimesTwo("appearance"), skills: [
    S("artCraft", "Acting"), S("disguise"), interpersonal(2), S("listen"), S("psychology"), any(2)] },
  { id: "explorer", creditRating: [55, 80], points: eduTimesTwo("appearance", "dexterity", "strength"), skills: [
    oneOf("climb", "swim"), S("firearmsRifle"), S("history"), S("jump"), S("naturalWorld"), S("navigate"), S("languageOther"),
    S("survival")] },
  { id: "farmer", creditRating: [9, 30], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("artCraft", "Farming"), S("driveAuto"), interpersonal(1), S("mechanicalRepair"), S("naturalWorld"), S("operateHeavyMachinery"),
    S("track"), any(1)] },
  { id: "gentry", creditRating: [40, 90], points: eduTimesTwo("appearance"), skills: [
    S("artCraft"), interpersonal(2), S("firearmsRifle"), S("history"), S("languageOther"), S("navigate"), S("ride")] },
  { id: "hunter", creditRating: [20, 50], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("firearmsRifle"), oneOf("listen", "spotHidden"), S("naturalWorld"), S("navigate"), oneOf("languageOther", "survival"),
    S("science", "Biology"), S("stealth"), S("track")] },
  { id: "journalist", creditRating: [9, 30], points: eduTimesFour, skills: [
    S("artCraft", "Photography"), S("history"), S("libraryUse"), S("languageOwn"), interpersonal(1), S("psychology"), any(2)] },
  { id: "lawyer", creditRating: [30, 80], points: eduTimesFour, skills: [
    S("accounting"), S("law"), S("libraryUse"), interpersonal(2), S("psychology"), any(2)] },
  { id: "librarian", creditRating: [9, 35], points: eduTimesFour, skills: [
    S("accounting"), S("libraryUse"), S("languageOther"), S("languageOwn"), any(4)] },
  { id: "militaryOfficer", creditRating: [20, 70], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("accounting"), S("firearmsHandgun"), S("navigate"), S("firstAid"), interpersonal(2), S("psychology"), any(1)] },
  { id: "missionary", creditRating: [0, 30], points: eduTimesFour, skills: [
    S("artCraft"), S("firstAid"), S("mechanicalRepair"), S("medicine"), S("naturalWorld"), interpersonal(1), any(2)] },
  { id: "musician", creditRating: [9, 30], points: eduTimesTwo("dexterity", "power"), skills: [
    S("artCraft", "Instrument"), interpersonal(1), S("listen"), S("psychology"), any(4)] },
  { id: "nurse", creditRating: [9, 30], points: eduTimesFour, skills: [
    S("firstAid"), S("listen"), S("medicine"), interpersonal(1), S("psychology"), S("science", "Biology"), S("science", "Chemistry"),
    S("spotHidden")] },
  { id: "occultist", creditRating: [9, 65], points: eduTimesFour, skills: [
    S("anthropology"), S("history"), S("libraryUse"), interpersonal(1), S("occult"), S("languageOther"), S("science", "Astronomy"), any(1)] },
  { id: "parapsychologist", creditRating: [9, 30], points: eduTimesFour, skills: [
    S("anthropology"), S("artCraft", "Photography"), S("history"), S("libraryUse"), S("occult"), S("languageOther"), S("psychology"),
    any(1)] },
  { id: "photographer", creditRating: [9, 30], points: eduTimesFour, skills: [
    S("artCraft", "Photography"), interpersonal(1), S("psychology"), S("science", "Chemistry"), S("stealth"), S("spotHidden"), any(2)] },
  { id: "policeDetective", creditRating: [20, 50], points: eduTimesTwo("dexterity", "strength"), skills: [
    oneOf("artCraft", "disguise"), S("firearmsHandgun"), S("law"), S("listen"), interpersonal(1), S("psychology"), S("spotHidden"), any(1)] },
  { id: "policeOfficer", creditRating: [9, 30], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("fightingBrawl"), S("firearmsHandgun"), S("firstAid"), interpersonal(1), S("law"), S("psychology"), S("spotHidden"),
    oneOf("driveAuto", "ride")] },
  { id: "privateInvestigator", creditRating: [9, 30], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("artCraft", "Photography"), S("disguise"), S("law"), S("libraryUse"), interpersonal(1), S("psychology"), S("spotHidden"), any(1)] },
  { id: "professor", creditRating: [20, 70], points: eduTimesFour, skills: [
    S("libraryUse"), S("languageOther"), S("languageOwn"), S("psychology"), any(4)] },
  { id: "psychologist", creditRating: [10, 40], points: eduTimesFour, skills: [
    S("accounting"), S("libraryUse"), S("listen"), S("persuade"), S("psychoanalysis"), S("psychology"), any(2)] },
  { id: "sailor", creditRating: [9, 30], points: eduTimesTwo("dexterity", "strength"), skills: [
    oneOf("electricalRepair", "mechanicalRepair"), S("fightingBrawl"), S("firearmsRifle"), S("firstAid"), S("navigate"),
    S("pilot", "Boat"), S("survival", "Sea"), S("swim")] },
  { id: "scientist", creditRating: [9, 50], points: eduTimesFour, skills: [
    S("science"), S("science"), S("science"), oneOf("computerUse", "libraryUse"), S("languageOther"), S("languageOwn"),
    interpersonal(1), S("spotHidden")] },
  { id: "soldier", creditRating: [9, 30], points: eduTimesTwo("dexterity", "strength"), skills: [
    oneOf("climb", "swim"), S("dodge"), S("fightingBrawl"), S("firearmsRifle"), S("stealth"), S("survival"),
    oneOf("firstAid", "mechanicalRepair", "languageOther"), oneOf("firstAid", "mechanicalRepair", "languageOther")] },
  { id: "student", creditRating: [5, 10], points: eduTimesFour, skills: [
    oneOf("languageOwn", "languageOther"), S("libraryUse"), S("listen"), any(5)] },
  { id: "tribeMember", creditRating: [0, 15], points: eduTimesTwo("dexterity", "strength"), skills: [
    S("climb"), oneOf("fightingBrawl", "throw"), S("listen"), S("naturalWorld"), S("occult"), S("spotHidden"), S("swim"), S("survival")] },
  { id: "zealot", creditRating: [0, 30], points: eduTimesTwo("appearance", "power"), skills: [
    S("history"), interpersonal(2), S("psychology"), S("stealth"), any(3)] },
];

const occupationsById = new Map(OCCUPATIONS.map((o) => [o.id, o]));

export function occupation(id: string): Occupation | undefined {
  return occupationsById.get(id);
}

/// Characters without a listed occupation use EDU × 4 and may spend occupation points on any skill.
export const CUSTOM_POINTS: SkillPointFormula = eduTimesFour;

/// Whether points from the occupation budget can go into a skill. Occupations with “any other skill” slots allow
/// every skill.
export function allowsOccupationPoints(occupation: Occupation, skillId: string): boolean {
  if (skillId === "creditRating") return true;
  return occupation.skills.some((entry) => {
    switch (entry.type) {
      case "skill":
        return entry.id === skillId;
      case "oneOf":
        return entry.ids.includes(skillId);
      case "interpersonal":
        return INTERPERSONAL.includes(skillId);
      case "any":
        return true;
    }
  });
}

// MARK: A character's skill budget

/// The occupation skill points available: from the occupation's formula, or EDU × 4 for a custom one.
export function occupationPointBudget(character: StoryCharacter): number {
  return formulaPoints(occupation(character.occupationId)?.points ?? CUSTOM_POINTS, character.characteristics);
}

/// Personal-interest points: INT × 2.
export function personalPointBudget(character: StoryCharacter): number {
  return character.characteristics.intelligence * 2;
}

export function occupationPointsSpent(character: StoryCharacter): number {
  return character.skills.reduce((sum, s) => sum + s.occupationPoints, 0);
}

export function personalPointsSpent(character: StoryCharacter): number {
  return character.skills.reduce((sum, s) => sum + s.personalPoints, 0);
}

export function characterSkillValue(character: StoryCharacter, skillId: string): number {
  return skillValue(character.skills, character.characteristics, skillId);
}
