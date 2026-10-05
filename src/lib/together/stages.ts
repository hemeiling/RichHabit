/**
 * The shape of a space's work, shared by the server and the screens (this file
 * imports nothing, so the browser bundle can use it).
 *
 * A task is in the Backlog — captured, not promised — or on the board, in one
 * of four fixed stages. There are no custom stages.
 */
export const STAGES = ["backlog", "todo", "doing", "waiting", "done"] as const;
export type Stage = (typeof STAGES)[number];

/** The board's four stages, in order. */
export const BOARD_STAGES = ["todo", "doing", "waiting", "done"] as const satisfies readonly Stage[];
export type BoardStage = (typeof BOARD_STAGES)[number];

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

/** The effort choices offered. The database holds 1–99, so these can change without a migration. */
export const EFFORT_CHOICES = [1, 2, 3, 5, 8] as const;
