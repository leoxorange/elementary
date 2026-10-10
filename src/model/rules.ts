// Characteristics, dice, and rolls: the percentile rules every check and battle uses.

import type { Characteristic, Characteristics, CheckDifficulty, DamageRoll } from "./types";

/// The nine characteristics, in the order this game lists them.
export const CHARACTERISTICS: Characteristic[] = [
  "strength",
  "dexterity",
  "size",
  "appearance",
  "constitution",
  "intelligence",
  "power",
  "education",
  "luck",
];

/// The standard abbreviation, shown as-is in every language.
export const ABBREVIATIONS: Record<Characteristic, string> = {
  strength: "STR",
  dexterity: "DEX",
  size: "SIZ",
  appearance: "APP",
  constitution: "CON",
  intelligence: "INT",
  power: "POW",
  education: "EDU",
  luck: "LUC",
};

export function defaultCharacteristics(): Characteristics {
  return {
    strength: 50,
    dexterity: 50,
    size: 65,
    appearance: 50,
    constitution: 50,
    intelligence: 65,
    power: 50,
    education: 65,
    luck: 50,
  };
}

/// Integer division that truncates toward zero, as Swift's `/` does.
export function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/// A whole number from `low` to `high`, inclusive.
export function randomInt(low: number, high: number): number {
  return low + Math.floor(Math.random() * (high - low + 1));
}

/// Rolls `count` dice with `sides` faces each and adds them up.
export function rollDice(count: number, sides: number): number {
  if (count <= 0 || sides <= 0) return 0;
  let total = 0;
  for (let i = 0; i < count; i++) total += randomInt(1, sides);
  return total;
}

/// Rolls a fresh set: 3D6 × 5, or (2D6 + 6) × 5 for SIZ, INT, and EDU.
export function rollCharacteristics(): Characteristics {
  const result = defaultCharacteristics();
  for (const characteristic of CHARACTERISTICS) {
    const twoDiceAndSix = characteristic === "size" || characteristic === "intelligence" || characteristic === "education";
    result[characteristic] = twoDiceAndSix ? (rollDice(2, 6) + 6) * 5 : rollDice(3, 6) * 5;
  }
  return result;
}

// MARK: Derived values

/// Hit points: (CON + SIZ) ÷ 10, rounded down.
export function hitPoints(c: Characteristics): number {
  return Math.max(0, div(c.constitution + c.size, 10));
}

/// Magic points: POW ÷ 5, rounded down.
export function magicPoints(c: Characteristics): number {
  return Math.max(0, div(c.power, 5));
}

/// Starting sanity equals POW.
export function startingSanity(c: Characteristics): number {
  return Math.min(Math.max(0, c.power), 99);
}

/// Movement rate: 7 if STR and DEX are both below SIZ, 9 if both are above it, otherwise 8. Characters lose 1 for
/// each decade of age from their 40s on.
export function moveRate(c: Characteristics, age: number): number {
  let base = 8;
  if (c.strength < c.size && c.dexterity < c.size) base = 7;
  else if (c.strength > c.size && c.dexterity > c.size) base = 9;
  const agePenalty = age >= 40 ? Math.min(div(age - 30, 10), 5) : 0;
  return Math.max(1, base - agePenalty);
}

/// Extra damage from strength and size: −2, −1, 0, +1D4, +1D6, +2D6, …
export type DamageBonus = { type: "flat"; value: number } | { type: "dice"; count: number; sides: number };

/// The build and damage bonus table, indexed by STR + SIZ.
function buildAndBonus(total: number): { build: number; bonus: DamageBonus } {
  if (total < 65) return { build: -2, bonus: { type: "flat", value: -2 } };
  if (total < 85) return { build: -1, bonus: { type: "flat", value: -1 } };
  if (total < 125) return { build: 0, bonus: { type: "flat", value: 0 } };
  if (total < 165) return { build: 1, bonus: { type: "dice", count: 1, sides: 4 } };
  if (total < 205) return { build: 2, bonus: { type: "dice", count: 1, sides: 6 } };
  // From 205 up, each further 80 points adds another D6 and another point of build.
  const steps = div(total - 205, 80);
  return { build: 3 + steps, bonus: { type: "dice", count: 2 + steps, sides: 6 } };
}

export function build(c: Characteristics): number {
  return buildAndBonus(c.strength + c.size).build;
}

export function damageBonus(strengthPlusSize: number): DamageBonus {
  return buildAndBonus(strengthPlusSize).bonus;
}

export function damageBonusLabel(bonus: DamageBonus): string {
  if (bonus.type === "dice") return `+${bonus.count}D${bonus.sides}`;
  return bonus.value > 0 ? `+${bonus.value}` : bonus.value < 0 ? `−${-bonus.value}` : "0";
}

export function rollDamageBonus(bonus: DamageBonus): number {
  return bonus.type === "flat" ? bonus.value : rollDice(bonus.count, bonus.sides);
}

/// The most it can add, used for an extreme success.
export function damageBonusMaximum(bonus: DamageBonus): number {
  return bonus.type === "flat" ? bonus.value : bonus.count * bonus.sides;
}

export function isZeroBonus(bonus: DamageBonus): boolean {
  return bonus.type === "flat" && bonus.value === 0;
}

// MARK: Damage rolls

export const FISTS: DamageRoll = { count: 1, sides: 3, bonus: 0 };

export function damageLabel(roll: DamageRoll): string {
  const dice = `${roll.count}D${roll.sides}`;
  return roll.bonus > 0 ? `${dice}+${roll.bonus}` : roll.bonus < 0 ? `${dice}−${-roll.bonus}` : dice;
}

export function damageMaximum(roll: DamageRoll): number {
  return Math.max(0, roll.count * roll.sides + roll.bonus);
}

export function rollDamage(roll: DamageRoll): number {
  return Math.max(0, rollDice(roll.count, roll.sides) + roll.bonus);
}

// MARK: Checks

/// The levels of success, from worst to best.
export enum SuccessLevel {
  Fumble,
  Failure,
  Regular,
  Hard,
  Extreme,
  Critical,
}

/// The level a difficulty requires.
export function requiredLevel(difficulty: CheckDifficulty): SuccessLevel {
  switch (difficulty) {
    case "regular":
      return SuccessLevel.Regular;
    case "hard":
      return SuccessLevel.Hard;
    case "extreme":
      return SuccessLevel.Extreme;
  }
}

/// Grades a d100 roll against a value. 01 is always a critical. 100 is always a fumble, and so is 96–99 when the
/// value is below 50.
export function successLevel(roll: number, value: number): SuccessLevel {
  if (roll === 1) return SuccessLevel.Critical;
  if (roll === 100 || (value < 50 && roll >= 96)) return SuccessLevel.Fumble;
  if (roll <= div(value, 5)) return SuccessLevel.Extreme;
  if (roll <= div(value, 2)) return SuccessLevel.Hard;
  if (roll <= value) return SuccessLevel.Regular;
  return SuccessLevel.Failure;
}

/// The value needed to succeed at a difficulty: the full value, half, or a fifth.
export function targetNumber(value: number, difficulty: CheckDifficulty): number {
  switch (difficulty) {
    case "regular":
      return value;
    case "hard":
      return div(value, 2);
    case "extreme":
      return div(value, 5);
  }
}

export const CHECK_DIFFICULTIES: CheckDifficulty[] = ["regular", "hard", "extreme"];
