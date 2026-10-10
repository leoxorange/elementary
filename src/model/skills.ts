// Skills and occupations. Every story has a skill sheet and an occupation sheet; a story that hasn't made its own
// uses the built-in Call of Cthulhu catalog below. Everything the rules do with a skill comes from its sheet entry
// (its base value, group, and combat use), never from its ID, so stories can rename, add, and delete skills freely.

import { tIn } from "../i18n";
import { div } from "./rules";
import type {
  Characteristic,
  Characteristics,
  CheckTarget,
  DamageRoll,
  OccupationSlot,
  PointTerm,
  SkillBase,
  SkillCombat,
  SkillEntry,
  SkillGroup,
  Story,
  StoryCharacter,
  StoryOccupation,
  StorySkill,
  StoryText,
} from "./types";

export const SKILL_GROUPS: SkillGroup[] = ["combat", "interpersonal", "knowledge", "perception", "physical", "technical", "magic", "other"];

/// The languages built-in names are translated into.
const BUILT_IN_LANGUAGES = ["en", "zh-Hans"];

/// An English key as story text in every language the app is translated into.
function builtInText(key: string): StoryText {
  return BUILT_IN_LANGUAGES.map((language) => ({ language, value: tIn(language, key) }));
}

// MARK: The built-in catalog

const fixed = (value: number): SkillBase => ({ type: "fixed", value });
const half = (characteristic: Characteristic): SkillBase => ({ type: "characteristic", characteristic, divisor: 2 });
const whole = (characteristic: Characteristic): SkillBase => ({ type: "characteristic", characteristic, divisor: 1 });
const melee: SkillCombat = { type: "weapon", range: "melee", unarmed: null };
const ranged: SkillCombat = { type: "weapon", range: "ranged", unarmed: null };
const FISTS: DamageRoll = { count: 1, sides: 3, bonus: 0 };

interface BuiltInSkill {
  id: string;
  name: string;
  group: SkillGroup;
  base: SkillBase;
  symbol: string;
  specialty?: boolean;
  uncommon?: boolean;
  combat?: SkillCombat;
}

const B = (id: string, name: string, group: SkillGroup, base: SkillBase, symbol: string, extra: Partial<BuiltInSkill> = {}): BuiltInSkill => ({
  id,
  name,
  group,
  base,
  symbol,
  ...extra,
});

/// Every built-in skill, in sheet order. Fighting and Firearms are split by weapon because each has its own base.
const BUILT_IN_SKILLS: BuiltInSkill[] = [
  B("accounting", "Accounting", "knowledge", fixed(5), "chart.bar"),
  B("anthropology", "Anthropology", "knowledge", fixed(1), "person.3"),
  B("appraise", "Appraise", "knowledge", fixed(5), "magnifyingglass"),
  B("archaeology", "Archaeology", "knowledge", fixed(1), "shovel"),
  B("artCraft", "Art/Craft", "other", fixed(5), "paintpalette", { specialty: true }),
  B("charm", "Charm", "interpersonal", fixed(15), "heart"),
  B("climb", "Climb", "physical", fixed(20), "mountain.2"),
  B("computerUse", "Computer Use", "technical", fixed(5), "desktopcomputer"),
  B("creditRating", "Credit Rating", "other", fixed(0), "banknote"),
  B("mythos", "Mythos", "magic", fixed(0), "eye.trianglebadge.exclamationmark"),
  B("disguise", "Disguise", "other", fixed(5), "theatermasks"),
  B("dodge", "Dodge", "combat", half("dexterity"), "figure.walk.motion", { combat: { type: "dodge" } }),
  B("driveAuto", "Drive Auto", "technical", fixed(20), "car.fill"),
  B("electricalRepair", "Electrical Repair", "technical", fixed(10), "powerplug"),
  B("electronics", "Electronics", "technical", fixed(1), "cpu"),
  B("fastTalk", "Fast Talk", "interpersonal", fixed(5), "bubble.left.and.bubble.right"),
  B("fightingBrawl", "Fighting (Brawl)", "combat", fixed(25), "figure.boxing", { combat: { type: "weapon", range: "melee", unarmed: FISTS } }),
  B("fightingAxe", "Fighting (Axe)", "combat", fixed(15), "axe", { uncommon: true, combat: melee }),
  B("fightingChainsaw", "Fighting (Chainsaw)", "combat", fixed(10), "wrench.and.screwdriver", { uncommon: true, combat: melee }),
  B("fightingFlail", "Fighting (Flail)", "combat", fixed(10), "hammer", { uncommon: true, combat: melee }),
  B("fightingGarrote", "Fighting (Garrote)", "combat", fixed(15), "link", { uncommon: true, combat: melee }),
  B("fightingSpear", "Fighting (Spear)", "combat", fixed(20), "signpost.right", { uncommon: true, combat: melee }),
  B("fightingSword", "Fighting (Sword)", "combat", fixed(20), "sword", { uncommon: true, combat: melee }),
  B("fightingWhip", "Fighting (Whip)", "combat", fixed(5), "wind", { uncommon: true, combat: melee }),
  B("firearmsHandgun", "Firearms (Handgun)", "combat", fixed(20), "target", { combat: ranged }),
  B("firearmsRifle", "Firearms (Rifle/Shotgun)", "combat", fixed(25), "scope", { combat: ranged }),
  B("firearmsBow", "Firearms (Bow)", "combat", fixed(15), "figure.archery", { uncommon: true, combat: ranged }),
  B("firearmsFlamethrower", "Firearms (Flamethrower)", "combat", fixed(10), "flame", { uncommon: true, combat: ranged }),
  B("firearmsHeavyWeapons", "Firearms (Heavy Weapons)", "combat", fixed(10), "bolt.shield", { uncommon: true, combat: ranged }),
  B("firearmsMachineGun", "Firearms (Machine Gun)", "combat", fixed(10), "target", { uncommon: true, combat: ranged }),
  B("firearmsSubmachineGun", "Firearms (Submachine Gun)", "combat", fixed(15), "target", { uncommon: true, combat: ranged }),
  B("firstAid", "First Aid", "knowledge", fixed(30), "cross.case.fill"),
  B("history", "History", "knowledge", fixed(5), "books.vertical"),
  B("intimidate", "Intimidate", "interpersonal", fixed(15), "megaphone"),
  B("jump", "Jump", "physical", fixed(20), "figure.run"),
  B("languageOther", "Language (Other)", "knowledge", fixed(1), "globe", { specialty: true }),
  B("languageOwn", "Language (Own)", "knowledge", whole("education"), "text.quote", { specialty: true }),
  B("law", "Law", "knowledge", fixed(5), "gavel"),
  B("libraryUse", "Library Use", "knowledge", fixed(20), "books.vertical"),
  B("listen", "Listen", "perception", fixed(20), "ear"),
  B("locksmith", "Locksmith", "technical", fixed(1), "key"),
  B("mechanicalRepair", "Mechanical Repair", "technical", fixed(10), "wrench"),
  B("medicine", "Medicine", "knowledge", fixed(1), "stethoscope"),
  B("naturalWorld", "Natural World", "knowledge", fixed(10), "leaf"),
  B("navigate", "Navigate", "perception", fixed(10), "compass.drawing"),
  B("occult", "Occult", "knowledge", fixed(5), "moon.stars"),
  B("operateHeavyMachinery", "Operate Heavy Machinery", "technical", fixed(1), "gauge"),
  B("persuade", "Persuade", "interpersonal", fixed(10), "hand.raised"),
  B("pilot", "Pilot", "technical", fixed(1), "airplane", { specialty: true }),
  B("psychoanalysis", "Psychoanalysis", "knowledge", fixed(1), "brain"),
  B("psychology", "Psychology", "perception", fixed(10), "brain.head.profile"),
  B("ride", "Ride", "physical", fixed(5), "hare"),
  B("science", "Science", "knowledge", fixed(1), "atom", { specialty: true }),
  B("sleightOfHand", "Sleight of Hand", "physical", fixed(10), "hand.tap"),
  B("spotHidden", "Spot Hidden", "perception", fixed(25), "eye"),
  B("stealth", "Stealth", "physical", fixed(20), "shoeprints.fill"),
  B("survival", "Survival", "physical", fixed(10), "tent", { specialty: true }),
  B("swim", "Swim", "physical", fixed(20), "water.waves"),
  B("throw", "Throw", "physical", fixed(20), "figure.wave"),
  B("track", "Track", "perception", fixed(10), "pawprint"),
  B("animalHandling", "Animal Handling", "other", fixed(5), "dog", { uncommon: true }),
  B("artillery", "Artillery", "combat", fixed(1), "scope", { uncommon: true }),
  B("demolitions", "Demolitions", "technical", fixed(1), "flame.circle", { uncommon: true }),
  B("diving", "Diving", "physical", fixed(1), "drop.triangle", { uncommon: true }),
  B("hypnosis", "Hypnosis", "interpersonal", fixed(1), "eye.circle", { uncommon: true }),
  B("lore", "Lore", "knowledge", fixed(1), "scroll", { specialty: true, uncommon: true }),
  B("readLips", "Read Lips", "perception", fixed(1), "mouth", { uncommon: true }),
];

/// The built-in skills as sheet entries, named in every language the app has.
export function builtInSkills(): StorySkill[] {
  return BUILT_IN_SKILLS.map((s) => ({
    id: s.id,
    name: builtInText(s.name),
    detail: [],
    symbol: s.symbol,
    group: s.group,
    base: s.base,
    takesSpecialty: s.specialty ?? false,
    isUncommon: s.uncommon ?? false,
    // Cthulhu Mythos is only ever learned in play.
    atCreation: s.id !== "mythos",
    isWealth: s.id === "creditRating",
    combat: s.combat ?? { type: "none" },
  }));
}

const S = (skillId: string, specialty?: string): OccupationSlot => ({ type: "skill", skillId, specialty: specialty ? builtInText(specialty) : [] });
const oneOf = (...skillIds: string[]): OccupationSlot => ({ type: "oneOf", skillIds });
const interpersonal = (count: number): OccupationSlot => ({ type: "group", group: "interpersonal", count });
const any = (count: number): OccupationSlot => ({ type: "any", count });
const eduTimesFour: PointTerm[] = [{ characteristics: ["education"], multiplier: 4 }];
const eduTimesTwo = (...others: Characteristic[]): PointTerm[] => [
  { characteristics: ["education"], multiplier: 2 },
  { characteristics: others, multiplier: 2 },
];

interface BuiltInOccupation {
  id: string;
  name: string;
  symbol: string;
  wealth: [number, number];
  points: PointTerm[];
  slots: OccupationSlot[];
}

/// The built-in occupations: credit rating range, skill point formula, and occupation skills.
const BUILT_IN_OCCUPATIONS: BuiltInOccupation[] = [
  { id: "accountant", name: "Accountant", symbol: "chart.bar", wealth: [30, 70], points: eduTimesFour, slots: [
    S("accounting"), S("law"), S("libraryUse"), S("listen"), S("persuade"), S("spotHidden"), any(2)] },
  { id: "antiquarian", name: "Antiquarian", symbol: "scroll", wealth: [30, 70], points: eduTimesFour, slots: [
    S("appraise"), S("artCraft"), S("history"), S("libraryUse"), S("languageOther"), interpersonal(1), S("spotHidden"), any(1)] },
  { id: "archaeologist", name: "Archaeologist", symbol: "shovel", wealth: [10, 40], points: eduTimesFour, slots: [
    S("appraise"), S("archaeology"), S("history"), S("languageOther"), S("libraryUse"), S("spotHidden"), S("mechanicalRepair"),
    oneOf("navigate", "science")] },
  { id: "artist", name: "Artist", symbol: "paintbrush", wealth: [9, 50], points: eduTimesTwo("power", "dexterity"), slots: [
    S("artCraft"), oneOf("history", "naturalWorld"), interpersonal(1), S("languageOther"), S("psychology"), S("spotHidden"), any(2)] },
  { id: "athlete", name: "Athlete", symbol: "figure.run", wealth: [9, 70], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("climb"), S("jump"), S("fightingBrawl"), S("ride"), interpersonal(1), S("swim"), S("throw"), any(1)] },
  { id: "author", name: "Author", symbol: "text.book.closed", wealth: [9, 30], points: eduTimesFour, slots: [
    S("artCraft", "Literature"), S("history"), S("libraryUse"), oneOf("naturalWorld", "occult"), S("languageOther"),
    S("languageOwn"), S("psychology"), any(1)] },
  { id: "clergy", name: "Clergy", symbol: "book.closed", wealth: [9, 60], points: eduTimesFour, slots: [
    S("accounting"), S("history"), S("libraryUse"), S("listen"), S("languageOther"), interpersonal(1), S("psychology"), any(1)] },
  { id: "criminal", name: "Criminal", symbol: "fingerprint", wealth: [5, 65], points: eduTimesTwo("dexterity", "strength"), slots: [
    oneOf("artCraft", "disguise"), S("fightingBrawl"), S("firearmsHandgun"), oneOf("locksmith", "mechanicalRepair"), S("stealth"),
    S("psychology"), S("spotHidden"), any(1)] },
  { id: "dilettante", name: "Dilettante", symbol: "wineglass", wealth: [50, 99], points: eduTimesTwo("appearance"), slots: [
    S("artCraft"), S("firearmsRifle"), S("languageOther"), S("ride"), interpersonal(1), any(3)] },
  { id: "doctorOfMedicine", name: "Doctor of Medicine", symbol: "stethoscope", wealth: [30, 80], points: eduTimesFour, slots: [
    S("firstAid"), S("languageOther", "Latin"), S("medicine"), S("psychology"), S("science", "Biology"), S("science", "Pharmacy"), any(2)] },
  { id: "drifter", name: "Drifter", symbol: "figure.walk", wealth: [0, 5], points: eduTimesTwo("appearance", "dexterity", "strength"), slots: [
    S("climb"), S("jump"), S("listen"), S("navigate"), interpersonal(1), S("stealth"), any(2)] },
  { id: "engineer", name: "Engineer", symbol: "wrench.and.screwdriver", wealth: [30, 60], points: eduTimesFour, slots: [
    S("artCraft", "Technical Drawing"), S("electricalRepair"), S("libraryUse"), S("mechanicalRepair"), S("operateHeavyMachinery"),
    S("science", "Engineering"), S("science", "Physics"), any(1)] },
  { id: "entertainer", name: "Entertainer", symbol: "theatermasks", wealth: [9, 70], points: eduTimesTwo("appearance"), slots: [
    S("artCraft", "Acting"), S("disguise"), interpersonal(2), S("listen"), S("psychology"), any(2)] },
  { id: "explorer", name: "Explorer", symbol: "compass.drawing", wealth: [55, 80], points: eduTimesTwo("appearance", "dexterity", "strength"), slots: [
    oneOf("climb", "swim"), S("firearmsRifle"), S("history"), S("jump"), S("naturalWorld"), S("navigate"), S("languageOther"),
    S("survival")] },
  { id: "farmer", name: "Farmer", symbol: "carrot", wealth: [9, 30], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("artCraft", "Farming"), S("driveAuto"), interpersonal(1), S("mechanicalRepair"), S("naturalWorld"), S("operateHeavyMachinery"),
    S("track"), any(1)] },
  { id: "gentry", name: "Gentleman/Lady", symbol: "crown", wealth: [40, 90], points: eduTimesTwo("appearance"), slots: [
    S("artCraft"), interpersonal(2), S("firearmsRifle"), S("history"), S("languageOther"), S("navigate"), S("ride")] },
  { id: "hunter", name: "Big Game Hunter", symbol: "scope", wealth: [20, 50], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("firearmsRifle"), oneOf("listen", "spotHidden"), S("naturalWorld"), S("navigate"), oneOf("languageOther", "survival"),
    S("science", "Biology"), S("stealth"), S("track")] },
  { id: "journalist", name: "Journalist", symbol: "newspaper", wealth: [9, 30], points: eduTimesFour, slots: [
    S("artCraft", "Photography"), S("history"), S("libraryUse"), S("languageOwn"), interpersonal(1), S("psychology"), any(2)] },
  { id: "lawyer", name: "Lawyer", symbol: "gavel", wealth: [30, 80], points: eduTimesFour, slots: [
    S("accounting"), S("law"), S("libraryUse"), interpersonal(2), S("psychology"), any(2)] },
  { id: "librarian", name: "Librarian", symbol: "books.vertical", wealth: [9, 35], points: eduTimesFour, slots: [
    S("accounting"), S("libraryUse"), S("languageOther"), S("languageOwn"), any(4)] },
  { id: "militaryOfficer", name: "Military Officer", symbol: "medal", wealth: [20, 70], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("accounting"), S("firearmsHandgun"), S("navigate"), S("firstAid"), interpersonal(2), S("psychology"), any(1)] },
  { id: "missionary", name: "Missionary", symbol: "cross", wealth: [0, 30], points: eduTimesFour, slots: [
    S("artCraft"), S("firstAid"), S("mechanicalRepair"), S("medicine"), S("naturalWorld"), interpersonal(1), any(2)] },
  { id: "musician", name: "Musician", symbol: "guitars", wealth: [9, 30], points: eduTimesTwo("dexterity", "power"), slots: [
    S("artCraft", "Instrument"), interpersonal(1), S("listen"), S("psychology"), any(4)] },
  { id: "nurse", name: "Nurse", symbol: "cross.case.fill", wealth: [9, 30], points: eduTimesFour, slots: [
    S("firstAid"), S("listen"), S("medicine"), interpersonal(1), S("psychology"), S("science", "Biology"), S("science", "Chemistry"),
    S("spotHidden")] },
  { id: "occultist", name: "Occultist", symbol: "moon.stars", wealth: [9, 65], points: eduTimesFour, slots: [
    S("anthropology"), S("history"), S("libraryUse"), interpersonal(1), S("occult"), S("languageOther"), S("science", "Astronomy"), any(1)] },
  { id: "parapsychologist", name: "Parapsychologist", symbol: "ghost", wealth: [9, 30], points: eduTimesFour, slots: [
    S("anthropology"), S("artCraft", "Photography"), S("history"), S("libraryUse"), S("occult"), S("languageOther"), S("psychology"),
    any(1)] },
  { id: "photographer", name: "Photographer", symbol: "camera", wealth: [9, 30], points: eduTimesFour, slots: [
    S("artCraft", "Photography"), interpersonal(1), S("psychology"), S("science", "Chemistry"), S("stealth"), S("spotHidden"), any(2)] },
  { id: "policeDetective", name: "Police Detective", symbol: "magnifyingglass", wealth: [20, 50], points: eduTimesTwo("dexterity", "strength"), slots: [
    oneOf("artCraft", "disguise"), S("firearmsHandgun"), S("law"), S("listen"), interpersonal(1), S("psychology"), S("spotHidden"), any(1)] },
  { id: "policeOfficer", name: "Police Officer", symbol: "shield", wealth: [9, 30], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("fightingBrawl"), S("firearmsHandgun"), S("firstAid"), interpersonal(1), S("law"), S("psychology"), S("spotHidden"),
    oneOf("driveAuto", "ride")] },
  { id: "privateInvestigator", name: "Private Investigator", symbol: "binoculars", wealth: [9, 30], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("artCraft", "Photography"), S("disguise"), S("law"), S("libraryUse"), interpersonal(1), S("psychology"), S("spotHidden"), any(1)] },
  { id: "professor", name: "Professor", symbol: "graduationcap", wealth: [20, 70], points: eduTimesFour, slots: [
    S("libraryUse"), S("languageOther"), S("languageOwn"), S("psychology"), any(4)] },
  { id: "psychologist", name: "Psychologist", symbol: "brain", wealth: [10, 40], points: eduTimesFour, slots: [
    S("accounting"), S("libraryUse"), S("listen"), S("persuade"), S("psychoanalysis"), S("psychology"), any(2)] },
  { id: "sailor", name: "Sailor", symbol: "anchor", wealth: [9, 30], points: eduTimesTwo("dexterity", "strength"), slots: [
    oneOf("electricalRepair", "mechanicalRepair"), S("fightingBrawl"), S("firearmsRifle"), S("firstAid"), S("navigate"),
    S("pilot", "Boat"), S("survival", "Sea"), S("swim")] },
  { id: "scientist", name: "Scientist", symbol: "flask", wealth: [9, 50], points: eduTimesFour, slots: [
    S("science"), S("science"), S("science"), oneOf("computerUse", "libraryUse"), S("languageOther"), S("languageOwn"),
    interpersonal(1), S("spotHidden")] },
  { id: "soldier", name: "Soldier", symbol: "shield.fill", wealth: [9, 30], points: eduTimesTwo("dexterity", "strength"), slots: [
    oneOf("climb", "swim"), S("dodge"), S("fightingBrawl"), S("firearmsRifle"), S("stealth"), S("survival"),
    oneOf("firstAid", "mechanicalRepair", "languageOther"), oneOf("firstAid", "mechanicalRepair", "languageOther")] },
  { id: "student", name: "Student", symbol: "graduationcap", wealth: [5, 10], points: eduTimesFour, slots: [
    oneOf("languageOwn", "languageOther"), S("libraryUse"), S("listen"), any(5)] },
  { id: "tribeMember", name: "Tribe Member", symbol: "tent", wealth: [0, 15], points: eduTimesTwo("dexterity", "strength"), slots: [
    S("climb"), oneOf("fightingBrawl", "throw"), S("listen"), S("naturalWorld"), S("occult"), S("spotHidden"), S("swim"), S("survival")] },
  { id: "zealot", name: "Zealot", symbol: "flame", wealth: [0, 30], points: eduTimesTwo("appearance", "power"), slots: [
    S("history"), interpersonal(2), S("psychology"), S("stealth"), any(3)] },
];

export function builtInOccupations(): StoryOccupation[] {
  return BUILT_IN_OCCUPATIONS.map((o) => ({
    id: o.id,
    name: builtInText(o.name),
    detail: [],
    symbol: o.symbol,
    wealth: [...o.wealth],
    points: structuredClone(o.points),
    slots: structuredClone(o.slots),
  }));
}

// MARK: A story's catalog

/// A story's skills and occupations, looked up by ID.
export interface SkillCatalog {
  skills: StorySkill[];
  occupations: StoryOccupation[];
  /// Whether the story uses the built-in skill and occupation sheets rather than its own.
  isBuiltIn: { skills: boolean; occupations: boolean };
  skill(id: string): StorySkill | undefined;
  occupation(id: string): StoryOccupation | undefined;
}

function makeCatalog(skills: StorySkill[], occupations: StoryOccupation[], isBuiltIn: SkillCatalog["isBuiltIn"]): SkillCatalog {
  const skillsById = new Map(skills.map((s) => [s.id, s]));
  const occupationsById = new Map(occupations.map((o) => [o.id, o]));
  return {
    skills,
    occupations,
    isBuiltIn,
    skill: (id) => skillsById.get(id),
    occupation: (id) => occupationsById.get(id),
  };
}

let builtInSkillList: StorySkill[] | undefined;
let builtInOccupationList: StoryOccupation[] | undefined;
const catalogs = new WeakMap<Story, SkillCatalog>();

/// The story's catalog: its own sheets where it has them, the built-in ones otherwise.
export function catalogOf(story: Pick<Story, "skills" | "occupations">): SkillCatalog {
  const cached = catalogs.get(story as Story);
  if (cached) return cached;
  builtInSkillList ??= builtInSkills();
  builtInOccupationList ??= builtInOccupations();
  const catalog = makeCatalog(story.skills ?? builtInSkillList, story.occupations ?? builtInOccupationList, {
    skills: story.skills === null,
    occupations: story.occupations === null,
  });
  catalogs.set(story as Story, catalog);
  return catalog;
}

// MARK: Values

export function baseValue(base: SkillBase, characteristics: Characteristics): number {
  return base.type === "fixed" ? base.value : div(characteristics[base.characteristic], Math.max(1, base.divisor));
}

export function skillBase(catalog: SkillCatalog, skillId: string, characteristics: Characteristics): number {
  const skill = catalog.skill(skillId);
  return skill ? baseValue(skill.base, characteristics) : 0;
}

/// A skill entry's value: the skill's base plus both kinds of points.
export function entryValue(catalog: SkillCatalog, entry: SkillEntry, characteristics: Characteristics): number {
  return skillBase(catalog, entry.skillId, characteristics) + entry.occupationPoints + entry.personalPoints;
}

/// The current value of a skill: its best entry (for skills with specialties), or the base value.
export function skillValue(catalog: SkillCatalog, skills: SkillEntry[], characteristics: Characteristics, skillId: string): number {
  const values = skills.filter((s) => s.skillId === skillId).map((s) => entryValue(catalog, s, characteristics));
  return values.length > 0 ? Math.max(...values) : skillBase(catalog, skillId, characteristics);
}

/// The value a check rolls against.
export function valueForTarget(catalog: SkillCatalog, skills: SkillEntry[], characteristics: Characteristics, target: CheckTarget): number {
  return target.type === "characteristic" ? characteristics[target.characteristic] : skillValue(catalog, skills, characteristics, target.skillId);
}

export function characterSkillValue(catalog: SkillCatalog, character: Pick<StoryCharacter, "skills" | "characteristics">, skillId: string): number {
  return skillValue(catalog, character.skills, character.characteristics, skillId);
}

// MARK: Combat uses

export function weaponRange(catalog: SkillCatalog, skillId: string): "melee" | "ranged" | undefined {
  const combat = catalog.skill(skillId)?.combat;
  return combat?.type === "weapon" ? combat.range : undefined;
}

/// Skills a character can fight with bare-handed, with the damage each does.
export function unarmedSkills(catalog: SkillCatalog): { skill: StorySkill; damage: DamageRoll }[] {
  return catalog.skills.flatMap((skill) => (skill.combat.type === "weapon" && skill.combat.unarmed ? [{ skill, damage: skill.combat.unarmed }] : []));
}

export function dodgeSkills(catalog: SkillCatalog): StorySkill[] {
  return catalog.skills.filter((s) => s.combat.type === "dodge");
}

/// The better of a character's dodge skills, or 0 when the story has none.
export function dodgeValue(catalog: SkillCatalog, character: Pick<StoryCharacter, "skills" | "characteristics">): number {
  return Math.max(0, ...dodgeSkills(catalog).map((s) => characterSkillValue(catalog, character, s.id)));
}

/// The story's wealth skill (Credit Rating), whose range each occupation sets.
export function wealthSkill(catalog: SkillCatalog): StorySkill | undefined {
  return catalog.skills.find((s) => s.isWealth);
}

// MARK: Occupations

/// Characters without an occupation from the sheet earn EDU × 4 occupation points, which can go into any skill.
export const CUSTOM_POINTS: PointTerm[] = [{ characteristics: ["education"], multiplier: 4 }];

/// Occupation skill points from a formula: each term's best characteristic times its multiplier, added up.
export function formulaPoints(terms: PointTerm[], characteristics: Characteristics): number {
  return terms.reduce((sum, term) => sum + Math.max(0, ...term.characteristics.map((c) => characteristics[c])) * term.multiplier, 0);
}

/// Skills in a group, in sheet order.
export function skillsInGroup(catalog: SkillCatalog, group: SkillGroup): StorySkill[] {
  return catalog.skills.filter((s) => s.group === group);
}

/// Whether points from the occupation budget can go into a skill. The wealth skill always can, and occupations
/// with “any skill” slots allow every skill.
export function allowsOccupationPoints(catalog: SkillCatalog, occupation: StoryOccupation, skillId: string): boolean {
  if (catalog.skill(skillId)?.isWealth) return true;
  return occupation.slots.some((slot) => {
    switch (slot.type) {
      case "skill":
        return slot.skillId === skillId;
      case "oneOf":
        return slot.skillIds.includes(skillId);
      case "group":
        return catalog.skill(skillId)?.group === slot.group;
      case "any":
        return true;
    }
  });
}

/// The skills an occupation names, in order: its own skills, the choices it offers, and the members of its groups,
/// followed by the wealth skill. “Any skill” slots aren't listed; they open every skill instead.
export function occupationSkillIds(catalog: SkillCatalog, occupation: StoryOccupation): string[] {
  const ids: string[] = [];
  const add = (id: string) => void (catalog.skill(id) && !ids.includes(id) && ids.push(id));
  for (const slot of occupation.slots) {
    if (slot.type === "skill") add(slot.skillId);
    else if (slot.type === "oneOf") slot.skillIds.forEach(add);
    else if (slot.type === "group") skillsInGroup(catalog, slot.group).filter((s) => !s.isUncommon).forEach((s) => add(s.id));
  }
  const wealth = wealthSkill(catalog);
  if (wealth) add(wealth.id);
  return ids;
}

// MARK: A character's skill budget

/// The occupation skill points available: from the occupation's formula, or EDU × 4 without one.
export function occupationPointBudget(catalog: SkillCatalog, character: StoryCharacter): number {
  return formulaPoints(catalog.occupation(character.occupationId)?.points ?? CUSTOM_POINTS, character.characteristics);
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
