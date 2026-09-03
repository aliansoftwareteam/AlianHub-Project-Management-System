// Pure timer-session rules — no I/O. Seconds everywhere unless named otherwise.
// Unit-tested in tests/timer-rules.test.js.

const RUNNING_WINDOW_SEC = 10 * 60;
const OVERNIGHT_HOURS = 12;
const SUGGESTED_TRIM_MINUTES = 180;
const MAX_TRIM_MINUTES = 24 * 60;

/* A desktop-tracker session refreshes `startTimeTracker` on every capture, so a
 * session is live only when that stamp is recent; older stamps are abandoned
 * sessions that were never stopped. Either kind counts as "overnight" once it
 * started before today or has run past the overnight threshold. */
const classifyTimer = ({ startSec, lastSeenSec, nowSec, dayStartSec, runningWindowSec = RUNNING_WINDOW_SEC, overnightHours = OVERNIGHT_HOURS } = {}) => {
    const start = Number(startSec) || 0;
    const now = Number(nowSec) || 0;
    const elapsedSec = Math.max(0, now - start);
    const live = (Number(lastSeenSec) || 0) >= now - runningWindowSec;
    const overnight = start > 0 && (start < (Number(dayStartSec) || 0) || elapsedSec >= overnightHours * 3600);
    return { elapsedSec, live, overnight, suggestedMinutes: SUGGESTED_TRIM_MINUTES };
};

const validateTrimMinutes = (minutes) => {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m <= 0) return { valid: false, reason: 'minutes must be a positive whole number.' };
    if (m > MAX_TRIM_MINUTES) return { valid: false, reason: `minutes must be ${MAX_TRIM_MINUTES} or fewer.` };
    return { valid: true, reason: '', minutes: m };
};

const trimBounds = ({ startSec, minutes }) => ({
    LogEndTime: (Number(startSec) || 0) + minutes * 60,
    LogTimeDuration: minutes,
});

module.exports = { RUNNING_WINDOW_SEC, OVERNIGHT_HOURS, SUGGESTED_TRIM_MINUTES, MAX_TRIM_MINUTES, classifyTimer, validateTrimMinutes, trimBounds };
