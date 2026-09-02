<div align="center">

# WaterCooler

### A playable world where AI agents live, work, and collaborate

Your agents deserve more than a terminal. Give them an office, a town, and eventually, a world.

[![npm version](https://img.shields.io/npm/v/@geezerrrr/watercooler?color=cb0303&label=npm)](https://www.npmjs.com/package/@geezerrrr/watercooler)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Phaser](https://img.shields.io/badge/Phaser-3-8B44AC)](https://phaser.io/)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/9nTtN3ShP8)

</div>

---

## Demo

[Watch the demo video](https://github.com/user-attachments/assets/03801c8c-44a5-4b14-96cf-db9e941acf86)

## What is this?

WaterCooler is a pixel RPG built on top of [OpenClaw](https://github.com/openclaw/openclaw). You walk around an office as the boss, assign tasks face-to-face, and watch your AI agents work in real time. Not in a log, but in the room.

Today it's a local office. The goal is a shared online world: agents from different users collaborating across the network, a skill marketplace, a task delegation economy, and spatial UX for everything OpenClaw can do.

## Quick Start

Run instantly with npx, no clone, no install:

```bash
npx @geezerrrr/watercooler
```

Open [http://localhost:3000](http://localhost:3000). You'll need an [OpenClaw](https://github.com/openclaw/openclaw) gateway running for live agent execution.

Custom port or gateway:

```bash
npx @geezerrrr/watercooler --port 3000 --gateway ws://127.0.0.1:18789/
```

## Development Setup

```bash
git clone git@github.com:geezerrrr/watercooler.git
cd watercooler
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Agent providers

Agents can be executed several ways, selected with the `AGENT_PROVIDER` env var:

| Provider              | Value        | What runs the agent                                |
| --------------------- | ------------ | -------------------------------------------------- |
| Claude Code (default) | `claude`     | Local `claude` CLI, using your Claude subscription |
| Claude (API key)      | `claude-api` | The same CLI against an Anthropic API key          |
| Auggie                | `auggie`     | Local `auggie` CLI                                 |
| Mettara AI            | `mettara`    | Mettara Connect's hosted AI, called over its SDK   |
| OpenClaw              | `openclaw`   | An OpenClaw gateway over WebSocket                 |

Every provider but OpenClaw needs no gateway, URL or token: the server emulates
the gateway protocol in-process, so the app connects to itself on startup. The
CLI providers spawn a binary per run; Mettara is a hosted service and answers in
process. OpenClaw still works exactly as before.

```bash
pnpm dev                          # Claude Code
AGENT_PROVIDER=mettara pnpm dev   # Mettara AI
AGENT_PROVIDER=openclaw pnpm dev  # OpenClaw gateway
```

### Claude Code provider

Each seat runs in its own sandbox directory under `.agent-workspaces/<seat>/`
(gitignored), created on demand, with `--permission-mode acceptEdits` — so
agents can read, write and edit inside their own space and nothing outside it.
Seat personality is passed via `--append-system-prompt`, and each seat's CLI
session id is remembered so follow-up messages resume the same conversation.

Optional env vars:

| Variable                 | Default            | Purpose                                              |
| ------------------------ | ------------------ | ---------------------------------------------------- |
| `CLAUDE_BIN`             | resolved from PATH | Path to the `claude` executable                      |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits`      | Permission mode for spawned agents                   |
| `CLAUDE_ALLOWED_TOOLS`   | —                  | Extra tools to allow, comma-separated (e.g. `Bash`)  |
| `AGENT_TOWN_MODEL`       | CLI default        | Model for spawned agents (`opus`, `sonnet`, `haiku`) |

Note that `--print` runs are non-interactive: a tool that is neither
auto-approved by the permission mode nor named in `CLAUDE_ALLOWED_TOOLS` is
denied rather than prompted for. Worker dispatch is exempt — the MCP dispatch
tool is allowed automatically whenever more than one seat is staffed.

## Key features

- **In-world task assignment:** Approach any worker and assign tasks through an RPG-style interaction menu. No forms, no dropdowns. You walk up and talk.
- **Visible execution:** Tasks move through `queued > returning > sending > running > done/failed`. Worker bubbles show what's happening at each step. Tool calls are collapsible in the chat panel.
- **Worker autonomy:** Idle workers roam the office: whiteboards, printers, sofas, bookshelves. They return to their seat before starting real work. Busy workers queue additional tasks.
- **Session management:** Multiple sessions with quick switching, token/context metering, and a seat manager for configuring worker names, roles, and sprites.
- **Multi-agent team management:** Each seat can be a **Worker** or an **Agent**. Workers are tool slots — they execute tasks dispatched by the main agent. Agents are independent OpenClaw agents with their own workspace, model, and memory. Add agents via `openclaw agents add <id>`, bind them to a seat, and they'll route through their own session automatically.

## How it works

```
You approach a worker -> Press E -> Assign a task
  -> Worker walks back to desk (if away)
  -> Task is sent to the OpenClaw gateway
  -> Streaming updates flow back as chat, tool calls, bubbles
  -> Worker completes and picks up the next queued task
```

## Tech stack

| Layer         | Choice                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| App           | Next.js 16, React 19, TypeScript                                          |
| Game          | Phaser 3, Tiled maps, pixel sprite sheets                                 |
| Agent runtime | [OpenClaw](https://github.com/openclaw/openclaw) via standalone connector |
| State         | React context + reducer + typed event bus                                 |

## Architecture

Currently the game connects directly to an OpenClaw gateway via WebSocket proxy. The target architecture introduces a backend and standalone connector so that the game UI never talks to OpenClaw directly:

```mermaid
flowchart LR
    UI[Game UI]
    Backend[WaterCooler Backend]
    Connector[Connector]
    GW[OpenClaw Gateway]

    UI -->|WSS| Backend
    Connector -->|outbound WSS| Backend
    Connector -->|local WS| GW
```

- **Game UI:** Phaser office + React HUD. Talks only to the backend.
- **Backend:** Runs locally for dev, cloud for prod. Same code, same protocol.
- **Connector:** Standalone process on the user's machine. Bridges private OpenClaw to the backend. OpenClaw credentials never leave the local machine.

## Roadmap

- **Backend + Connector:** Decouple the game UI from OpenClaw; standalone connector bridges private gateways to a shared backend
- **Cloud deployment:** Log into `cloud.agent.town` and operate your own OpenClaw through the cloud world UI
- **Shared world:** Multi-user presence, social interactions, cooperative rooms with opt-in projections
- **Library scene:** Long-term memory as a walkable space (shelves, archives, research stations)
- **Workshop scene:** Skill and tool management as physical stations in the world
- **Town map + marketplace:** Expand beyond the office; acquire third-party skills, delegate tasks to external agents

## Assets

The office scene uses pixel tilesets and sprite sheets authored in Tiled. If running outside the original setup, provide your own compatible assets under `public/`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). We're especially looking for people interested in gameplay design, scene/level design, and game-native UX for AI workflows.

## License

[MIT](./LICENSE)

### Mettara AI provider

`AGENT_PROVIDER=mettara` runs agents on Mettara Connect instead of a local CLI.
There is no binary to install and no sandbox directory — a turn is an API call.

It needs two credentials on the server and the Mettara SDK, which is
distributed as a tarball rather than from the public npm registry:

The SDK is not on npm: put Mettara's Node library in `vendor/mettara-lib/` as
`mettara-lib.cjs` (the `.cjs` name matters; see the README there) and run
`pnpm install` once. The image copies that folder, so a deploy carries it.

```bash
cat >> .env.local <<'ENV'          # gitignored; never commit these
METTARA_API_SECRET=...
METTARA_PLATFORM_ID=...
ENV
AGENT_PROVIDER=mettara pnpm dev
```

Each seat is provisioned as its own Mettara user, so workers hold separate
threads of conversation. The first turn opens a conversation and carries the
seat's personality and the company briefing with it; later turns resume that
conversation by id, exactly as the Claude providers resume a CLI session. The
HUD's model field selects which assistant a seat talks to by Mettara technical
name (`METTARA_AI_NAME` sets the default).

Missing credentials, or a missing SDK, are refused with a plain sentence in the
worker's bubble rather than an opaque failure.

Optional settings: `METTARA_BASE_URL` (staging or self-hosted),
`METTARA_GROUP_ID` and `METTARA_GROUP_NAME` (the namespace the room's people are
provisioned under).

#### Letting a Mettara AI act in the office

When the credentials are present the server also mounts a signed inbound
endpoint at `/api/mettara/tools`, so a Mettara AI can reach back into the room:

| Tool            | Arguments                 | What it does             |
| --------------- | ------------------------- | ------------------------ |
| `list_workers`  | `room?`                   | Returns the seat roster  |
| `dispatch_task` | `seatId`, `task`, `room?` | Hands a task to a worker |

Every request is verified before a handler sees it — body digest, ±5 minute
clock skew, nonce replay, then the HMAC-SHA256 signature over
`METHOD\npath\ntimestamp\nnonce\nbase64(SHA256(body))`. A forged request never
consumes a nonce, so it cannot lock out the genuine one behind it. The endpoint
is not mounted at all when there is no secret to verify against.

### The arcade cabinet

Beside the pinball machine in the Sandbox ERP lobby stands an arcade cabinet
with four games. Oak Island is the showpiece: a top-down adventure across the
island of the legend, screen by screen, with a shovel. Dig the coconut fibre
out of Smith's Cove to survive the flood tunnels, take the lead cross from
under Nolan's Cross, find the lantern in Samuel Ball's ruins, read the
90-foot stone by its light, and open the Chappell Vault at 150 feet — while
crabs, swamp wisps, pirate skeletons and the ghosts of the shaft try to make
you the seventh to die. Then Flappy, Snake, Breakout and Solitaire. Walk up,
press E, pick one.

The cabinet has its own music, "Mighty Coin Drop", from the moment it opens;
Oak Island swaps in "Tide Under Oak" while it plays, and the pinball machine
has "Silver Ball Surge". The room's music steps aside meanwhile. A button on
each machine mutes the songs, one switch for all of them, remembered in the
browser; every game's sound effects are synthesised and play regardless.
Each keeps its own high score table for the room, and a score goes in the
room's activity like a pinball one. Keys, a pad or a touch screen all work;
Escape (or B) backs out of a game to the menu, and out of the menu to the
room.

### The island across the water

The bottom of the world map is the sea. The centre avenue carries on past
the south road as a dock, and the ferry waits at its end; walk to the end of
the dock to board it. It sails to an island, with water all round, a dock
under a board that says "Welcome to Ireland", sheep on the grass, and one
whitewashed house: Apeiron Media, laid out inside like Castle Atlantic,
ping pong table and all. Walk back onto the end of the dock to sail home.

### Playing with a controller

Plug in an Xbox controller (a PlayStation or Switch pad works the same; the
prompts use the Xbox names) and the bottom bar shows it. The stick or d-pad
walks, A talks to whoever you are standing by, the bumpers turn through the
HUD's panels, View closes the open one, and B backs out of anything, the way
Escape does. Any dialog — the welcome, the lift, the task terminal, the
character studio — can be walked with the d-pad and pressed with A. Hold the
left trigger to talk on voice chat: the microphone is live while the trigger
is down and off the moment it is let go.

The game machines all use the same buttons, printed on each one:

| Button | Does                                                                        |
| ------ | --------------------------------------------------------------------------- |
| A      | act: play, flap, fire the plunger, choose                                   |
| B      | back: out of a game to the menu, out of the menu                            |
| X      | full screen (the window fills; a pad press cannot ask the browser for more) |
| Y      | music on or off                                                             |
| View   | close the machine from anywhere                                             |
| Menu   | play again, or a new deal                                                   |
| LT     | hold to talk, or the button you pick in the Controller check                |

Pinball flips with the bumpers or the d-pad; ping pong moves the bat with
the stick or the d-pad.

The controller pill in the bottom bar reads "no pad" until the browser
reports one, and opens the Controller check: what the browser sees, the
last button pressed by name, and a way to choose a different talk button,
since some pads report a bumper at the trigger's index. Browsers hide a
controller until the page has been clicked and a button pressed.

### Files with a task

The paperclip beside the chat box attaches files to the next task, up to
eight at a time and 25 MB each. They are uploaded as they are chosen and
kept under `UPLOADS_DIR` (beside the room database by default, on the volume
in the image). A Claude agent finds them copied into its workspace under
`attachments/`, with a note at the end of the task saying so; Mettara gets
them uploaded to the group and handed over with the message.

### Voice chat by proximity

The microphone button in the bottom bar switches on voice chat. Audio goes
browser to browser over WebRTC; the room socket carries only the handshake,
and the server never hears anything. Everyone in the room with a microphone
on is connected to everyone else who has one, and each voice is turned down
by distance: full within three tiles, silent past nine, a straight fade
between. A small speaker mark appears above someone while their voice is
coming through. Voice works in rooms, where presence is; the world map and a
campus have no room and no voice.

Routing uses a public STUN server. Browsers behind strict NATs may need a
TURN relay: set `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME` and
`NEXT_PUBLIC_TURN_CREDENTIAL` and it is offered alongside.

### Switching the agents between Claude and Mettara

The server boots on `AGENT_PROVIDER` — the Claude CLI unless told otherwise —
and that stays the default. The HUD's connection panel offers a switch between
that Claude implementation and Mettara: disconnect, pick the other, and it
connects to it. The choice is kept in the room database, so a restart comes
back on it. Mettara is refused, with the reason in the panel, until its keys
are set and its SDK is installed. Conversations do not carry across: a seat
starts a fresh thread on the AI it switched to.

### Signing in with Google or Microsoft

By default a person is a browser profile: a name, a home building and a
character kept in localStorage, with the room link as the only credential.
Set up sign-in and people are accounts instead, known by email, and their
profile and counts follow them to any device.

Sign-in is Auth.js. Create an OAuth app in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials) and
one in [Microsoft Entra](https://entra.microsoft.com/) (App registrations),
with this redirect URI for each, adjusted to your host and port:

```
http://localhost:3001/api/auth/callback/google
http://localhost:3001/api/auth/callback/microsoft-entra-id
```

Then put the keys in `.env.local` (gitignored; never commit them):

| Variable                         | Purpose                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `AUTH_SECRET`                    | Signs the session cookie; `npx auth secret` writes one for you                       |
| `AUTH_GOOGLE_ID`                 | Google OAuth client id                                                               |
| `AUTH_GOOGLE_SECRET`             | Google OAuth client secret                                                           |
| `AUTH_MICROSOFT_ENTRA_ID_ID`     | Entra application (client) id                                                        |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra client secret                                                                  |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Optional: `https://login.microsoftonline.com/<tenant>/v2.0` to allow one tenant only |

A provider is offered on the welcome screen when both of its keys are
present; with none present, sign-in is off and profiles stay in the browser.
Accounts live in the `accounts` table of the room database: the provider's
display name and picture, the profile chosen here, a visit count, and a
`stats` map any feature can count into with `bumpAccountStat`. A signed-in
person's desk and presence go under an id derived from their email, so they
keep the same desk from every device.

### Running agents with an API key (cloud mode)

`AGENT_PROVIDER=claude-api` runs the same CLI against an Anthropic API key
instead of a signed-in account. This is what the cloud deployment uses, where
there is no logged-in user and a subscription cannot be shared.

```bash
echo 'ANTHROPIC_API_KEY=sk-...' >> .env.local   # gitignored; never commit it
AGENT_PROVIDER=claude-api pnpm dev
```

The key is read from the server's environment and never appears on a command
line, where it would be visible in process listings. If it is missing or
malformed the run is refused with a plain sentence in the worker's bubble
rather than a failed CLI exit.

Runs in this mode use the CLI's `--bare` flag, which makes the API key the only
credential: OAuth and the keychain are never read. Without it the CLI falls back
to whatever account is signed in on the host, so an expired or mistyped key
would still appear to work while quietly billing someone's subscription.

A rejected key makes the CLI retry silently rather than exit, so every run is
also bounded by `AGENT_RUN_TIMEOUT_MS` (default 180s). Past that the agent is
stopped, the seat reports it plainly, and the concurrency slot is released.

Three limits apply to every run, whether assigned directly or delegated:

| Limit                  | Default | Env var                |
| ---------------------- | ------- | ---------------------- |
| Agents running at once | 4       | `AGENT_MAX_CONCURRENT` |
| Spend per room         | $50     | `ROOM_SPEND_LIMIT_USD` |
| Humans per room        | 4       | —                      |

Spend is measured server-side from what each run reports, accumulated in the
room's record, and shown in the HUD next to the occupancy pill. When a room
reaches its ceiling, dispatch stops until the limit is raised — a hard stop,
not a warning, because with a host-side key the bill belongs to whoever runs
the server.

Each seat gets a sandbox at `.agent-workspaces/<room>/<seat>/`, so rooms cannot
read each other's work.
