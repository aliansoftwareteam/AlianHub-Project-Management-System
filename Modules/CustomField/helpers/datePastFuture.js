/* The web app reads this file through the @datePastFuture alias, so the API and the date pickers agree on what a stored word means. */

const PAST = 'Past';
const FUTURE = 'Future';

/* The date settings form used to store the words as the person's language showed them, so fields saved before it stored
   Past and Future still carry these. A locale's word stays here when its translation changes. */
const STORED_WORDS = {
    [PAST]: ['过去', 'Passé', 'Vergangenheit', 'Παρελθόν', 'ભૂતકાળ', 'भूतकाल', 'Passato', 'Прошлое', 'Pasado'],
    [FUTURE]: ['未来', 'Futur', 'Zukunft', 'Μέλλον', 'ભાવિ', 'भविष्य', 'Futuro', 'Будущее'],
};

const spelling = (word) => word.trim().toLowerCase();

const MEANINGS = new Map(Object.entries(STORED_WORDS)
    .flatMap(([meaning, words]) => [meaning, ...words].map((word) => [spelling(word), meaning])));

const pastFutureOf = (word) => (typeof word === 'string' && MEANINGS.get(spelling(word))) || null;

const cleanPastFuture = (value) => {
    if (!Array.isArray(value)) return null;
    const meanings = value.map(pastFutureOf);
    return meanings.includes(null) ? null : [PAST, FUTURE].filter((meaning) => meanings.includes(meaning));
};

module.exports = { PAST, FUTURE, pastFutureOf, cleanPastFuture };
