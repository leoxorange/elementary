// The app's root: routes between the welcome page, the story designer, and the game.

import { useState } from "react";
import { MenuHost } from "./components/ui";
import { DesignerHome } from "./designer/DesignerHome";
import { DesignerView } from "./designer/DesignerView";
import type { StoryDocument } from "./designer/document";
import { GameState } from "./game/gameState";
import type { Story, StorySource } from "./model/types";
import { GameView } from "./screens/game/GameView";
import { HeroCreation } from "./screens/HeroCreation";
import { Welcome } from "./screens/Welcome";
import { SettingsProvider } from "./settings";

type Screen =
  | { type: "welcome"; page?: "newGame" }
  | { type: "designerHome" }
  | { type: "designer"; document: StoryDocument }
  /// Choosing or creating the hero for a new game. Play-tests have no source and return to the designer.
  | { type: "hero"; story: Story; source: StorySource | null; returnTo: StoryDocument | null }
  /// A game, and the designer document to return to if it's a play-test.
  | { type: "game"; game: GameState; returnTo: StoryDocument | null };

export default function App() {
  return (
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  );
}

function Root() {
  const [screen, setScreen] = useState<Screen>({ type: "welcome" });

  let content;
  switch (screen.type) {
    case "welcome":
      content = (
        <Welcome
          initialPage={screen.page}
          onStart={(game) => setScreen({ type: "game", game, returnTo: null })}
          onNewGame={(story, source) => setScreen({ type: "hero", story, source, returnTo: null })}
          onOpenDesigner={() => setScreen({ type: "designerHome" })}
        />
      );
      break;
    case "designerHome":
      content = (
        <DesignerHome onBack={() => setScreen({ type: "welcome" })} onOpen={(document) => setScreen({ type: "designer", document })} />
      );
      break;
    case "designer":
      content = (
        <DesignerView
          document={screen.document}
          onClose={() => setScreen({ type: "designerHome" })}
          onPlaytest={(story) => setScreen({ type: "hero", story, source: null, returnTo: screen.document })}
        />
      );
      break;
    case "hero": {
      const { story, source, returnTo } = screen;
      content = (
        <HeroCreation
          story={story}
          source={source}
          onStart={(game) => setScreen({ type: "game", game, returnTo })}
          onBack={() => setScreen(returnTo ? { type: "designer", document: returnTo } : { type: "welcome", page: "newGame" })}
        />
      );
      break;
    }
    case "game": {
      const { game, returnTo } = screen;
      content = (
        <GameView
          // A fresh identity per game resets per-game view state such as the selected section.
          key={game.id}
          game={game}
          onMainMenu={() => setScreen(returnTo ? { type: "designer", document: returnTo } : { type: "welcome" })}
          // Playing again starts over from choosing a hero, so the next run can be someone else.
          onPlayAgain={() => setScreen({ type: "hero", story: game.story, source: game.source, returnTo })}
        />
      );
      break;
    }
  }

  return (
    <div className="app-root">
      {content}
      <MenuHost />
    </div>
  );
}
