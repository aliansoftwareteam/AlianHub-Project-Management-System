// What an instance owner may add to the instruction guard. The shape rules refuse the forms that backtrack
// exponentially (a repeat inside a repeat, a repeated group of alternatives, back-references) and bound the
// rest; the guard still runs every added pattern under a time limit, since polynomial backtracking can hide
// in shapes these rules allow.

const FLAGS = 'i';
const MIN_LENGTH = 3;
const MAX_LENGTH = 200;
const MAX_REPEATS = 4;
const MAX_REPEAT_BOUND = 50;

const REASONS = Object.freeze({
    EMPTY: 'empty',
    TOO_SHORT: 'too_short',
    TOO_LONG: 'too_long',
    INVALID: 'invalid',
    BACKREFERENCE: 'backreference',
    LOOKAROUND: 'lookaround',
    NESTED_REPEAT: 'nested_repeat',
    TOO_MANY_REPEATS: 'too_many_repeats',
    REPEAT_TOO_LARGE: 'repeat_too_large',
    MATCHES_EMPTY: 'matches_empty',
});

const REASON_TEXT = Object.freeze({
    [REASONS.EMPTY]: 'Enter a pattern.',
    [REASONS.TOO_SHORT]: `A pattern needs at least ${MIN_LENGTH} characters.`,
    [REASONS.TOO_LONG]: `A pattern can be at most ${MAX_LENGTH} characters.`,
    [REASONS.INVALID]: 'That is not a valid regular expression.',
    [REASONS.BACKREFERENCE]: 'Back-references such as \\1 are not allowed.',
    [REASONS.LOOKAROUND]: 'Lookahead and lookbehind are not allowed.',
    [REASONS.NESTED_REPEAT]: 'A repeated group cannot contain another repeat, an optional part or alternatives: that shape can take minutes to fail on long text.',
    [REASONS.TOO_MANY_REPEATS]: `A pattern can have at most ${MAX_REPEATS} repeats (*, + or {n,m}).`,
    [REASONS.REPEAT_TOO_LARGE]: `A counted repeat can go up to ${MAX_REPEAT_BOUND}.`,
    [REASONS.MATCHES_EMPTY]: 'That pattern matches empty text, so it would flag everything.',
});

const QUANTIFIER = /^\{(\d+)(?:(,)(\d*))?\}/;

const quantifierAt = (source, i) => {
    const c = source[i];
    if (c === '*') return { length: 1, min: 0, max: Infinity };
    if (c === '+') return { length: 1, min: 1, max: Infinity };
    if (c === '?') return { length: 1, min: 0, max: 1 };
    if (c !== '{') return null;
    const m = QUANTIFIER.exec(source.slice(i));
    if (!m) return null;
    const min = Number(m[1]);
    const max = !m[2] ? min : m[3] === '' ? Infinity : Number(m[3]);
    return { length: m[0].length, min, max };
};

const classEnd = (source, start) => {
    let i = start + 1;
    while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i] === ']') return i + 1;
        else i += 1;
    }
    return i;
};

const groupOpenLength = (source, i) => {
    if (source.startsWith('(?:', i)) return 3;
    if (source.startsWith('(?<', i)) return source.indexOf('>', i) - i + 1;
    return 1;
};

/* The first shape rule the source breaks, or null. The source already compiled, so the walk can trust its syntax. */
function shapeProblem(source) {
    const stack = [{ repeats: false, alternates: false }];
    let repeats = 0;
    let last = null;
    let i = 0;
    while (i < source.length) {
        const top = stack[stack.length - 1];
        const c = source[i];
        if (c === '\\') {
            const next = source[i + 1];
            if (/[1-9]/.test(next) || (next === 'k' && source[i + 2] === '<')) return REASONS.BACKREFERENCE;
            last = { atom: true };
            i += 2;
        } else if (c === '[') {
            last = { atom: true };
            i = classEnd(source, i);
        } else if (c === '(') {
            if (['(?=', '(?!', '(?<=', '(?<!'].some((open) => source.startsWith(open, i))) return REASONS.LOOKAROUND;
            stack.push({ repeats: false, alternates: false });
            last = null;
            i += groupOpenLength(source, i);
        } else if (c === ')') {
            const group = stack.pop();
            const parent = stack[stack.length - 1];
            parent.repeats = parent.repeats || group.repeats;
            parent.alternates = parent.alternates || group.alternates;
            last = { group };
            i += 1;
        } else if (c === '|') {
            top.alternates = true;
            last = null;
            i += 1;
        } else {
            const q = last ? quantifierAt(source, i) : null;
            if (!q) {
                last = { atom: true };
                i += 1;
            } else {
                i += q.length;
                if (source[i] === '?') i += 1;
                top.repeats = true;
                if (q.max > 1) {
                    if (q.min > MAX_REPEAT_BOUND || (q.max !== Infinity && q.max > MAX_REPEAT_BOUND)) return REASONS.REPEAT_TOO_LARGE;
                    if (last.group && (last.group.repeats || last.group.alternates)) return REASONS.NESTED_REPEAT;
                    repeats += 1;
                    if (repeats > MAX_REPEATS) return REASONS.TOO_MANY_REPEATS;
                }
                last = null;
            }
        }
    }
    return null;
}

const refuse = (reason) => ({ ok: false, reason, message: REASON_TEXT[reason] });

function checkPattern(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return refuse(REASONS.EMPTY);
    const source = raw.trim();
    if (source.length < MIN_LENGTH) return refuse(REASONS.TOO_SHORT);
    if (source.length > MAX_LENGTH) return refuse(REASONS.TOO_LONG);
    let compiled;
    try {
        compiled = new RegExp(source, FLAGS);
    } catch (error) {
        return refuse(REASONS.INVALID);
    }
    const problem = shapeProblem(source);
    if (problem) return refuse(problem);
    if (compiled.test('')) return refuse(REASONS.MATCHES_EMPTY);
    return { ok: true, source };
}

module.exports = { FLAGS, MIN_LENGTH, MAX_LENGTH, MAX_REPEATS, MAX_REPEAT_BOUND, REASONS, REASON_TEXT, checkPattern, shapeProblem };
