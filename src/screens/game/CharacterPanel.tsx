// The right-hand glass panel summarizing the hero.

import { useState } from "react";
import { SectionLabel, VitalBar } from "../../components/ui";
import { heroMoveRate, type Hero } from "../../game/hero";
import { t } from "../../i18n";
import { Icon } from "../../icons";
import { characteristicName, occupationName, skillName } from "../../model/names";
import { ABBREVIATIONS, build, CHARACTERISTICS, damageBonus, damageBonusLabel, div } from "../../model/rules";
import { allowsOccupationPoints, baseValue, entryValue, type SkillCatalog } from "../../model/skills";
import { isBlank, resolve } from "../../model/storyText";
import type { Item } from "../../model/types";
import { useSettings } from "../../settings";

export function CharacterPanel({ hero, catalog }: { hero: Hero; catalog: SkillCatalog }) {
  const { uiLanguage } = useSettings();
  const job = catalog.occupation(hero.occupationId);
  const name = resolve(hero.name, uiLanguage);

  return (
    <aside className="character-panel glass">
      <div className="row">
        <SectionLabel color="var(--text-secondary)">{t("Your character")}</SectionLabel>
        <span className="spacer" />
        <Icon name="ellipsis" size={16} className="secondary" />
      </div>

      <div className="identity">
        <div className="avatar" aria-hidden>
          {Array.from(name)[0] ?? ""}
        </div>
        <div className="column" style={{ gap: 3, minWidth: 0 }}>
          <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>
            {name}
          </span>
          <span className="callout secondary" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[
              job ? occupationName(catalog, job.id, uiLanguage) : !isBlank(hero.calling) ? resolve(hero.calling, uiLanguage) : null,
              !isBlank(hero.lineage) ? resolve(hero.lineage, uiLanguage) : null,
              t("Age %lld", hero.age),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <SectionLabel color="var(--accent)">{t("Level %@", String(hero.level).padStart(2, "0"))}</SectionLabel>
        </div>
      </div>

      <div className="divider" />

      <div className="column" style={{ gap: 16 }}>
        <VitalBar title={t("Hit points · HP")} symbol="heart" value={hero.hp} maximum={hero.maxHP} tint="var(--health)" />
        <VitalBar title={t("Magic points · MP")} symbol="drop" value={hero.mp} maximum={hero.maxMP} tint="var(--mana)" />
        <VitalBar title={t("Sanity · SAN")} symbol="brain.head.profile" value={hero.sanity} maximum={hero.maxSanity} tint="var(--sanity)" />
        <VitalBar title={t("Luck")} symbol="die.face.5" value={hero.luck} maximum={99} tint="var(--action-point)" />
        <VitalBar title={t("Stamina")} symbol="bolt" value={hero.stamina} maximum={hero.maxStamina} tint="var(--stamina)" />
      </div>

      {hero.effects.map((effect) => (
        <div key={effect.id} className="effect-chip">
          <span className="row accent" style={{ gap: 6 }}>
            <Icon name={effect.symbol} size={14} />
            {resolve(effect.name, uiLanguage)}
          </span>
          <span className="spacer" />
          <span className="secondary">{t("%lld turns", effect.turnsRemaining)}</span>
        </div>
      ))}

      <VitalBar title={t("To level %lld", hero.level + 1)} value={hero.xp} maximum={hero.xpToNext} tint="var(--accent)" unit={t("XP")} />

      <Characteristics hero={hero} />
      <div className="derived-chips">
        <DerivedChip title={t("Move")} value={String(heroMoveRate(hero))} />
        <DerivedChip title={t("Build")} value={String(build(hero.characteristics))} />
        <DerivedChip title={t("Damage bonus")} value={damageBonusLabel(damageBonus(hero.characteristics.strength + hero.characteristics.size))} />
      </div>
      <Skills hero={hero} catalog={catalog} />

      <div className="column" style={{ gap: 12 }}>
        <div className="row">
          <SectionLabel>{t("Equipped")}</SectionLabel>
          <span className="spacer" />
          <span className="row callout secondary" style={{ gap: 5 }}>
            <Icon name="circle.circle" size={13} />
            {t("%lld gold", hero.gold)}
          </span>
        </div>
        {hero.equipment.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </div>

      <div className="divider" />

      <div className="column" style={{ gap: 8 }}>
        <SectionLabel color="var(--accent)">{t("Current quest")}</SectionLabel>
        <span className="serif" style={{ fontSize: 22 }}>
          {resolve(hero.quest.title, uiLanguage)}
        </span>
        <div className="row callout secondary" style={{ gap: 8, alignItems: "baseline" }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)", flexShrink: 0, transform: "translateY(-2px)" }} />
          {resolve(hero.quest.objective, uiLanguage)}
        </div>
      </div>
    </aside>
  );
}

/// The nine characteristics in a 3 × 3 grid. Each box shows the full value with its half (Hard) and fifth
/// (Extreme) values beneath.
function Characteristics({ hero }: { hero: Hero }) {
  return (
    <div className="column" style={{ gap: 10 }}>
      <SectionLabel>{t("Characteristics")}</SectionLabel>
      <div className="characteristics-grid">
        {CHARACTERISTICS.map((characteristic) => {
          const value = hero.characteristics[characteristic];
          return (
            <div
              key={characteristic}
              className="characteristic-box"
              title={characteristicName(characteristic)}
              aria-label={`${characteristicName(characteristic)}: ${t("%lld, half %lld, fifth %lld", value, div(value, 2), div(value, 5))}`}
            >
              <span className="abbr">{ABBREVIATIONS[characteristic]}</span>
              <span className="value">{value}</span>
              <span className="parts">
                {div(value, 2)} · {div(value, 5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SkillRowData {
  id: string;
  skillId: string;
  name: string;
  value: number;
  isTrained: boolean;
}

/// The hero's skills with their half and fifth values, like a character sheet. By default only the skills the
/// hero has invested in are listed; the toggle shows every common skill at its base too.
function Skills({ hero, catalog }: { hero: Hero; catalog: SkillCatalog }) {
  const [showsAll, setShowsAll] = useState(false);
  const { uiLanguage } = useSettings();
  const job = catalog.occupation(hero.occupationId);

  const rows: SkillRowData[] = hero.skills.map((entry) => {
    const base = skillName(catalog, entry.skillId, uiLanguage);
    return {
      id: entry.id,
      skillId: entry.skillId,
      name: isBlank(entry.specialty) ? base : `${base} (${resolve(entry.specialty, uiLanguage)})`,
      value: entryValue(catalog, entry, hero.characteristics),
      isTrained: entry.occupationPoints + entry.personalPoints > 0,
    };
  });
  if (showsAll) {
    const listed = new Set(hero.skills.map((s) => s.skillId));
    for (const definition of catalog.skills) {
      if (definition.isUncommon || listed.has(definition.id)) continue;
      rows.push({
        id: "base-" + definition.id,
        skillId: definition.id,
        name: skillName(catalog, definition.id, uiLanguage),
        value: baseValue(definition.base, hero.characteristics),
        isTrained: false,
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, uiLanguage, { numeric: true }));

  return (
    <div className="column" style={{ gap: 8 }}>
      <div className="row">
        <SectionLabel>{t("Skills")}</SectionLabel>
        <span className="spacer" />
        <button type="button" className="link-button" onClick={() => setShowsAll((s) => !s)}>
          {showsAll ? t("Trained Skills") : t("All Skills")}
        </button>
      </div>
      <div className="column">
        {rows.map((row) => {
          const isOccupationSkill = (job && allowsOccupationPoints(catalog, job, row.skillId)) || (!job && row.isTrained);
          return (
            <div key={row.id} className="skill-row">
              <span style={{ width: 10, display: "inline-flex", color: "var(--accent)", opacity: row.isTrained ? 1 : 0.4 }}>
                {isOccupationSkill && <Icon name="briefcase.fill" size={9} />}
              </span>
              <span style={{ color: row.isTrained ? undefined : "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.name}
              </span>
              <span className="spacer" />
              <span className="mono-digits" style={{ fontWeight: row.isTrained ? 600 : 400 }}>
                {row.value}
              </span>
              <span className="mono-digits tertiary" style={{ fontSize: 10, width: 44, textAlign: "right" }}>
                {div(row.value, 2)} · {div(row.value, 5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DerivedChip({ title, value }: { title: string; value: string }) {
  return (
    <div className="derived-chip">
      <span className="title">{title}</span>
      <span className="value">{value}</span>
    </div>
  );
}

export function ItemRow({ item }: { item: Item }) {
  const { uiLanguage } = useSettings();
  return (
    <div className="item-row">
      <span className="item-icon">
        <Icon name={item.symbol} size={17} />
      </span>
      <span className="column" style={{ gap: 2 }}>
        <span>{resolve(item.name, uiLanguage)}</span>
        <span className="caption secondary">{resolve(item.detail, uiLanguage)}</span>
      </span>
    </div>
  );
}
