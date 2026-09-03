const T = require('../Modules/LogTime/controllerV2/timerRules');

describe('classifyTimer', () => {
    const now = 1_760_000_000;
    const dayStart = now - 6 * 3600;
    test('a fresh live session is neither stale nor overnight', () => {
        const c = T.classifyTimer({ startSec: now - 1800, lastSeenSec: now - 60, nowSec: now, dayStartSec: dayStart });
        expect(c.live).toBe(true);
        expect(c.overnight).toBe(false);
        expect(c.elapsedSec).toBe(1800);
    });
    test('a session that started yesterday is overnight even if still live', () => {
        const c = T.classifyTimer({ startSec: dayStart - 3600, lastSeenSec: now, nowSec: now, dayStartSec: dayStart });
        expect(c.overnight).toBe(true);
        expect(c.live).toBe(true);
        expect(c.suggestedMinutes).toBe(180);
    });
    test('an abandoned session (stale stamp, ran 13h today) is overnight and not live', () => {
        const c = T.classifyTimer({ startSec: now - 13 * 3600, lastSeenSec: now - 3600, nowSec: now, dayStartSec: now - 14 * 3600 });
        expect(c.overnight).toBe(true);
        expect(c.live).toBe(false);
    });
});

describe('trim', () => {
    test('validates minutes and produces end bounds', () => {
        expect(T.validateTrimMinutes(0).valid).toBe(false);
        expect(T.validateTrimMinutes(90.5).valid).toBe(false);
        expect(T.validateTrimMinutes(T.MAX_TRIM_MINUTES + 1).valid).toBe(false);
        expect(T.validateTrimMinutes('180')).toEqual({ valid: true, reason: '', minutes: 180 });
        expect(T.trimBounds({ startSec: 1000, minutes: 180 })).toEqual({ LogEndTime: 1000 + 180 * 60, LogTimeDuration: 180 });
    });
});
