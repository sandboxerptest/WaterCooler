/**
 * Asks Claude which way each pose on a sheet is facing.
 *
 * Finding the figures is geometry and needs no model. Knowing that figure 3 is
 * the back view and figure 7 is mid-stride is perception, and that is what the
 * model is for. It sees the original picture, is told where each figure was
 * found and how they are numbered, and returns a facing and a kind for each.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../logger";
import type { DetectedPose } from "../pixel/ingest";
import { FACINGS, KINDS, sanitiseAssignments, type Assignment } from "../pixel/compose";

const log = createLogger("Character AI");

export interface SheetReading {
  name: string;
  notes: string;
  assignments: Assignment[];
}

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "A short first name for this character." },
    notes: {
      type: "string",
      description: "One sentence on who this is and what they wear. Under 20 words.",
    },
    poses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pose: { type: "integer", description: "The figure's number." },
          facing: { type: "string", enum: [...FACINGS] },
          kind: { type: "string", enum: [...KINDS] },
        },
        required: ["pose", "facing", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "notes", "poses"],
  additionalProperties: false,
} as const;

const FORMAT = { type: "json_schema", schema: SCHEMA } as const;

const SYSTEM = `You are reading a character sprite sheet so its poses can be placed into a game.

The game is top-down. Each figure must be labelled with:
- facing: the direction the character's body faces on screen.
    "down"  = facing the viewer (you can see the face)
    "up"    = facing away (you see the back of the head)
    "left"  = side view, character's nose points to the picture's left
    "right" = side view, nose points to the picture's right
- kind: "walk" if the figure is mid-stride — legs apart, a foot lifted, leaning
  into a step. Otherwise "idle", which includes standing, holding things,
  waving, pointing and every other pose that is not walking.

Label every figure. Do not skip any and do not invent extra ones. Figures that
are sitting, lying down or otherwise not upright are still labelled: use their
facing, and "idle".`;

/** Test seam: the same one describeCharacter uses. */
export type MessageCreator = Pick<Anthropic["messages"], "create">;
let clientOverride: MessageCreator | null = null;
export function setPosesClient(client: MessageCreator | null) {
  clientOverride = client;
}

function messagesClient(): MessageCreator {
  if (clientOverride) return clientOverride;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("No ANTHROPIC_API_KEY set on the server — sheets cannot be read.");
  }
  return new Anthropic().messages;
}

/** Text the model reads alongside the picture: where each figure is. */
export function describeLayout(poses: DetectedPose[], width: number, height: number): string {
  const rows = Math.max(...poses.map((p) => p.row), -1) + 1;
  const lines = [
    `The picture is ${width}x${height} pixels and holds ${poses.length} figures in ${rows} rows.`,
    `They are numbered in reading order — each row left to right, top row first:`,
  ];
  for (const p of poses) {
    const i = poses.indexOf(p);
    const cx = Math.round(p.box.x + p.box.width / 2);
    const cy = Math.round(p.box.y + p.box.height / 2);
    lines.push(`  figure ${i}: row ${p.row}, column ${p.column}, centred at (${cx}, ${cy})`);
  }
  return lines.join("\n");
}

export async function readSheet(
  imagePng: Buffer,
  poses: DetectedPose[],
  width: number,
  height: number,
): Promise<SheetReading> {
  const response = await messagesClient().create({
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
            source: { type: "base64", media_type: "image/png", data: imagePng.toString("base64") },
          },
          { type: "text", text: describeLayout(poses, width, height) },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read that sheet. Try a different one.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("The model returned no reading.");

  let parsed: { name?: unknown; notes?: unknown; poses?: unknown };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    // The tail is what tells truncation from garbage.
    log.error(
      `unparseable sheet reading (stop_reason=${response.stop_reason}, ${text.text.length} chars), ends: …${text.text.slice(-160)}`,
    );
    throw new Error(
      response.stop_reason === "max_tokens"
        ? "The reading was cut short. Try a sheet with fewer figures."
        : "The model's reading could not be understood.",
    );
  }

  const assignments = sanitiseAssignments(parsed.poses, poses.length);
  if (assignments.length === 0) {
    throw new Error("The model could not match any figure to a direction.");
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 24) : "";
  const notes = typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 140) : "";
  const breakdown = FACINGS.map(
    (f) => `${f} ${assignments.filter((a) => a.facing === f).length}`,
  ).join(", ");
  log.info(
    `read sheet "${name || "unnamed"}": ${assignments.length}/${poses.length} figures — ${breakdown}`,
  );
  // Per figure, so a wrong slot can be traced to the label that caused it.
  log.info(
    assignments
      .map((a) => `${a.pose}(r${poses[a.pose].row}):${a.facing[0]}${a.kind === "walk" ? "*" : ""}`)
      .join(" "),
  );
  return { name: name || "New hire", notes, assignments };
}
