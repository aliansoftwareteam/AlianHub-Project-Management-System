const { SCOPE } = require('../Agents/actions');

// Every action acts inside this workspace, so none reaches an open world.
const fromRating = (r) => ({
    readOnlyHint: !r.write,
    destructiveHint: r.write && (!r.reversible || r.scope === SCOPE.WORKSPACE),
    idempotentHint: !r.write,
    openWorldHint: false,
});

// An unrated action is treated as the riskiest kind until someone rates it.
const UNRATED = Object.freeze({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });

const annotationsFor = (rating) => (rating ? fromRating(rating) : { ...UNRATED });

const isDestructive = (rating) => annotationsFor(rating).destructiveHint;

module.exports = { annotationsFor, isDestructive };
