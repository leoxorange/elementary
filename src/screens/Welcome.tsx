// The title screen: start a new game, continue the autosave, open settings, or quit.

import { useCallback, useEffect, useState } from "react";
import { api, chooseStoryFile, errorMessage } from "../api";
import { Alert, Confirm, FormRow, FormSection, Modal, Select, Toggle, useKeyboard } from "../components/ui";
import { GameState, loadSavedGame } from "../game/gameState";
import { APP_LANGUAGES, appLanguageName, formatRelative, t, type AppLanguage } from "../i18n";
import { Icon } from "../icons";
import { entranceNode, findChapter, storyTitle } from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { Story, StorySource, StoryText } from "../model/types";
import { isPlayable } from "../model/validator";
import { useSettings } from "../settings";

export function Welcome({ initialPage = "menu", onStart, onNewGame, onOpenDesigner }: {
  initialPage?: "menu" | "newGame";
  /// Continues the saved game.
  onStart: (game: GameState) => void;
  /// Goes on to choosing a hero for the chosen story.
  onNewGame: (story: Story, source: StorySource) => void;
  onOpenDesigner: () => void;
}) {
  const [page, setPage] = useState<"menu" | "newGame">(initialPage);
  const [save, setSave] = useState<SaveSummary | null>(null);
  const [showsSettings, setShowsSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uiLanguage } = useSettings();

  useEffect(() => {
    loadSaveSummary().then(setSave);
  }, []);

  const continueGame = async () => {
    try {
      const saved = await loadSavedGame();
      if (saved) onStart(await GameState.resume(saved));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useKeyboard((event) => {
    if (page === "menu" && event.key === "Enter" && !showsSettings) {
      setPage("newGame");
      return true;
    }
  });

  return (
    <div className="welcome">
      {page === "menu" ? (
        <div className="welcome-menu">
          <div className="welcome-title">
            <Icon name="sparkles" size={30} className="accent" />
            <h1>{t("Elementary")}</h1>
            <p>{t("Pick your advances.")}</p>
          </div>
          <div className="menu-buttons">
            <MenuButton title={t("New Game")} symbol="plus" prominent onClick={() => setPage("newGame")} />
            <MenuButton
              title={t("Continue")}
              symbol="play"
              subtitle={save ? t("%@ · Day %lld · %@", resolve(save.title, uiLanguage), save.day, formatRelative(new Date(save.savedAt))) : undefined}
              disabled={!save}
              onClick={continueGame}
            />
            <MenuButton title={t("Settings")} symbol="slider.horizontal.3" onClick={() => setShowsSettings(true)} />
            <MenuButton title={t("Exit Game")} symbol="rectangle.portrait.and.arrow.right" onClick={() => api.quit()} />
          </div>
        </div>
      ) : (
        <NewGame hasSave={save !== null} onChoose={onNewGame} onBack={() => setPage("menu")} />
      )}

      {page === "menu" && (
        <button
          type="button"
          className="btn btn-glass btn-icon corner-button"
          style={{ width: 44, height: 44 }}
          title={t("Story Designer: create your own scripts")}
          aria-label={t("Story Designer")}
          onClick={onOpenDesigner}
        >
          <Icon name="point.3.connected.trianglepath.dotted" size={20} />
        </button>
      )}

      {showsSettings && <SettingsSheet onClose={() => setShowsSettings(false)} />}
      {error && <Alert title={t("Couldn't continue")} message={error} onDismiss={() => setError(null)} />}
    </div>
  );
}

function MenuButton({ title, symbol, subtitle, prominent, disabled, onClick }: {
  title: string;
  symbol: string;
  subtitle?: string;
  prominent?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`menu-button glass glass-interactive ${prominent ? "prominent" : ""}`} disabled={disabled} onClick={onClick}>
      <Icon name={symbol} size={18} style={{ width: 22 }} />
      <span className="column" style={{ gap: 2, minWidth: 0 }}>
        <span className="title">{title}</span>
        {subtitle && <span className="subtitle">{subtitle}</span>}
      </span>
    </button>
  );
}

// MARK: Save summary

/// What the Continue button shows about the autosave.
interface SaveSummary {
  title: StoryText;
  day: number;
  savedAt: number;
}

async function loadSaveSummary(): Promise<SaveSummary | null> {
  try {
    const saved = await loadSavedGame();
    if (!saved) return null;
    const story = await api.loadStory(saved.source);
    return { title: storyTitle(story), day: saved.day, savedAt: saved.savedAt };
  } catch {
    return null;
  }
}

// MARK: New game

interface StoryEntry {
  story: Story;
  source: { type: "builtIn" } | { type: "library" } | { type: "file"; name: string };
  /// How a saved game reopens this story.
  playSource: StorySource;
  /// Scripts with validation errors are listed but can't be started.
  isPlayable: boolean;
}

function entryId(entry: StoryEntry): string {
  return `${entry.source.type === "file" ? "file" : entry.source.type}:${entry.story.id}`;
}

function makeEntry(story: Story, source: StoryEntry["source"], playSource: StorySource): StoryEntry {
  return { story, source, playSource, isPlayable: isPlayable(story) };
}

/// Lists the built-in scripts and any the player opens, then moves on with the chosen one.
function NewGame({ hasSave, onChoose, onBack }: { hasSave: boolean; onChoose: (story: Story, source: StorySource) => void; onBack: () => void }) {
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [confirmsOverwrite, setConfirmsOverwrite] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    Promise.all([api.builtinStories(), api.library()]).then(([builtIn, library]) => {
      const list = [
        ...builtIn.map((s) => makeEntry(s.story, { type: "builtIn" }, s.source)),
        ...library.map((e) => makeEntry(e.story, { type: "library" }, { type: "library", id: e.story.id })),
      ];
      setEntries(list);
      setSelection((current) => current ?? (list.find((e) => e.isPlayable) ? entryId(list.find((e) => e.isPlayable)!) : null));
    });
  }, []);

  const selected = entries.find((e) => entryId(e) === selection);

  const start = useCallback(() => {
    if (selected) onChoose(selected.story, selected.playSource);
  }, [selected, onChoose]);

  const begin = () => (hasSave ? setConfirmsOverwrite(true) : start());

  const importStory = async () => {
    try {
      const path = await chooseStoryFile();
      if (!path) return;
      // Play from a private copy, so a saved game can reopen the story after the original moves.
      const opened = await api.openStoryToPlay(path);
      const name = path.split(/[/\\]/).pop() ?? path;
      const entry = makeEntry(opened.story, { type: "file", name }, opened.source);
      // Opening the same script again replaces the earlier copy instead of listing it twice.
      setEntries((list) => [...list.filter((e) => entryId(e) !== entryId(entry)), entry]);
      setSelection(entryId(entry));
    } catch (e) {
      setError({ title: t("Couldn't open story"), message: errorMessage(e) });
    }
  };

  useKeyboard((event) => {
    if (event.key === "Escape") {
      onBack();
      return true;
    }
    if (event.key === "Enter" && selected?.isPlayable) {
      begin();
      return true;
    }
  });

  return (
    <div className="chooser">
      <div>
        <button type="button" className="btn btn-glass" onClick={onBack}>
          <Icon name="chevron.left" size={14} />
          {t("Back")}
        </button>
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="column" style={{ gap: 6 }}>
          <h2>{t("Choose a story")}</h2>
          <span className="secondary">{t("Pick a built-in script, one you made in the Story Designer, or open a file.")}</span>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn-glass btn-large" title={t("Open a story file (.rpstory)")} onClick={importStory}>
          <Icon name="folder" size={15} />
          {t("More…")}
        </button>
      </div>

      <div className="chooser-list">
        {entries.map((entry) => (
          <StoryRow key={entryId(entry)} entry={entry} isSelected={entryId(entry) === selection} onSelect={() => setSelection(entryId(entry))} />
        ))}
      </div>

      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn btn-prominent btn-xl" disabled={!selected?.isPlayable} onClick={begin}>
          <Icon name="play.fill" size={15} />
          {t("Begin")}
        </button>
      </div>

      {confirmsOverwrite && (
        <Confirm
          title={t("Start a new game?")}
          message={t("Your saved progress will be replaced.")}
          confirmTitle={t("Start New Game")}
          onConfirm={start}
          onDismiss={() => setConfirmsOverwrite(false)}
        />
      )}
      {error && <Alert title={error.title} message={error.message} onDismiss={() => setError(null)} />}
    </div>
  );
}

function StoryRow({ entry, isSelected, onSelect }: { entry: StoryEntry; isSelected: boolean; onSelect: () => void }) {
  const { uiLanguage } = useSettings();
  const story = entry.story;
  const title = storyTitle(story);
  const chapterTitle = (() => {
    const node = entranceNode(story);
    return node ? findChapter(story, node.chapterId)?.title : undefined;
  })();
  const icon = entry.source.type === "builtIn" ? "book.closed" : entry.source.type === "library" ? "point.3.connected.trianglepath.dotted" : "doc.text";

  let badge: string;
  let upper = true;
  if (!entry.isPlayable) badge = t("Has errors");
  else if (entry.source.type === "builtIn") badge = t("Built-in");
  else if (entry.source.type === "library") badge = t("Your script");
  else {
    badge = entry.source.name;
    upper = false;
  }

  return (
    <button
      type="button"
      className={`story-row glass glass-interactive ${isSelected ? "glass-tinted" : ""}`}
      disabled={!entry.isPlayable}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <span className="badge-icon" style={{ color: isSelected ? "var(--accent)" : "var(--text-secondary)" }}>
        <Icon name={icon} size={22} />
      </span>
      <span className="column" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <span className="title" style={{ color: isSelected ? "var(--accent)" : undefined }}>
          {isBlank(title) ? t("Untitled Story") : resolve(title, uiLanguage)}
        </span>
        <span className="meta">
          {story.author && (
            <>
              <span>{t("by %@", story.author)}</span>
              <span>·</span>
            </>
          )}
          {chapterTitle && !isBlank(chapterTitle) && (
            <>
              <span>{resolve(chapterTitle, uiLanguage)}</span>
              <span>·</span>
            </>
          )}
          <span>{t("%lld nodes", story.nodes.length)}</span>
        </span>
      </span>
      <span className={`source-badge ${upper ? "upper" : ""}`} style={!entry.isPlayable ? { color: "var(--health)" } : undefined}>
        {badge}
      </span>
      <Icon name={isSelected ? "checkmark.circle.fill" : "circle"} size={20} style={{ color: isSelected ? "var(--accent)" : "var(--text-tertiary)" }} />
    </button>
  );
}

// MARK: Settings

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, soundOn, setSoundOn } = useSettings();
  useKeyboard(
    (event) => {
      if (event.key === "Enter") {
        onClose();
        return true;
      }
    },
    { blocking: true },
  );
  return (
    <Modal onClose={onClose} width={440}>
      <div style={{ padding: "24px 24px 0" }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>
          {t("Settings")}
        </h2>
      </div>
      <div className="form">
        <FormSection>
          <FormRow label={t("Language")}>
            <Select
              value={language}
              ariaLabel={t("Language")}
              options={APP_LANGUAGES.map((l) => ({ value: l, label: appLanguageName(l) }))}
              onChange={(value) => setLanguage(value as AppLanguage)}
            />
          </FormRow>
          <FormRow label={t("Sound")}>
            <Toggle on={soundOn} onChange={setSoundOn} label={t("Sound")} />
          </FormRow>
        </FormSection>
      </div>
      <div className="row" style={{ padding: "0 24px 24px" }}>
        <span className="spacer" />
        <button type="button" className="btn btn-prominent" onClick={onClose}>
          {t("Done")}
        </button>
      </div>
    </Modal>
  );
}
