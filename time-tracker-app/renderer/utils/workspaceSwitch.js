// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

const { stashSession, restoreSession } = require('./workspaceSession');

/* A timer never runs in two workspaces, and nothing queued offline is sent to the wrong one: the
 * queue replays against whichever workspace is current, so it has to be empty before that changes.
 * It is drained before the timer is touched, so a refusal leaves a running timer running. */
const switchWorkspace = async ({ target, current, isTracking, confirmStop, stopTimer, drainQueue, storage, activate }) => {
  if (!target) return { switched: false, reason: 'missing' };
  if (target === current) return { switched: false, reason: 'same' };
  if (isTracking && !(await confirmStop())) return { switched: false, reason: 'cancelled' };
  if ((await drainQueue()).remaining > 0) return { switched: false, reason: 'unsynced' };
  if (isTracking) {
    await stopTimer();
    if ((await drainQueue()).remaining > 0) return { switched: false, reason: 'unsynced', stopped: true };
  }
  // With no workspace before this one, the session already in place (an upgraded tracker's) is the target's.
  if (current) {
    stashSession(storage, current);
    restoreSession(storage, target);
  }
  try {
    await activate(target);
  } catch (error) {
    if (current) restoreSession(storage, current);
    throw error;
  }
  return { switched: true, stopped: Boolean(isTracking) };
};

module.exports = { switchWorkspace };
