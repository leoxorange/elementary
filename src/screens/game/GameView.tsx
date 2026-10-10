// The in-game screen: top bar, side rail, the current section, and the character panel.

import { useEffect, useMemo, useState } from "react";
import { showMenuBelow, SectionLabel, VitalBar, EmptyState } from "../../components/ui";
import { carriedWeight, type Hero } from "../../game/hero";
import { useGame, type GameState, type LogEntry } from "../../game/gameState";
import { APP_LANGUAGES, appLanguageName, t } from "../../i18n";
import { Icon } from "../../icons";
import { phaseName } from "../../model/names";
import { findTrack, storyTitle } from "../../model/story";
import { isBlank, resolve, textEquals } from "../../model/storyText";
import type { Item, StoryText } from "../../model/types";
import { MusicPlayer } from "../../music";
import { useSettings } from "../../settings";
import { SettingsSheet } from "../Welcome";
import { CharacterPanel, ItemRow } from "./CharacterPanel";
import { StoryPanel } from "./StoryPanel";

type Section = "play" | "map" | "journal" | "pack";

const SECTIONS: { id: Section; title: string; symbol: string }[] = [
  { id: "play", title: "Play", symbol: "safari" },
  { id: "map", title: "Map", symbol: "map" },
  { id: "journal", title: "Journal", symbol: "book.closed" },
  { id: "pack", title: "Pack", symbol: "backpack" },
];

export function GameView({ game, onMainMenu, onPlayAgain }: { game: GameState; onMainMenu: () => void; onPlayAgain: () => void }) {
  useGame(game);
  const [section, setSection] = useState<Section>("play");
  const [showsCharacterPanel, setShowsCharacterPanel] = useState(true);
  const [showsSettings, setShowsSettings] = useState(false);
  const { soundOn, setSoundOn } = useSettings();
  const music = useMemo(() => new MusicPlayer(), []);

  useEffect(() => {
    music.play(game.musicTrackId ? findTrack(game.story, game.musicTrackId) : null, soundOn);
  }, [music, game.musicTrackId, game.story, soundOn]);
  useEffect(() => () => music.stop(), [music]);

  return (
    <div className="screen">
      <TopBar
        storyTitle={storyTitle(game.story)}
        chapter={game.setting.chapter}
        onMainMenu={onMainMenu}
        onToggleCharacterPanel={() => setShowsCharacterPanel((s) => !s)}
        onSettings={() => setShowsSettings(true)}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn(!soundOn)}
      />
      <div className="divider" />
      <div className="game-body">
        <SideRail selection={section} onSelect={setSection} />
        <div className="game-main">
          {section === "play" && <StoryPanel game={game} onMainMenu={onMainMenu} onPlayAgain={onPlayAgain} />}
          {section === "map" && <MapSection game={game} />}
          {section === "journal" && <JournalSection log={game.log} />}
          {section === "pack" && <PackSection hero={game.hero} />}
        </div>
        {showsCharacterPanel && <CharacterPanel hero={game.hero} catalog={game.catalog} />}
      </div>
      <div className="divider" />
      <StatusBar game={game} />
      {showsSettings && <SettingsSheet onClose={() => setShowsSettings(false)} />}
    </div>
  );
}

// MARK: Top bar

/// The globe button for switching the app language, shared by the game and the story designer.
export function LanguageMenuButton() {
  const { language, setLanguage } = useSettings();
  return (
    <button
      type="button"
      className="btn btn-glass btn-icon"
      title={t("Language")}
      aria-label={t("Language")}
      onClick={(e) =>
        showMenuBelow(e.currentTarget, [
          { header: t("Language") },
          ...APP_LANGUAGES.map((option) => ({ label: appLanguageName(option), checked: option === language, action: () => setLanguage(option) })),
        ])
      }
    >
      <Icon name="globe" size={16} />
    </button>
  );
}

function IconButton({ symbol, label, onClick }: { symbol: string; label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-glass btn-icon" title={label} aria-label={label} onClick={onClick}>
      <Icon name={symbol} size={16} />
    </button>
  );
}

function TopBar({ storyTitle, chapter, onMainMenu, onToggleCharacterPanel, onSettings, soundOn, onToggleSound }: {
  storyTitle: StoryText;
  chapter: StoryText;
  onMainMenu: () => void;
  onToggleCharacterPanel: () => void;
  onSettings: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  const { uiLanguage } = useSettings();
  return (
    <div className="top-bar">
      <div className="brand">
        <span className="monogram">El</span>
        <span style={{ width: 1, height: 22, background: "var(--hairline)" }} />
        <span className="name">{t("Elementary")}</span>
      </div>
      <div className="center-title">
        <Icon name="sparkles" size={15} className="accent" />
        <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{resolve(storyTitle, uiLanguage)}</span>
        {!isBlank(chapter) && (
          <>
            <span className="tertiary">/</span>
            <span className="tertiary" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {resolve(chapter, uiLanguage)}
            </span>
          </>
        )}
      </div>
      <span className="spacer" />
      <div className="saved-indicator">
        <span className="dot" />
        {t("All progress saved")}
      </div>
      <div className="icon-group">
        <IconButton symbol="house" label={t("Main menu")} onClick={onMainMenu} />
        <IconButton symbol={soundOn ? "speaker.wave.2" : "speaker.slash"} label={t("Sound")} onClick={onToggleSound} />
        <IconButton symbol="slider.horizontal.3" label={t("Settings")} onClick={onSettings} />
        <IconButton symbol="sidebar.right" label={t("Toggle character panel")} onClick={onToggleCharacterPanel} />
        <LanguageMenuButton />
      </div>
    </div>
  );
}

// MARK: Side rail

function SideRail({ selection, onSelect }: { selection: Section; onSelect: (section: Section) => void }) {
  return (
    <nav className="side-rail">
      <div className="rail-buttons">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`rail-button ${section.id === selection ? "selected" : ""}`}
            aria-pressed={section.id === selection}
            onClick={() => onSelect(section.id)}
          >
            <span className="rail-icon">
              <Icon name={section.symbol} size={20} />
            </span>
            {t(section.title)}
          </button>
        ))}
      </div>
      <span className="spacer" />
      <button type="button" className="rail-button" style={{ color: "var(--text-secondary)" }}>
        <Icon name="questionmark.circle" size={22} />
        {t("Help")}
      </button>
    </nav>
  );
}

// MARK: Status bar

function StatusBar({ game }: { game: GameState }) {
  const { uiLanguage } = useSettings();
  const choices = game.currentChoices.length;
  return (
    <div className="status-bar">
      <Icon name="moon" size={14} />
      <span>{t("Day %lld", game.day)}</span>
      <span>·</span>
      <span>{phaseName(game.phaseIndex)}</span>
      <span className="tertiary">—</span>
      <span>{resolve(game.setting.location, uiLanguage)}</span>
      <span className="motto">{t("Every choice leaves an echo.")}</span>
      <span className="spacer" />
      {choices > 0 && (
        <span className="key-hint">
          <kbd>1–{choices}</kbd>
          {t("Choose an action")}
        </span>
      )}
    </div>
  );
}

// MARK: Sections

export function StoryLogList({ entries }: { entries: LogEntry[] }) {
  const { uiLanguage } = useSettings();
  if (entries.length === 0) {
    return (
      <EmptyState symbol="book.closed" title={t("No entries yet")}>
        {t("Your choices will be recorded here.")}
      </EmptyState>
    );
  }
  return (
    <div className="column" style={{ gap: 16, padding: 20 }}>
      {[...entries].reverse().map((entry) => (
        <div key={entry.id} className="column" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <SectionLabel>{t("Day %lld", entry.day)}</SectionLabel>
            <SectionLabel>{phaseName(entry.phaseIndex)}</SectionLabel>
            <span className="tertiary">·</span>
            <SectionLabel>{resolve(entry.sceneTitle, uiLanguage)}</SectionLabel>
          </div>
          <span className="serif" style={{ fontSize: 15 }}>
            {resolve(entry.choiceTitle, uiLanguage)}
          </span>
        </div>
      ))}
    </div>
  );
}

function JournalSection({ log }: { log: LogEntry[] }) {
  return (
    <div className="panel-card column" style={{ flex: 1, minHeight: 0, gap: 16 }}>
      <h2 className="big-heading">{t("Journal")}</h2>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <StoryLogList entries={log} />
      </div>
    </div>
  );
}

function MapSection({ game }: { game: GameState }) {
  const { uiLanguage } = useSettings();
  return (
    <div className="panel-card column" style={{ flex: 1, minHeight: 0, gap: 20, overflowY: "auto" }}>
      <h2 className="big-heading">{t("Known places")}</h2>
      {game.visitedLocations.map((location, index) => {
        const isCurrent = textEquals(location, game.setting.location);
        return (
          <div key={index} className="row" style={{ gap: 10, fontSize: 19, color: isCurrent ? "var(--accent)" : undefined }}>
            <Icon name={isCurrent ? "mappin.circle.fill" : "mappin.circle"} size={20} />
            {resolve(location, uiLanguage)}
          </div>
        );
      })}
    </div>
  );
}

function PackSection({ hero }: { hero: Hero }) {
  const weight = carriedWeight(hero);
  return (
    <div className="panel-card column" style={{ flex: 1, minHeight: 0, gap: 20, overflowY: "auto" }}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <h2 className="big-heading">{t("Pack")}</h2>
        <span className="spacer" />
        <span className="row secondary" style={{ gap: 6 }}>
          <Icon name="circle.circle" size={15} />
          {t("%lld gold", hero.gold)}
        </span>
      </div>
      {hero.carryCapacity !== null && (
        <div style={{ maxWidth: 420 }}>
          <VitalBar
            title={t("Carried weight")}
            symbol="scalemass"
            value={Math.round(weight)}
            maximum={Math.round(hero.carryCapacity)}
            tint={weight > hero.carryCapacity ? "var(--warning)" : "var(--stamina)"}
          />
        </div>
      )}
      {hero.equipment.map((item: Item) => (
        <div key={item.id} className="row" style={{ alignItems: "baseline" }}>
          <ItemRow item={item} />
          <span className="spacer" />
          <span className="callout secondary mono-digits">
            {t("%@ wt · %lld gold", String(Math.round(item.weight * 100) / 100), item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
