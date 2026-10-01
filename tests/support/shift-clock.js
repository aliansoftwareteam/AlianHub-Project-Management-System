const MS_PER_DAY = 86400000;

function parseDays(value) {
    if (value === undefined || value === '') return 0;
    const days = Number(value);
    if (!Number.isFinite(days)) throw new Error(`CLOCK_SHIFT_DAYS must be a number of days, got "${value}"`);
    return days;
}

const SHIFTED = Symbol.for('alianhub.clockShifted');

function shiftClock(target, days) {
    const RealDate = target.Date;
    const offsetMs = days * MS_PER_DAY;
    if (!offsetMs || RealDate[SHIFTED]) return RealDate;

    const realNow = RealDate.now.bind(RealDate);
    const shiftedNow = () => realNow() + offsetMs;
    // jest.spyOn(Date, 'now') must keep working, so `now` is patched in place rather than trapped.
    RealDate.now = shiftedNow;
    RealDate[SHIFTED] = true;
    target.Date = new Proxy(RealDate, {
        construct(Real, args, newTarget) {
            return Reflect.construct(Real, args.length === 0 ? [shiftedNow()] : args, newTarget);
        },
        apply() {
            return new RealDate(shiftedNow()).toString();
        }
    });
    return target.Date;
}

if (typeof process !== 'undefined' && process.env.CLOCK_SHIFT_DAYS !== undefined) {
    shiftClock(globalThis, parseDays(process.env.CLOCK_SHIFT_DAYS));
}

module.exports = { shiftClock, parseDays };
