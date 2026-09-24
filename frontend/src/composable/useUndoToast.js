import { reactive } from "vue";

export const UNDO_MS = 6000;

export const undoToast = reactive({ current: null });

let undoFn = null;
let timer = null;
let remaining = 0;
let startedAt = 0;
let held = false;
let seq = 0;

function clearTimer() {
    clearTimeout(timer);
    timer = null;
}

function arm(ms) {
    clearTimer();
    remaining = ms;
    startedAt = Date.now();
    timer = setTimeout(dismissUndoToast, ms);
}

/* One offer at a time: a newer change replaces the older offer, as in the Inbox bar. */
export function showUndoToast({ message, undo, duration = UNDO_MS }) {
    seq += 1;
    undoFn = typeof undo === "function" ? undo : null;
    undoToast.current = { id: seq, message };
    held = false;
    arm(duration);
    return seq;
}

export function dismissUndoToast() {
    clearTimer();
    undoFn = null;
    held = false;
    undoToast.current = null;
}

export async function runUndo() {
    const fn = undoFn;
    dismissUndoToast();
    if (fn) await fn();
}

// Timing that the reader can pause (WCAG 2.2.1): the countdown stops while pointer or focus is on the toast.
export function holdUndoToast() {
    if (!undoToast.current || held) return;
    held = true;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimer();
}

export function releaseUndoToast() {
    if (!undoToast.current || !held) return;
    held = false;
    arm(remaining);
}
