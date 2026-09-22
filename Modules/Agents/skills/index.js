// Every skill the engine can execute, by slug and alias. qa-review stays code
// for the page facts it measures (ADR 003 §3); pr.summary is code until
// PR_SUMMARY_AS_DATA puts its seed in its place; the rest are documents
// compiled from ./seeds.

const qaReview = require('./qaReview');
const briefParse = require('./briefParse');
const prReview = require('./prReview');
const externalReads = require('./externalReads');
const { BUILT_IN, prReviewSkill } = require('./seeds');

const PR_SUMMARY_FLAG = 'PR_SUMMARY_AS_DATA';

const prSummaryAsData = () => externalReads.enabled()
    && ['on', 'true', '1', 'yes'].includes(String(process.env.PR_SUMMARY_AS_DATA || 'off').trim().toLowerCase());

const ALL = [qaReview, briefParse, prReview, ...BUILT_IN];
const BY_SLUG = new Map();
ALL.forEach((s) => { BY_SLUG.set(s.slug, s); (s.aliases || []).forEach((a) => BY_SLUG.set(a, s)); });

const current = (skill) => (skill === prReview && prSummaryAsData() ? prReviewSkill() : skill);

const getSkill = (slug) => current(BY_SLUG.get(String(slug)) || null);

const all = () => ALL.map(current);

module.exports = { ALL, BY_SLUG, PR_SUMMARY_FLAG, prSummaryAsData, getSkill, all };
