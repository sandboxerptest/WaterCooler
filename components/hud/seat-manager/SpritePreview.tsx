"use client";

import { useCharacterRoster } from "@/lib/characters/roster";
import { textureKeyFor } from "@/lib/characters/library";

interface SpritePreviewProps {
  selectedSpriteKey: string;
  busy: boolean;
  onSelectSprite: (spriteKey: string, spritePath: string, spriteLabel: string) => void;
}

/**
 * Every character an agent can be — the library and everything uploaded.
 *
 * Portraits come from the portrait route rather than the full sheet as a CSS
 * background; a grid of full sheets is a grid of 21-megapixel decodes.
 */
export default function SpritePreview({
  selectedSpriteKey,
  busy,
  onSelectSprite,
}: SpritePreviewProps) {
  const { characters, error } = useCharacterRoster();

  return (
    <div className="seat-manager__sprite-grid">
      {error && (
        <p style={{ fontSize: 8, color: "var(--pixel-red, #e07070)", gridColumn: "1 / -1" }}>
          Could not load the character list: {error}
        </p>
      )}
      {characters.map((character) => {
        const key = textureKeyFor(character);
        const active = key === selectedSpriteKey;
        return (
          <button
            key={character.id}
            type="button"
            className={`seat-card ${active ? "seat-card--active" : ""}`}
            onClick={() => onSelectSprite(key, character.sheetUrl, character.name)}
            disabled={busy}
            style={{ opacity: busy ? 0.65 : 1, cursor: busy ? "not-allowed" : "pointer" }}
          >
            <div className="seat-manager__sprite-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- our own generated PNG; next/image would only add a resize step to pixel art */}
              <img
                src={character.portraitUrl}
                alt={character.name}
                width={48 * 1.1}
                height={96 * 1.1}
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <div style={{ fontSize: 9, marginTop: 8 }}>{character.name}</div>
            <div style={{ fontSize: 7, color: "var(--pixel-muted)", marginTop: 2 }}>
              {character.source === "library"
                ? "library"
                : character.source === "photo"
                  ? "from a photo"
                  : "uploaded"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
