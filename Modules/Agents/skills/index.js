// Every skill the engine can execute, by slug and alias. qa-review stays code
// for the page facts it measures (ADR 003 §3); the rest are documents compiled
// from ./seeds.

const qaReview = require('./qaReview');
const briefParse = require('./briefParse');
const { BUILT_IN, PR_REVIEW, prReviewSkill, slackSummarySkill, SEEDS } = require('./seeds');

const ALL = [qaReview, briefParse, PR_REVIEW, ...BUILT_IN];
const BY_SLUG = new Map();
ALL.forEach((s) => { BY_SLUG.set(s.slug, s); (s.aliases || []).forEach((a) => BY_SLUG.set(a, s)); });

const current = (skill) => (skill === PR_REVIEW ? prReviewSkill() : skill);

/* The connector skill is resolved apart from ALL, which stays the list of skills every server has. */
const getSkill = (slug) => (String(slug) === SEEDS.slackSummary.key ? slackSummarySkill() : current(BY_SLUG.get(String(slug)) || null));

const all = () => [...ALL.map(current), slackSummarySkill()].filter(Boolean);

module.exports = { ALL, BY_SLUG, getSkill, all };
