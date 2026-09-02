/**
 * Reads a picture and decides what the character made from it should look like.
 *
 * Worth being precise about what this does and does not do: Claude does not
 * draw the sprite. The Anthropic API takes images in and returns text, so the
 * model's job here is *perception* — look at the photo, name the colours — and
 * the drawing is done deterministically afterwards by re-skinning a library
 * sheet (see lib/pixel/character.ts). That split is what makes the result
 * pixel-perfect: the geometry is the artist's and never varies, and the only
 * thing the model influences is a handful of hex values.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../logger";
import { BASE_COLOURS, type CharacterColours, type CharacterRole } from "../pixel/character";

const log = createLogger("Character AI");

/** Image types the vision API accepts. */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export function isAcceptedType(value: string): value is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(value);
}

export interface CharacterDescription extends CharacterColours {
  /** A short name for the character, drawn from what the picture shows. */
  name: string;
  /** One line on what was recognised, shown back to the person. */
  notes: string;
}

const HEX = "^#[0-9a-fA-F]{6}$";

const SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "A short, friendly first name for this character. One or two words.",
    },
    hair: { type: "string", pattern: HEX, description: "Hair colour as #rrggbb" },
    skin: { type: "string", pattern: HEX, description: "Skin tone as #rrggbb" },
    outfit: { type: "string", pattern: HEX, description: "Main clothing colour as #rrggbb" },
    shoes: { type: "string", pattern: HEX, description: "Footwear colour as #rrggbb" },
    notes: {
      type: "string",
      description: "One short sentence describing what you saw. No more than 15 words.",
    },
  },
  required: ["name", "hair", "skin", "outfit", "shoes", "notes"],
  additionalProperties: false,
} as const;

const FORMAT = { type: "json_schema", schema: SCHEMA } as const;

const SYSTEM = `You pick colours for a 48x96 pixel-art office character in the LimeZu "Modern Interiors" style.

You are given a picture. Read the dominant colours off the subject and return them as hex.

Rules that matter for how the sprite will look:
- Return mid-tones, not highlights or shadows. The renderer builds a light and a
  dark shade around whatever you give it, so a colour that is already very light
  or very dark leaves it no room and the sprite comes out flat.
- Skin must be a plausible skin tone. Read it from the subject and keep it in the
  range real skin occupies, from very light to very deep.
- Hair is the hair on the head. If the subject has no visible hair, choose a
  colour that suits the rest of the picture rather than refusing.
- Outfit is the single most prominent clothing colour on the upper body.
- Shoes may be guessed from the palette if they are not visible.
- If the picture is not of a person — an animal, an object, a landscape — build a
  character inspired by its colours instead. Never refuse; there is always a
  reasonable answer.

Keep the four colours distinct enough to read at 48 pixels tall.`;

/** Test seam: swap the client for one that does not call the network. */
export type MessageCreator = Pick<Anthropic["messages"], "create">;

let clientOverride: MessageCreator | null = null;

export function setMessagesClient(client: MessageCreator | null) {
  clientOverride = client;
}

function messagesClient(): MessageCreator {
  if (clientOverride) return clientOverride;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("No ANTHROPIC_API_KEY set on the server — characters cannot be generated.");
  }
  return new Anthropic().messages;
}

const ROLES: CharacterRole[] = ["hair", "skin", "outfit", "shoes"];

/**
 * Falls back rather than fails.
 *
 * A missing or malformed colour is not worth losing the whole character over —
 * the base sheet's own colour is always a valid answer, and the person can
 * edit it afterwards.
 */
export function coerceDescription(raw: unknown): CharacterDescription {
  const value = (raw ?? {}) as Record<string, unknown>;
  const hex = (role: CharacterRole) => {
    const v = value[role];
    return typeof v === "string" && new RegExp(HEX).test(v.trim())
      ? v.trim().toLowerCase()
      : BASE_COLOURS[role];
  };

  const name = typeof value.name === "string" ? value.name.trim().slice(0, 24) : "";
  const notes = typeof value.notes === "string" ? value.notes.trim().slice(0, 140) : "";

  const out = { name: name || "New hire", notes } as CharacterDescription;
  for (const role of ROLES) out[role] = hex(role);
  return out;
}

export interface AnalyseOptions {
  image: Buffer;
  mediaType: AcceptedType;
  /** Anything the person typed alongside the picture. */
  hint?: string;
}

export async function describeCharacter(options: AnalyseOptions): Promise<CharacterDescription> {
  const messages = messagesClient();

  const response = await messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: FORMAT },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: options.mediaType,
              data: options.image.toString("base64"),
            },
          },
          {
            type: "text",
            text: options.hint?.trim()
              ? `Build a character from this picture. The person adds: ${options.hint.trim()}`
              : "Build a character from this picture.",
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read that picture. Try a different one.");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("The model returned no description.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    log.error("unparseable description:", text.text.slice(0, 300));
    throw new Error("The model's description could not be read.");
  }

  const described = coerceDescription(parsed);
  log.info(`described "${described.name}": ${ROLES.map((r) => `${r} ${described[r]}`).join(", ")}`);
  return described;
}
