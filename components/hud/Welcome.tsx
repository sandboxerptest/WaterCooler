"use client";

import "./character-studio.css";
import "./world-ui.css";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DoorOpen, LogIn, UserRound } from "lucide-react";
import { signIn } from "next-auth/react";
import { useCharacterRoster } from "@/lib/characters/roster";
import { textureKeyFor, type RosterCharacter } from "@/lib/characters/library";
import { NAME_LIMIT } from "@/lib/accounts";
import { adoptAccount, saveAccountProfile, useMe } from "@/lib/account-client";
import {
  chooseGuest,
  isComplete,
  profileSnapshot,
  saveProfile,
  subscribeToProfile,
} from "@/lib/profile";
import { registerProfile } from "@/lib/people-client";
import { addressFromLocation } from "@/lib/world/floors";
import { ORGANISATIONS } from "@/lib/world/tenants";
import { WORLD_PATH, isOutdoorPath } from "@/lib/world/paths";

const PORTRAIT_SCALE = 1.5;
const NO_NAME = "Guest";

/**
 * The way in.
 *
 * Before anyone can walk into the world they say who they are: a name, the
 * building they belong to, and the character they will be. Until all three
 * are chosen this covers the office; once they are, it steps aside and takes
 * the person to the world map.
 *
 * With sign-in set up, the first step is to sign in with Google or
 * Microsoft — or to go on as a guest, which keeps the profile in this
 * browser and nothing on the server. An account that has chosen before is
 * let straight through: its profile is mirrored into this browser and the
 * game reads it as it reads a guest's. Without sign-in, the profile lives
 * in this browser as it always did.
 *
 * The bare app (/) is not a place. With a profile it forwards to the world
 * map, where the game begins.
 */
export default function Welcome() {
  // Null on the server, so nothing renders there; the client decides.
  const profile = useSyncExternalStore(subscribeToProfile, profileSnapshot, () => null);
  const me = useMe();
  const authOn = me?.auth.enabled ?? false;
  const account = me?.account ?? null;
  // A guest's browser profile is enough; a signed-in person's must be the
  // account's, so a profile left here by someone else does not let them in.
  const guest = !authOn || (!account && !!profile?.guest);
  const done = !!profile && isComplete(profile) && (guest || !!account?.profile);
  const { characters, error } = useCharacterRoster();

  const [typedName, setTypedName] = useState<string | null>(null);
  const [pickedHome, setPickedHome] = useState<string | null>(null);
  const [pickedCharacter, setPickedCharacter] = useState<RosterCharacter | null>(null);
  const [walking, setWalking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // An account's profile comes into this browser as soon as it is known.
  useEffect(() => {
    if (account) adoptAccount(account);
  }, [account]);

  useEffect(() => {
    if (!done) return;
    if (!addressFromLocation(window.location) && !isOutdoorPath(window.location.pathname)) {
      window.location.replace(WORLD_PATH);
    }
  }, [done]);

  if (!profile || !me || done) return null;

  // What is already known goes in first: the account's name, or a guest's from last time.
  const suggestedName =
    account?.profile?.name ??
    account?.displayName ??
    (profile.name === NO_NAME ? "" : profile.name);
  const name = (typedName ?? suggestedName).slice(0, NAME_LIMIT);
  const trimmed = name.trim();
  const home = pickedHome ?? account?.profile?.home ?? profile.home;
  const rememberedKey = account?.profile?.character.key ?? profile.character?.key ?? null;
  const character =
    pickedCharacter ?? characters.find((c) => textureKeyFor(c) === rememberedKey) ?? null;
  const ready = trimmed.length > 0 && !!home && !!character && !walking;

  const walkIn = async () => {
    if (!ready || !home || !character) return;
    const next = {
      name: trimmed,
      home,
      character: { key: textureKeyFor(character), path: character.sheetUrl },
    };
    setWalking(true);
    setRefusal(null);
    if (account) {
      const saved = await saveAccountProfile(next);
      if (!saved) {
        setRefusal("That could not be saved. Try again in a moment.");
        setWalking(false);
        return;
      }
      adoptAccount(saved);
    } else {
      saveProfile(next);
    }
    // Put a desk with this name on the building's floor, then walk in: the
    // game begins on the world map, by the fountain.
    await registerProfile(profileSnapshot());
    window.location.assign(WORLD_PATH);
  };

  const signInWith = (provider: string) => {
    void signIn(provider, { redirectTo: window.location.pathname });
  };

  const needsSignIn = authOn && !account && !guest;

  return createPortal(
    <div className="studio-overlay">
      <div className="welcome" role="dialog" aria-label="Welcome">
        <header>
          <h2 className="welcome__title">
            <DoorOpen size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Welcome
          </h2>
          <p className="welcome__lead">
            {needsSignIn
              ? "Sign in to walk in. Your desk, your character and your record are kept under your email."
              : "Tell us who you are, where you work, and what you look like — then walk in."}
          </p>
        </header>

        {needsSignIn ? (
          <section className="welcome__step">
            <div className="welcome__providers">
              {me.auth.providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className="pixel-button pixel-button--primary welcome-provider"
                  onClick={() => signInWith(provider.id)}
                >
                  <LogIn size={12} aria-hidden /> Sign in with {provider.label}
                </button>
              ))}
              <button
                type="button"
                className="pixel-button welcome-provider"
                onClick={() => chooseGuest(true)}
              >
                <UserRound size={12} aria-hidden /> Continue as a guest
              </button>
            </div>
            <p className="welcome__hint welcome__hint--block">
              A guest is kept in this browser only: nothing about you is saved, and your desk and
              character do not follow you to another device.
            </p>
          </section>
        ) : (
          <>
            {authOn && !account && (
              <div className="welcome__account">
                <span>Going on as a guest.</span>
                <button type="button" className="welcome__link" onClick={() => chooseGuest(false)}>
                  Sign in instead
                </button>
              </div>
            )}
            {account && (
              <div className="welcome__account">
                {account.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar, any host
                  <img src={account.image} alt="" />
                )}
                <span>Signed in as {account.email}</span>
              </div>
            )}

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
                onChange={(event) => setTypedName(event.target.value)}
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
                    onClick={() => setPickedHome(company.slug)}
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
                      onClick={() => setPickedCharacter(candidate)}
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
                {refusal ? (
                  <span className="welcome__error">{refusal}</span>
                ) : account ? (
                  "Kept under your email. Your desk is on Floor 1 of your home building."
                ) : (
                  "Kept in this browser only. Your desk is on Floor 1 of your home building."
                )}
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
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
