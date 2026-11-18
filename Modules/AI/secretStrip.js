const { PATTERNS } = require('../Agents/skills/secretScan');

const REMOVED = '[removed]';

const globally = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);

const CREDENTIALS = PATTERNS.map(([, re]) => globally(re));

/* The value after a word that names a secret: "password: x", "my PIN is 1234", "api key = x". */
const NAMED_SECRET = /\b(pass(?:word|wd|code|phrase)|pwd|pin|otp|cvv|cvc|secret|api[ _-]?key|access[ _-]?token|auth[ _-]?token|token|private[ _-]?key|security[ _-]?code)(\s*[:=]\s*|\s+(?:is|was)\s+)(?!\[removed\])["'`]?[^\s"'`,;]{3,}["'`]?/gi;

const LONG_HEX = /\b[a-fA-F0-9]{32,}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

const luhn = (digits) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
        let n = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
    }
    return sum % 10 === 0;
};

const isCard = (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits);
};

/* Only shapes that are credentials by construction or named as one, so an ordinary number in a fact survives. */
const stripSecrets = (value) => {
    let text = String(value == null ? '' : value);
    let removed = 0;
    const replace = (re, test) => {
        text = text.replace(re, (match, ...groups) => {
            if (test && !test(match)) return match;
            removed += 1;
            return typeof groups[0] === 'string' && re === NAMED_SECRET ? `${groups[0]}${groups[1]}${REMOVED}` : REMOVED;
        });
    };
    CREDENTIALS.forEach((re) => replace(re));
    replace(LONG_HEX);
    replace(CARD, isCard);
    replace(SSN);
    replace(NAMED_SECRET);
    return { text, removed };
};

module.exports = { stripSecrets, REMOVED };
