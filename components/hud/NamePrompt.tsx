"use client";

import { useState, useSyncExternalStore } from "react";
import { loadPlayerName, savePlayerName } from "@/lib/persistence";

/**
 * Ask who you are, once per browser.
 *
 * Without this everyone arrives as "Guest", which makes a shared room
 * unreadable the moment a second person walks in. The name is a device
 * preference rather than an account: the room link is the only credential.
 */
/** Whether a name is set is a client-only fact, so SSR must not read it. */
const subscribeToNothing = () => () => {};
const readHasName = () => loadPlayerName() !== "Guest";
/** On the server, assume a name exists so the prompt never renders there. */
const hasNameOnServer = () => true;

export default function NamePrompt() {
  const hasName = useSyncExternalStore(subscribeToNothing, readHasName, hasNameOnServer);
  const [dismissed, setDismissed] = useState(false);
  const [value, setValue] = useState("");

  if (hasName || dismissed) return null;

  const submit = () => {
    const trimmed = value.trim().slice(0, 16);
    if (!trimmed) return;
    savePlayerName(trimmed);
    setDismissed(true);
    // The room socket sends the name when it joins, so pick it up cleanly
    window.location.reload();
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.72)",
        zIndex: 40,
      }}
      role="dialog"
      aria-label="Choose a display name"
    >
      <div
        className="pixel-panel"
        style={{ padding: 20, width: 300, display: "grid", gap: 12, textAlign: "center" }}
      >
        <div style={{ fontSize: "10px" }}>What should people call you?</div>
        <input
          className="pixel-input"
          autoFocus
          value={value}
          maxLength={16}
          placeholder="Your name"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          className="pixel-button pixel-button--primary"
          onClick={submit}
          disabled={!value.trim()}
        >
          Walk in
        </button>
        <div style={{ fontSize: "8px", color: "var(--pixel-muted)" }}>
          Shown above your character to everyone in this room.
        </div>
      </div>
    </div>
  );
}
