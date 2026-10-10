// Fights, resolved round by round. Each round the faster side (higher DEX; drawing a firearm adds 50) goes first.
// Melee attacks are opposed: the target dodges (winning ties) or fights back (losing ties, but hitting the attacker
// if it rolls better). Firearms can't be dodged or fought back. The fight ends when one side drops to 0 HP or is
// knocked out by a major wound.

import {
  damageBonus,
  damageBonusMaximum,
  damageMaximum,
  FISTS,
  hitPoints,
  randomInt,
  rollDamage,
  rollDamageBonus,
  successLevel,
  SuccessLevel,
  type DamageBonus,
} from "../model/rules";
import { characterSkillValue } from "../model/skills";
import { findCharacter, findMonster } from "../model/story";
import type { DamageRoll, Item, Story, StoryCharacter, StoryMonster, StoryText } from "../model/types";
import { defenseBonus, heroSkillValue, type Hero } from "./hero";

export type Side = "hero" | "enemy";

/// One way of attacking: bare hands, a carried weapon, or a monster's own attack.
export interface Attack {
  /// The weapon or attack name for the battle log; empty for bare hands.
  name: StoryText;
  /// The skill rolled, for showing its name. Empty for a monster's attack.
  skillId: string;
  /// The chance to hit, 1–99.
  skill: number;
  damage: DamageRoll;
  /// Flat damage added on top, such as a weapon's bonus damage.
  bonus: number;
  addsDamageBonus: boolean;
  impales: boolean;
  isFirearm: boolean;
}

/// Bare hands: Fighting (Brawl), 1D3 plus the damage bonus.
export function fists(skill: number): Attack {
  return { name: [], skillId: "fightingBrawl", skill, damage: FISTS, bonus: 0, addsDamageBonus: true, impales: false, isFirearm: false };
}

/// Whether an item can be attacked with.
export function isWeapon(item: Item): boolean {
  return item.category === "weapon" && item.skillId !== "";
}

/// Firearms are fired rather than swung: the target can't dodge or fight back, and the shooter acts first.
export function isFirearm(item: Item): boolean {
  return item.skillId.startsWith("firearms");
}

/// Attacking with a carried weapon at the wielder's skill.
export function weaponAttack(weapon: Item, skill: number): Attack {
  return {
    name: weapon.name,
    skillId: weapon.skillId,
    skill,
    damage: weapon.damage,
    bonus: weapon.attack,
    addsDamageBonus: weapon.addsDamageBonus,
    impales: weapon.impales,
    isFirearm: isFirearm(weapon),
  };
}

/// Damage before armor. An extreme success deals the most the weapon and damage bonus can, and an impaling weapon
/// then rolls its damage again on top.
function rollAttackDamage(attack: Attack, bonus: DamageBonus, extreme: boolean): number {
  const fromStrength = attack.addsDamageBonus ? (extreme ? damageBonusMaximum(bonus) : rollDamageBonus(bonus)) : 0;
  let total = (extreme ? damageMaximum(attack.damage) : rollDamage(attack.damage)) + attack.bonus + fromStrength;
  if (extreme && attack.impales) total += rollDamage(attack.damage);
  return Math.max(0, total);
}

// MARK: Enemies

/// The fighting stats of a battle's opponent, captured when the battle starts.
export interface Enemy {
  name: StoryText;
  symbol: string;
  hp: number;
  constitution: number;
  dexterity: number;
  /// STR + SIZ, which sets the damage bonus.
  strengthPlusSize: number;
  dodge: number;
  armor: number;
  attack: Attack;
  /// What it fights back with when attacked. The same as `attack` unless that's a firearm.
  parry: Attack;
  attacksPerRound: number;
  xpReward: number;
  goldReward: number;
}

export function enemyFromMonster(monster: StoryMonster): Enemy {
  const attack: Attack = {
    name: monster.attackName,
    skillId: "",
    skill: monster.fighting,
    damage: monster.damage,
    bonus: 0,
    addsDamageBonus: monster.addsDamageBonus,
    impales: monster.impales,
    isFirearm: false,
  };
  return {
    name: monster.name,
    symbol: monster.symbol,
    hp: Math.max(monster.hitPoints, 1),
    constitution: monster.constitution,
    dexterity: monster.dexterity,
    strengthPlusSize: monster.strength + monster.size,
    dodge: monster.dodge,
    armor: Math.max(0, monster.armor),
    attack,
    parry: attack,
    attacksPerRound: Math.min(Math.max(monster.attacksPerRound, 1), 4),
    xpReward: monster.xpReward,
    goldReward: monster.goldReward,
  };
}

function bestBySkill(attacks: Attack[]): Attack | undefined {
  // Ties keep the earlier weapon.
  return attacks.reduce<Attack | undefined>((best, a) => (!best || a.skill > best.skill ? a : best), undefined);
}

/// A character fights like the hero: with the best carried weapon they have the skill for, or bare hands.
export function enemyFromCharacter(character: StoryCharacter, items: Item[]): Enemy {
  const carried = character.itemIds.flatMap((id) => items.filter((i) => i.id === id).slice(0, 1));
  const bare = fists(characterSkillValue(character, "fightingBrawl"));
  const weapons = carried
    .filter((item) => isWeapon(item) && character.skills.some((s) => s.skillId === item.skillId))
    .map((item) => weaponAttack(item, characterSkillValue(character, item.skillId)));
  const attack = bestBySkill(weapons) ?? bare;
  const parry = attack.isFirearm ? (bestBySkill(weapons.filter((w) => !w.isFirearm)) ?? bare) : attack;
  return {
    name: character.name,
    symbol: character.symbol,
    hp: Math.max(hitPoints(character.characteristics), 1),
    constitution: character.characteristics.constitution,
    dexterity: character.characteristics.dexterity,
    strengthPlusSize: character.characteristics.strength + character.characteristics.size,
    dodge: characterSkillValue(character, "dodge"),
    armor: carried.reduce((sum, i) => sum + Math.max(0, i.defense), 0),
    attack,
    parry,
    attacksPerRound: 1,
    xpReward: character.xpReward,
    goldReward: character.goldReward,
  };
}

/// What a battle node's enemy ID refers to: a character or a monster. IDs are unique across both sheets.
export function opponent(story: Story, id: string): Enemy | undefined {
  const character = findCharacter(story, id);
  if (character) return enemyFromCharacter(character, story.items);
  const monster = findMonster(story, id);
  return monster ? enemyFromMonster(monster) : undefined;
}

export function enemyDamageBonus(enemy: Enemy): DamageBonus {
  return damageBonus(enemy.strengthPlusSize);
}

// MARK: The hero's attacks

export function heroFists(hero: Hero): Attack {
  return fists(heroSkillValue(hero, "fightingBrawl"));
}

/// Carried weapons the hero has the skill to use, each with the attack it makes.
export function heroWeaponAttacks(hero: Hero): { item: Item; attack: Attack }[] {
  return hero.equipment
    .filter((item) => isWeapon(item) && hero.skills.some((s) => s.skillId === item.skillId))
    .map((item) => ({ item, attack: weaponAttack(item, heroSkillValue(hero, item.skillId)) }));
}

/// What the hero does in a round: hit with bare hands, attack with a carried weapon, or spend the round ready to
/// dodge every attack, winning ties.
export type BattleAction = { type: "punch" } | { type: "weapon"; itemId: string } | { type: "dodge" };

export function heroAttack(hero: Hero, action: BattleAction): Attack | undefined {
  switch (action.type) {
    case "punch":
      return heroFists(hero);
    case "weapon":
      return heroWeaponAttacks(hero).find((w) => w.item.id === action.itemId)?.attack;
    case "dodge":
      return undefined;
  }
}

// MARK: Battle

/// How an attack turned out.
export type AttackResult =
  /// Landed for `damage` after armor.
  | { type: "hit"; damage: number; extreme: boolean }
  | { type: "missed" }
  /// The target dodged with a roll that matched or beat the attack.
  | { type: "dodged"; roll: number; skill: number }
  /// The target fought back and won, landing `damage` on the attacker instead.
  | { type: "countered"; roll: number; skill: number; damage: number };

export type BattleEventKind =
  /// The hero spends the round ready to dodge.
  | { type: "heroDodging" }
  | { type: "attack"; attacker: Side; weapon: StoryText; roll: number; skill: number; result: AttackResult }
  /// A single hit took half or more of someone's hit points; they roll CON to stay on their feet.
  | { type: "majorWound"; side: Side; roll: number; constitution: number; stayedUp: boolean }
  | { type: "victory" }
  | { type: "defeat" };

/// One line of the battle log.
export interface BattleEvent {
  id: string;
  round: number;
  kind: BattleEventKind;
}

export type BattleOutcome = "victory" | "defeat";

/// A fight in progress.
export interface BattleState {
  enemy: Enemy;
  enemyHP: number;
  round: number;
  events: BattleEvent[];
  outcome: BattleOutcome | null;
}

type Defense = { type: "none" } | { type: "dodge"; skill: number } | { type: "fightBack"; attack: Attack };

export function newBattle(enemy: Enemy): BattleState {
  return { enemy, enemyHP: Math.max(enemy.hp, 1), round: 1, events: [], outcome: null };
}

/// Enemies fight back when attacked, unless they're better at dodging.
function prefersDodge(enemy: Enemy): boolean {
  return enemy.dodge > enemy.parry.skill;
}

/// Whether the hero acts before the enemy this round with `action`.
export function heroActsFirst(battle: BattleState, action: BattleAction, hero: Hero): boolean {
  const drawsFirearm = heroAttack(hero, action)?.isFirearm ?? false;
  return hero.characteristics.dexterity + (drawsFirearm ? 50 : 0) >= battle.enemy.dexterity;
}

/// Plays one round: the hero's action and the enemy's attacks, in initiative order. Changes `battle` and `hero`.
export function performRound(battle: BattleState, action: BattleAction, hero: Hero) {
  if (battle.outcome) return;
  const attack = heroAttack(hero, action);
  if (action.type !== "dodge" && !attack) return;

  if (heroActsFirst(battle, action, hero)) {
    heroTurn(battle, attack, hero);
    enemyTurn(battle, action, attack, hero);
  } else {
    enemyTurn(battle, action, attack, hero);
    heroTurn(battle, attack, hero);
  }
  if (!battle.outcome) battle.round += 1;
}

function addEvent(battle: BattleState, kind: BattleEventKind) {
  battle.events.push({ id: crypto.randomUUID(), round: battle.round, kind });
}

function heroTurn(battle: BattleState, attack: Attack | undefined, hero: Hero) {
  if (battle.outcome) return;
  if (!attack) {
    addEvent(battle, { type: "heroDodging" });
    return;
  }
  const enemy = battle.enemy;
  const defense: Defense = attack.isFirearm
    ? { type: "none" }
    : prefersDodge(enemy)
      ? { type: "dodge", skill: enemy.dodge }
      : { type: "fightBack", attack: enemy.parry };
  resolve(battle, "hero", attack, defense, hero);
}

function enemyTurn(battle: BattleState, action: BattleAction, attack: Attack | undefined, hero: Hero) {
  for (let i = 0; i < battle.enemy.attacksPerRound; i++) {
    if (battle.outcome) return;
    let defense: Defense;
    if (battle.enemy.attack.isFirearm) {
      defense = { type: "none" };
    } else if (action.type === "dodge") {
      defense = { type: "dodge", skill: heroSkillValue(hero, "dodge") };
    } else {
      // A hero attacking this round fights back with the same weapon, or bare hands after firing a gun.
      defense = { type: "fightBack", attack: attack && !attack.isFirearm ? attack : heroFists(hero) };
    }
    resolve(battle, "enemy", battle.enemy.attack, defense, hero);
  }
}

function resolve(battle: BattleState, attacker: Side, attack: Attack, defense: Defense, hero: Hero) {
  const roll = randomInt(1, 100);
  const level = successLevel(roll, attack.skill);
  const succeeded = level >= SuccessLevel.Regular;
  const defender: Side = attacker === "hero" ? "enemy" : "hero";
  let landed = false;
  let counter: { roll: number; skill: number; attack: Attack } | undefined;
  let dodge: { roll: number; skill: number } | undefined;

  switch (defense.type) {
    case "none":
      landed = succeeded;
      break;
    case "dodge": {
      const dodgeRoll = randomInt(1, 100);
      // The dodger wins ties.
      landed = succeeded && level > successLevel(dodgeRoll, defense.skill);
      if (succeeded && !landed) dodge = { roll: dodgeRoll, skill: defense.skill };
      break;
    }
    case "fightBack": {
      const parryRoll = randomInt(1, 100);
      const parryLevel = successLevel(parryRoll, defense.attack.skill);
      // The attacker wins ties; a defender who rolls better lands their own blow.
      landed = succeeded && level >= parryLevel;
      if (!landed && parryLevel >= SuccessLevel.Regular && parryLevel > level) {
        counter = { roll: parryRoll, skill: defense.attack.skill, attack: defense.attack };
      }
      break;
    }
  }

  const followUps: BattleEventKind[] = [];
  let result: AttackResult;
  if (landed) {
    const extreme = level >= SuccessLevel.Extreme;
    const raw = rollAttackDamage(attack, sideDamageBonus(battle, attacker, hero), extreme);
    result = { type: "hit", damage: wound(battle, defender, raw, hero, followUps), extreme };
  } else if (counter) {
    const raw = rollAttackDamage(counter.attack, sideDamageBonus(battle, defender, hero), false);
    result = { type: "countered", roll: counter.roll, skill: counter.skill, damage: wound(battle, attacker, raw, hero, followUps) };
  } else if (dodge) {
    result = { type: "dodged", roll: dodge.roll, skill: dodge.skill };
  } else {
    result = { type: "missed" };
  }
  addEvent(battle, { type: "attack", attacker, weapon: attack.name, roll, skill: attack.skill, result });
  for (const kind of followUps) addEvent(battle, kind);
}

function sideDamageBonus(battle: BattleState, side: Side, hero: Hero): DamageBonus {
  return side === "hero" ? damageBonus(hero.characteristics.strength + hero.characteristics.size) : enemyDamageBonus(battle.enemy);
}

/// Applies a hit after armor and returns what got through. Records a major wound and the end of the fight in
/// `followUps`, in the order they happen.
function wound(battle: BattleState, side: Side, raw: number, hero: Hero, followUps: BattleEventKind[]): number {
  const armor = side === "hero" ? defenseBonus(hero) : battle.enemy.armor;
  const dealt = Math.max(0, raw - armor);
  let maximum: number;
  let remaining: number;
  let constitution: number;
  if (side === "hero") {
    hero.hp = Math.max(0, hero.hp - dealt);
    [maximum, remaining, constitution] = [hero.maxHP, hero.hp, hero.characteristics.constitution];
  } else {
    battle.enemyHP = Math.max(0, battle.enemyHP - dealt);
    [maximum, remaining, constitution] = [battle.enemy.hp, battle.enemyHP, battle.enemy.constitution];
  }

  let down = remaining === 0;
  // Half or more of someone's hit points in one blow is a major wound: roll CON or be knocked out.
  if (!down && dealt > 0 && dealt * 2 >= maximum) {
    const roll = randomInt(1, 100);
    const stayedUp = roll <= constitution;
    followUps.push({ type: "majorWound", side, roll, constitution, stayedUp });
    down = !stayedUp;
  }
  if (down) {
    battle.outcome = side === "hero" ? "defeat" : "victory";
    followUps.push({ type: side === "hero" ? "defeat" : "victory" });
  }
  return dealt;
}
