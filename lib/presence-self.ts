/**
 * This browser's own player id.
 *
 * The room socket hands it over once, in the welcome frame. Anything that
 * needs to address another player — a ping pong challenge, say — needs to
 * know which of the people in the room is itself, and may well mount long
 * after that frame arrived, so it is kept here rather than announced.
 */

let selfId: string | null = null;

export function rememberSelfId(id: string): void {
  selfId = id;
}

export function getSelfId(): string | null {
  return selfId;
}
