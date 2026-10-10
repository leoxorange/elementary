// Display names for the rules types. The rules carry no interface strings, so the names are added here.

import { t } from "../i18n";
import { ABBREVIATIONS, SuccessLevel } from "./rules";
import { skillsInGroup, type SkillCatalog } from "./skills";
import { isBlank, resolve } from "./storyText";
import type {
  Characteristic,
  CheckDifficulty,
  CheckTarget,
  Comparison,
  EventTrigger,
  ItemCategory,
  Occurrence,
  Outcome,
  PointTerm,
  SkillGroup,
  StoryOccupation,
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

/// A skill's name from the story's sheet, or its ID when the sheet has no such skill.
export function skillName(catalog: SkillCatalog, id: string, language: string): string {
  const skill = catalog.skill(id);
  return skill ? resolve(skill.name, language) || id : id;
}

export function occupationName(catalog: SkillCatalog, id: string, language: string): string {
  const occupation = catalog.occupation(id);
  return occupation ? resolve(occupation.name, language) || id : id;
}

export function groupName(group: SkillGroup): string {
  return t(
    {
      combat: "Combat",
      interpersonal: "Interpersonal",
      knowledge: "Knowledge",
      perception: "Perception",
      physical: "Physical",
      technical: "Technical",
      magic: "Magic",
      other: "Other",
    }[group],
  );
}

/// The characteristic's or skill's name, e.g. Dexterity or Spot Hidden.
export function checkTargetName(catalog: SkillCatalog, target: CheckTarget, language: string): string {
  if (target.type === "characteristic") return characteristicName(target.characteristic);
  return skillName(catalog, target.skillId, language);
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

// MARK: Occupations

/// An occupation's skill point formula, e.g. “EDU × 2 + DEX/STR × 2”.
export function formulaText(terms: PointTerm[]): string {
  if (terms.length === 0) return "0";
  return terms.map((term) => `${term.characteristics.map((c) => ABBREVIATIONS[c]).join("/") || "?"} × ${term.multiplier}`).join(" + ");
}

/// An occupation's skill list, e.g. “Accounting, Law, 1 Interpersonal (Charm, Fast Talk, …), 2 other skills of your choice”.
export function occupationSkillsText(catalog: SkillCatalog, occupation: StoryOccupation, language: string): string {
  return occupation.slots
    .map((slot) => {
      switch (slot.type) {
        case "skill": {
          const name = skillName(catalog, slot.skillId, language);
          return isBlank(slot.specialty) ? name : `${name} (${resolve(slot.specialty, language)})`;
        }
        case "oneOf":
          return slot.skillIds.map((id) => skillName(catalog, id, language)).join(t(" or "));
        case "group": {
          const members = skillsInGroup(catalog, slot.group).filter((s) => !s.isUncommon);
          return members.length > 0 && members.length <= 6
            ? t("%lld %@ (%@)", slot.count, groupName(slot.group), members.map((s) => resolve(s.name, language)).join(t(", ")))
            : t("%lld %@", slot.count, groupName(slot.group));
        }
        case "any":
          return t("%lld other skills of your choice", slot.count);
      }
    })
    .join(t(", "));
}
