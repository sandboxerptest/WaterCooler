"use client";

import "./character-studio.css";
import "./world-ui.css";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DoorOpen } from "lucide-react";
import { useCharacterRoster } from "@/lib/characters/roster";
import { textureKeyFor, type RosterCharacter } from "@/lib/characters/library";
import { isComplete, profileSnapshot, saveProfile, subscribeToProfile } from "@/lib/profile";
import { registerProfile } from "@/lib/people-client";
import { addressFromLocation } from "@/lib/world/floors";
import { ORGANISATIONS } from "@/lib/world/tenants";
import { WORLD_PATH, isOutdoorPath } from "@/lib/world/paths";

const PORTRAIT_SCALE = 1.5;
const NAME_LIMIT = 16;

/**
 * The way in.
 *
 * Before anyone can walk into the world they say who they are: a name, the
 * building they belong to, and the character they will be. Until all three
 * are chosen this covers the office; once they are, it steps aside and takes
 * the person to their home building's lobby.
 *
 * The bare app (/) is not a place. With a profile it forwards to the world
 * map, where the game begins.
 */
export default function Welcome() {
  // Null on the server, so nothing renders there; the client decides.
  const profile = useSyncExternalStore(subscribeToProfile, profileSnapshot, () => null);
  const done = !!profile && isComplete(profile);
  const { characters, error } = useCharacterRoster();

  const [name, setName] = useState("");
  const [home, setHome] = useState<string | null>(null);
  const [character, setCharacter] = useState<RosterCharacter | null>(null);

  useEffect(() => {
    if (!done || !profile?.home) return;
    if (!addressFromLocation(window.location) && !isOutdoorPath(window.location.pathname)) {
      window.location.replace(WORLD_PATH);
    }
  }, [done, profile]);

  if (!profile || done) return null;

  const trimmed = name.trim().slice(0, NAME_LIMIT);
  const ready = trimmed.length > 0 && !!home && !!character;

  const walkIn = async () => {
    if (!ready || !home || !character) return;
    saveProfile({
      name: trimmed,
      home,
      character: { key: textureKeyFor(character), path: character.sheetUrl },
    });
    // Put a desk with this name on the building's floor, then walk in: the
    // game begins on the world map, by the fountain.
    await registerProfile(profileSnapshot());
    window.location.assign(WORLD_PATH);
  };

  return createPortal(
    <div className="studio-overlay">
      <div className="welcome" role="dialog" aria-label="Welcome">
        <header>
          <h2 className="welcome__title">
            <DoorOpen size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Welcome
          </h2>
          <p className="welcome__lead">
            Tell us who you are, where you work, and what you look like — then walk in.
          </p>
        </header>

        <section className="welcome__step">
          <label className="welcome__label" htmlFor="welcome-name">
            Your name
          </label>
          <input
            id="welcome-name"
            className="pixel-input"
            autoFocus
            value={name}
            maxLength={NAME_LIMIT}
            placeholder="What should people call you?"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") void walkIn();
            }}
          />
        </section>

        <section className="welcome__step">
          <div className="welcome__label">Your home office</div>
          <div className="welcome__homes">
            {ORGANISATIONS.map((company) => (
              <button
                key={company.slug}
                type="button"
                className={`welcome-home${home === company.slug ? " welcome-home--chosen" : ""}`}
                onClick={() => setHome(company.slug)}
                aria-pressed={home === company.slug}
              >
                <span className="welcome-home__name">{company.name}</span>
                <span className="welcome-home__tagline">{company.tagline}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="welcome__step">
          <div className="welcome__label">
            {characters.length
              ? "Your character"
              : error
                ? `Could not load characters: ${error}`
                : "Loading characters…"}
          </div>
          <div className="welcome__characters">
            {characters.map((candidate) => {
              const chosen = character?.id === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={`welcome-character${chosen ? " welcome-character--chosen" : ""}`}
                  onClick={() => setCharacter(candidate)}
                  aria-pressed={chosen}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- pixel art; next/image would only resample it */}
                  <img
                    src={candidate.portraitUrl}
                    alt=""
                    width={48 * PORTRAIT_SCALE}
                    height={96 * PORTRAIT_SCALE}
                    style={{ imageRendering: "pixelated" }}
                  />
                  <span>{candidate.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="welcome__actions">
          <span className="welcome__hint">
            Kept in this browser. Your desk is on Floor 1 of your home building.
          </span>
          <button
            type="button"
            className="pixel-button pixel-button--primary"
            onClick={() => void walkIn()}
            disabled={!ready}
          >
            Walk in
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
