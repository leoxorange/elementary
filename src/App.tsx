// The app's root: routes between the welcome page, the story designer, and the game.

import { useState } from "react";
import { MenuHost } from "./components/ui";
import { DesignerHome } from "./designer/DesignerHome";
import { DesignerView } from "./designer/DesignerView";
import type { StoryDocument } from "./designer/document";
import { GameState } from "./game/gameState";
import { GameView } from "./screens/game/GameView";
import { Welcome } from "./screens/Welcome";
import { SettingsProvider } from "./settings";

type Screen =
  | { type: "welcome" }
  | { type: "designerHome" }
  | { type: "designer"; document: StoryDocument }
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
          onStart={(game) => setScreen({ type: "game", game, returnTo: null })}
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
          onPlaytest={(game) => setScreen({ type: "game", game, returnTo: screen.document })}
        />
      );
      break;
    case "game": {
      const { game, returnTo } = screen;
      content = (
        <GameView
          // A fresh identity per game resets per-game view state such as the selected section.
          key={game.id}
          game={game}
          onMainMenu={() => setScreen(returnTo ? { type: "designer", document: returnTo } : { type: "welcome" })}
          onPlayAgain={() => {
            try {
              setScreen({ type: "game", game: GameState.start(game.story, game.source), returnTo });
            } catch {
              // The story was playable a moment ago, so this doesn't happen; staying put is the safe fallback.
            }
          }}
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
