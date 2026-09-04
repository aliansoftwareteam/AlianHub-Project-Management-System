// Every skill the engine can execute, by slug and alias. Adding one means adding a file here.
const qaReview = require('./qaReview');
const briefParse = require('./briefParse');
const prReview = require('./prReview');
const digest = require('./digest');

const ALL = [qaReview, briefParse, prReview, digest];
const BY_SLUG = new Map();
ALL.forEach((s) => { BY_SLUG.set(s.slug, s); (s.aliases || []).forEach((a) => BY_SLUG.set(a, s)); });

module.exports = { ALL, BY_SLUG, getSkill: (slug) => BY_SLUG.get(String(slug)) || null };
