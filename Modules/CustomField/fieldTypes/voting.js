const { wholeNumberOf } = require('./shared');

const NOT_A_VALUE = 'A vote is cast on the field by the person voting; it is not written as a value.';

const votersShown = (definition) => !definition || definition.fieldVotersShown !== false;

function settings(definition) {
    const given = definition.fieldVotersShown;
    if (given !== undefined && typeof given !== 'boolean') return { error: 'fieldVotersShown must be true or false.' };
    return { settings: { fieldVotersShown: given !== false } };
}

const parse = () => ({ error: NOT_A_VALUE });

/* A task carries the number of votes, kept by the server; no votes is no value. */
const countOf = (value) => {
    const count = wholeNumberOf(value);
    return count !== null && count > 0 ? count : 0;
};

const text = (value) => (countOf(value) ? String(countOf(value)) : '');

const sortValue = (value) => countOf(value) || null;

/* What a viewer is given beside the count: whether they voted, and the voters when the field shows them. */
const tallyOf = (given) => {
    const tally = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
    return { voted: tally.voted === true, voters: Array.isArray(tally.voters) ? tally.voters.filter((id) => typeof id === 'string') : [] };
};

module.exports = { type: 'voting', empty: '', sideStored: true, castOnly: true, votersShown, countOf, tallyOf, settings, parse, text, sortValue };
