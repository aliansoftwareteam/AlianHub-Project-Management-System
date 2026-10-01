/* The files index.html loads before the first paint: the entry script, the initial vendor script and
 * their two stylesheets, uncompressed. A production build fails above this (vue.config.js).
 * It is the measured size plus ten percent; docs/PERFORMANCE.md says how to measure and when to raise it. */
module.exports = { FIRST_PAINT_BUDGET_BYTES: 7100000 };
