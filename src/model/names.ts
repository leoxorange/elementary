// Display names for the rules types. The rules carry no interface strings, so the names are added here.

import { t } from "../i18n";
import { SuccessLevel } from "./rules";
import { skillDefinition } from "./skills";
import type {
  Characteristic,
  CheckDifficulty,
  CheckTarget,
  Comparison,
  EventTrigger,
  ItemCategory,
  Occurrence,
  Outcome,
  TriggerMode,
} from "./types";

const CHARACTERISTIC_NAMES: Record<Characteristic, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  size: "Size",
  appearance: "Appearance",
  constitution: "Constitution",
  intelligence: "Intelligence",
  power: "Power",
  education: "Education",
  luck: "Luck",
};

/// The full name, e.g. Strength. Abbreviations stay as STR, DEX, … in every language.
export function characteristicName(characteristic: Characteristic): string {
  return t(CHARACTERISTIC_NAMES[characteristic]);
}

export function difficultyName(difficulty: CheckDifficulty): string {
  return t({ regular: "Regular", hard: "Hard", extreme: "Extreme" }[difficulty]);
}

export function successLevelName(level: SuccessLevel): string {
  switch (level) {
    case SuccessLevel.Fumble:
      return t("Fumble");
    case SuccessLevel.Failure:
      return t("Failure");
    case SuccessLevel.Regular:
      return t("Regular success");
    case SuccessLevel.Hard:
      return t("Hard success");
    case SuccessLevel.Extreme:
      return t("Extreme success");
    case SuccessLevel.Critical:
      return t("Critical success");
  }
}

const SKILL_NAMES: Record<string, string> = {
  accounting: "Accounting",
  anthropology: "Anthropology",
  appraise: "Appraise",
  archaeology: "Archaeology",
  artCraft: "Art/Craft",
  charm: "Charm",
  climb: "Climb",
  computerUse: "Computer Use",
  creditRating: "Credit Rating",
  mythos: "Mythos",
  disguise: "Disguise",
  dodge: "Dodge",
  driveAuto: "Drive Auto",
  electricalRepair: "Electrical Repair",
  electronics: "Electronics",
  fastTalk: "Fast Talk",
  fightingBrawl: "Fighting (Brawl)",
  fightingAxe: "Fighting (Axe)",
  fightingChainsaw: "Fighting (Chainsaw)",
  fightingFlail: "Fighting (Flail)",
  fightingGarrote: "Fighting (Garrote)",
  fightingSpear: "Fighting (Spear)",
  fightingSword: "Fighting (Sword)",
  fightingWhip: "Fighting (Whip)",
  firearmsHandgun: "Firearms (Handgun)",
  firearmsRifle: "Firearms (Rifle/Shotgun)",
  firearmsBow: "Firearms (Bow)",
  firearmsFlamethrower: "Firearms (Flamethrower)",
  firearmsHeavyWeapons: "Firearms (Heavy Weapons)",
  firearmsMachineGun: "Firearms (Machine Gun)",
  firearmsSubmachineGun: "Firearms (Submachine Gun)",
  firstAid: "First Aid",
  history: "History",
  intimidate: "Intimidate",
  jump: "Jump",
  languageOther: "Language (Other)",
  languageOwn: "Language (Own)",
  law: "Law",
  libraryUse: "Library Use",
  listen: "Listen",
  locksmith: "Locksmith",
  mechanicalRepair: "Mechanical Repair",
  medicine: "Medicine",
  naturalWorld: "Natural World",
  navigate: "Navigate",
  occult: "Occult",
  operateHeavyMachinery: "Operate Heavy Machinery",
  persuade: "Persuade",
  pilot: "Pilot",
  psychoanalysis: "Psychoanalysis",
  psychology: "Psychology",
  ride: "Ride",
  science: "Science",
  sleightOfHand: "Sleight of Hand",
  spotHidden: "Spot Hidden",
  stealth: "Stealth",
  survival: "Survival",
  swim: "Swim",
  throw: "Throw",
  track: "Track",
  animalHandling: "Animal Handling",
  artillery: "Artillery",
  demolitions: "Demolitions",
  diving: "Diving",
  hypnosis: "Hypnosis",
  lore: "Lore",
  readLips: "Read Lips",
};

export function skillName(id: string): string {
  const name = SKILL_NAMES[id];
  return name ? t(name) : id;
}

/// Suggested specialties named by occupations are English keys, translated for display and for new skill entries.
export function specialtyName(key: string): string {
  return t(key);
}

const OCCUPATION_NAMES: Record<string, string> = {
  accountant: "Accountant",
  antiquarian: "Antiquarian",
  archaeologist: "Archaeologist",
  artist: "Artist",
  athlete: "Athlete",
  author: "Author",
  clergy: "Clergy",
  criminal: "Criminal",
  dilettante: "Dilettante",
  doctorOfMedicine: "Doctor of Medicine",
  drifter: "Drifter",
  engineer: "Engineer",
  entertainer: "Entertainer",
  explorer: "Explorer",
  farmer: "Farmer",
  gentry: "Gentleman/Lady",
  hunter: "Big Game Hunter",
  journalist: "Journalist",
  lawyer: "Lawyer",
  librarian: "Librarian",
  militaryOfficer: "Military Officer",
  missionary: "Missionary",
  musician: "Musician",
  nurse: "Nurse",
  occultist: "Occultist",
  parapsychologist: "Parapsychologist",
  photographer: "Photographer",
  policeDetective: "Police Detective",
  policeOfficer: "Police Officer",
  privateInvestigator: "Private Investigator",
  professor: "Professor",
  psychologist: "Psychologist",
  sailor: "Sailor",
  scientist: "Scientist",
  soldier: "Soldier",
  student: "Student",
  tribeMember: "Tribe Member",
  zealot: "Zealot",
};

export function occupationName(id: string): string {
  const name = OCCUPATION_NAMES[id];
  return name ? t(name) : id;
}

/// The characteristic's or skill's name, e.g. Dexterity or Spot Hidden.
export function checkTargetName(target: CheckTarget): string {
  if (target.type === "characteristic") return characteristicName(target.characteristic);
  return skillDefinition(target.skillId) ? skillName(target.skillId) : target.skillId;
}

/// The times of day, in order.
export const PHASE_KEYS = ["Dawn", "Morning", "Midday", "Dusk", "Nightfall"];

export function phaseName(index: number): string {
  return t(PHASE_KEYS[((index % PHASE_KEYS.length) + PHASE_KEYS.length) % PHASE_KEYS.length]);
}

/// A time trigger's window, e.g. “days 2–4 · Dusk, Nightfall”.
export function timeWindowSummary(trigger: EventTrigger): string {
  const { earliestDay: from, latestDay: until } = trigger;
  const parts: string[] = [];
  if (from > 0 && until > 0) parts.push(from === until ? t("day %lld", from) : t("days %lld–%lld", from, until));
  else if (from > 0) parts.push(t("from day %lld", from));
  else if (until > 0) parts.push(t("until day %lld", until));
  if (trigger.phases.length === 0) parts.push(t("never"));
  else if (trigger.phases.length < PHASE_KEYS.length) parts.push([...trigger.phases].sort((a, b) => a - b).map(phaseName).join(t(", ")));
  return parts.length === 0 ? t("any time") : parts.join(" · ");
}

export function occurrenceName(occurrence: Occurrence): string {
  return t(occurrence === "eventually" ? "Eventually" : "Perhaps");
}

export function triggerModeName(mode: TriggerMode): string {
  return t({ chance: "Chance", characteristics: "Characteristics", priorEvent: "Prior event", time: "Time" }[mode]);
}

export function comparisonName(comparison: Comparison): string {
  return t(comparison);
}

/// The symbol shown in condition summaries, the same in every language.
export function comparisonSymbol(comparison: Comparison): string {
  return comparison === "over" ? ">" : "<";
}

export function categoryName(category: ItemCategory): string {
  return t({ weapon: "Weapon", armor: "Armor", trinket: "Trinket", key: "Key item" }[category]);
}

export const CATEGORY_SYMBOLS: Record<ItemCategory, string> = {
  weapon: "wand.and.sparkles",
  armor: "shield",
  trinket: "diamond",
  key: "key",
};

export function outcomeName(outcome: Outcome): string {
  return t({ triumph: "Triumph", neutral: "Neutral", tragedy: "Tragedy" }[outcome]);
}
