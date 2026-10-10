// The designer's start page: the player's scripts, plus ways to start a new one.

import { useCallback, useEffect, useState } from "react";
import { api, chooseStoryFile, errorMessage, type LibraryEntry } from "../api";
import { Alert, Confirm, contextMenu, EmptyState, useKeyboard, isCommand } from "../components/ui";
import { formatRelative, t } from "../i18n";
import { Icon } from "../icons";
import { storyTitle } from "../model/story";
import { isBlank, resolve } from "../model/storyText";
import type { Story } from "../model/types";
import { validate } from "../model/validator";
import { LanguageMenuButton } from "../screens/game/GameView";
import { storyLanguageFor, useSettings } from "../settings";
import { StoryDocument } from "./document";

export function DesignerHome({ onBack, onOpen }: { onBack: () => void; onOpen: (document: StoryDocument) => void }) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [example, setExample] = useState<Story | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<LibraryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uiLanguage } = useSettings();
  /// New text is written in the app's current language.
  const language = storyLanguageFor(uiLanguage);

  const reload = useCallback(() => {
    api.library().then(setEntries).catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    reload();
    api.builtinStories().then((stories) => setExample(stories[0]?.story ?? null));
  }, [reload]);

  const newScript = () => onOpen(StoryDocument.newStory(language));

  const openExample = async () => {
    if (!example) return;
    const copy: Story = { ...example, id: crypto.randomUUID().toUpperCase() };
    const document = new StoryDocument(copy, language);
    await document.saveNow();
    onOpen(document);
  };

  const duplicate = async (story: Story) => {
    try {
      await api.saveToLibrary({ ...story, id: crypto.randomUUID().toUpperCase() });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openFile = async () => {
    try {
      const path = await chooseStoryFile();
      if (!path) return;
      onOpen(new StoryDocument(await api.importToLibrary(path), language));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useKeyboard((event) => {
    if (event.key === "Escape") {
      onBack();
      return true;
    }
    if (isCommand(event) && event.key.toLowerCase() === "n") {
      newScript();
      return true;
    }
  });

  return (
    <div className="chooser" style={{ animation: "fade-in 0.3s ease" }}>
      <div>
        <button type="button" className="btn btn-glass" onClick={onBack}>
          <Icon name="chevron.left" size={14} />
          {t("Back")}
        </button>
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="column" style={{ gap: 6 }}>
          <h2>{t("Story Designer")}</h2>
          <span className="secondary">{t("Wire nodes together to build your own script, then play it from New Game.")}</span>
        </div>
        <span className="spacer" />
        <LanguageMenuButton />
      </div>

      <div className="row" style={{ gap: 12 }}>
        <button type="button" className="btn btn-prominent btn-large" onClick={newScript}>
          <Icon name="plus" size={15} />
          {t("New Script")}
        </button>
        <button
          type="button"
          className="btn btn-glass btn-large"
          disabled={!example}
          title={example ? t("Make an editable copy of %@", resolve(storyTitle(example), uiLanguage)) : undefined}
          onClick={openExample}
        >
          <Icon name="book.closed" size={15} />
          {t("Start from Example")}
        </button>
        <button type="button" className="btn btn-glass btn-large" onClick={openFile}>
          <Icon name="folder" size={15} />
          {t("Open File…")}
        </button>
      </div>

      {entries !== null && entries.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <EmptyState symbol="point.3.connected.trianglepath.dotted" title={t("No scripts yet")}>
            {t("Create a new script, or start from the example story.")}
          </EmptyState>
        </div>
      ) : (
        <div className="chooser-list">
          {(entries ?? []).map((entry) => (
            <ScriptRow
              key={entry.story.id}
              entry={entry}
              onOpen={() => onOpen(new StoryDocument(entry.story, language))}
              onDuplicate={() => duplicate(entry.story)}
              onDelete={() => setPendingDeletion(entry)}
            />
          ))}
        </div>
      )}

      {pendingDeletion && (
        <Confirm
          title={t("Delete this script?")}
          message={t("This can’t be undone. Exported copies aren’t affected.")}
          confirmTitle={t("Delete")}
          onConfirm={async () => {
            try {
              await api.deleteFromLibrary(pendingDeletion.story.id);
            } catch (e) {
              setError(errorMessage(e));
            }
            reload();
          }}
          onDismiss={() => setPendingDeletion(null)}
        />
      )}
      {error && <Alert title={t("Couldn't open script")} message={error} onDismiss={() => setError(null)} />}
    </div>
  );
}

function ScriptRow({ entry, onOpen, onDuplicate, onDelete }: {
  entry: LibraryEntry;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { uiLanguage } = useSettings();
  const errors = validate(entry.story).filter((i) => i.severity === "error").length;
  const title = storyTitle(entry.story);
  return (
    <button
      type="button"
      className="library-row glass glass-interactive"
      onClick={onOpen}
      {...contextMenu(() => [
        { label: t("Duplicate"), icon: "plus.square.on.square", action: onDuplicate },
        { label: t("Delete"), icon: "trash", destructive: true, action: onDelete },
      ])}
    >
      <span className="tile-icon accent">
        <Icon name="point.3.connected.trianglepath.dotted" size={22} />
      </span>
      <span className="column" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <span className="serif" style={{ fontSize: 22 }}>
          {isBlank(title) ? t("Untitled Story") : resolve(title, uiLanguage)}
        </span>
        <span className="callout secondary">
          {t("%lld nodes", entry.story.nodes.length)} · {t("Edited %@", formatRelative(new Date(entry.modified)))}
        </span>
      </span>
      {errors > 0 ? (
        <span className="row caption" style={{ gap: 5, fontWeight: 600, color: "var(--health)" }}>
          <Icon name="xmark.octagon" size={13} />
          {t("%lld errors", errors)}
        </span>
      ) : (
        <span className="row caption accent" style={{ gap: 5, fontWeight: 600 }}>
          <Icon name="checkmark.seal" size={13} />
          {t("Playable")}
        </span>
      )}
      <Icon name="chevron.right" size={15} className="tertiary" />
    </button>
  );
}
