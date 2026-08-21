/**
 * The achievement catalogue.
 *
 * Shared by client and server, so it must stay free of imports.
 *
 * A deliberate rule runs through these: none of them reward volume. The room
 * pays real money per task, so "complete 100 tasks" would be a badge that
 * spends the budget to earn itself. Every entry keys on variety, timing or
 * craft instead — breadth, thrift, proximity, working odd hours.
 */

export type AchievementSubject = "agent" | "human";

export interface Achievement {
  code: string;
  subject: AchievementSubject;
  title: string;
  /** Shown once earned; written as a description of what they did. */
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  // ── Agents (earned by the seat, so a character accrues a history) ──
  {
    code: "first-words",
    subject: "agent",
    title: "First Words",
    description: "Finished their first task",
    icon: "🗣",
  },
  {
    code: "sub-contractor",
    subject: "agent",
    title: "Sub-contractor",
    description: "Did work handed down by another agent, not a human",
    icon: "🔗",
  },
  {
    code: "night-shift",
    subject: "agent",
    title: "Night Shift",
    description: "Finished a task with nobody in the office",
    icon: "🌙",
  },
  {
    code: "marathon",
    subject: "agent",
    title: "Marathon",
    description: "Worked more than two minutes straight without stalling",
    icon: "🏃",
  },
  {
    code: "frugal",
    subject: "agent",
    title: "Frugal",
    description: "Finished a task for less than a penny",
    icon: "🪙",
  },

  // ── Humans (earned by display name, which is the only identity a room has) ──
  {
    code: "walked-in",
    subject: "human",
    title: "Walked In",
    description: "Turned up for the first time",
    icon: "🚪",
  },
  {
    code: "icebreaker",
    subject: "human",
    title: "Icebreaker",
    description: "Said the first thing out loud",
    icon: "💬",
  },
  {
    code: "whisperer",
    subject: "human",
    title: "Whisperer",
    description: "Said something only the people nearby could hear",
    icon: "🤫",
  },
  {
    code: "foreman",
    subject: "human",
    title: "Foreman",
    description: "Gave work to every staffed seat in the room",
    icon: "📋",
  },
  {
    code: "full-house",
    subject: "human",
    title: "Full House",
    description: "Was here when the office filled up",
    icon: "🏠",
  },
];

const BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));

export function achievementFor(code: string): Achievement | undefined {
  return BY_CODE.get(code);
}

export interface EarnedAchievement {
  code: string;
  subjectType: AchievementSubject;
  /** Seat id for agents, display name for humans. */
  subjectId: string;
  subjectName: string;
  earnedAt: string;
}
