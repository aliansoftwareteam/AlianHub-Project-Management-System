// Every skill the engine can execute, by slug and alias. qa-review and
// pr.summary stay code for the evidence layer the vocabulary cannot express
// (ADR 003 §3); the rest are documents compiled from ./seeds.

const qaReview = require('./qaReview');
const briefParse = require('./briefParse');
const prReview = require('./prReview');
const { BUILT_IN } = require('./seeds');

const ALL = [qaReview, briefParse, prReview, ...BUILT_IN];
const BY_SLUG = new Map();
ALL.forEach((s) => { BY_SLUG.set(s.slug, s); (s.aliases || []).forEach((a) => BY_SLUG.set(a, s)); });

module.exports = { ALL, BY_SLUG, getSkill: (slug) => BY_SLUG.get(String(slug)) || null };
