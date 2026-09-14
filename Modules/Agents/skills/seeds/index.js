// The skills that ship as documents rather than code. A seed is validated
// through the same validator an admin's save goes through, so a seed that
// drifts outside the vocabulary fails at boot instead of at run time.

const { validateSkill } = require('../validateSkill');
const { compile } = require('../compile');
const briefParse = require('./briefParse');
const digest = require('./digest');
const projectGuide = require('./projectGuide');

const documentOf = (seed) => {
    const checked = validateSkill(seed);
    if (!checked.ok) throw new Error(`the ${seed.key} seed does not validate: ${checked.errors.map((e) => `${e.field} ${e.code}`).join('; ')}`);
    return checked.value;
};

/* Built in and resolvable without a company row, so a workspace created after
 * the seeding migration still has them. `source` stays "code" because that is
 * what the manifest means by it: shipped with the product, not authored here.
 * A company's own copy shadows this one and reads as data. */
const builtInOf = (seed, aliases = []) => ({ ...compile(documentOf(seed)), source: 'code', aliases });

const BUILT_IN = [builtInOf(digest, ['risk.today']), builtInOf(projectGuide)];

module.exports = { documentOf, BUILT_IN, SEEDS: { briefParse, digest, projectGuide } };
