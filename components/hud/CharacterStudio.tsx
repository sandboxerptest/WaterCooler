"use client";

import "./character-studio.css";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X, Shirt } from "lucide-react";
import { gameEvents } from "@/lib/events";
import { useCharacterRoster } from "@/lib/characters/roster";
import { textureKeyFor, type RosterCharacter } from "@/lib/characters/library";
import { rememberCharacter, rememberedKey, subscribeToChoice } from "@/lib/characters/choice";

/** Portrait frame, shown at the same 2.4x the seat manager uses. */
const PORTRAIT_SCALE = 2.4;

/**
 * Who you are in the office.
 *
 * A picker, deliberately nothing more: the roster is the set of premade
 * characters, the same set an agent can be given in the seat manager, and a
 * person chooses one of them. The choice is remembered in this browser and
 * put back on at the next visit.
 */
export default function CharacterStudio({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { characters, error, refresh } = useCharacterRoster();
  // Storage is the source of truth for what is worn: the scene writes it on a
  // successful load and clears it on a failed one, and this follows either.
  const wearing = useSyncExternalStore(subscribeToChoice, rememberedKey, () => null);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const wear = (character: RosterCharacter) => {
    const key = textureKeyFor(character);
    gameEvents.emit("player-sprite-chosen", key, character.sheetUrl);
    rememberCharacter({ key, path: character.sheetUrl });
  };

  if (!open) return null;

  // Rendered into the body rather than in place. The HUD layer sets
  // `z-index: 20` on a positioned element, which makes it a stacking context:
  // any z-index used inside it is capped at 20, and the chat column at 30
  // paints straight over a dialog that believes it is at 100.
  return createPortal(
    <div className="studio-overlay" onClick={onClose}>
      <div
        className="studio"
        role="dialog"
        aria-label="Choose a character"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="studio__header">
          <h2 className="studio__title">
            <Shirt size={14} aria-hidden /> Choose a character
          </h2>
          <button className="studio__close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <section className="studio__gallery-wrap">
          <h3 className="studio__subtitle">
            {characters.length
              ? `${characters.length} to choose from — pick one to play as`
              : error
                ? `Could not load characters: ${error}`
                : "Loading characters…"}
          </h3>
          <div className="studio__gallery">
            {characters.map((character) => {
              const key = textureKeyFor(character);
              const worn = wearing === key;
              return (
                <article
                  key={character.id}
                  className={`studio-card${worn ? " studio-card--worn" : ""}`}
                >
                  <div className="studio-card__art">
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own generated PNG; next/image would only add a resize step to pixel art */}
                    <img
                      src={character.portraitUrl}
                      alt={character.name}
                      width={48 * PORTRAIT_SCALE}
                      height={96 * PORTRAIT_SCALE}
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                  <h4 className="studio-card__name">{character.name}</h4>
                  {character.notes && <p className="studio-card__notes">{character.notes}</p>}
                  <button
                    className="studio-card__wear"
                    onClick={() => wear(character)}
                    disabled={worn}
                  >
                    {worn ? "You’re wearing this" : "Play as this"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
