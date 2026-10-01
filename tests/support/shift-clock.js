const MS_PER_DAY = 86400000;

function parseDays(value) {
    if (value === undefined || value === '') return 0;
    const days = Number(value);
    if (!Number.isFinite(days)) throw new Error(`CLOCK_SHIFT_DAYS must be a number of days, got "${value}"`);
    return days;
}

function shiftClock(target, days) {
    const RealDate = target.Date;
    const offsetMs = days * MS_PER_DAY;
    if (!offsetMs || RealDate.isClockShifted) return RealDate;

    const shiftedNow = () => RealDate.now() + offsetMs;
    const ShiftedDate = new Proxy(RealDate, {
        construct(Real, args, newTarget) {
            if (args.length === 0) return Reflect.construct(Real, [shiftedNow()], newTarget);
            return Reflect.construct(Real, args, newTarget);
        },
        apply() {
            return new RealDate(shiftedNow()).toString();
        },
        get(Real, prop, receiver) {
            if (prop === 'now') return shiftedNow;
            if (prop === 'isClockShifted') return true;
            return Reflect.get(Real, prop, receiver);
        }
    });
    target.Date = ShiftedDate;
    return ShiftedDate;
}

if (typeof process !== 'undefined' && process.env.CLOCK_SHIFT_DAYS !== undefined) {
    shiftClock(globalThis, parseDays(process.env.CLOCK_SHIFT_DAYS));
}

module.exports = { shiftClock, parseDays };
