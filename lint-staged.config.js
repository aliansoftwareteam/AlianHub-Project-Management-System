/**
 * lint-staged config for the BACKEND (repo root).
 *
 * Frontend files are covered by the `lint-staged` block in
 * frontend/package.json — lint-staged applies the config closest to each
 * staged file, so anything under frontend/ uses that one instead.
 *
 * The backend has no ESLint setup, so we guard against the two failure
 * modes that actually bite here: syntax errors in .js (e.g. a bad merge
 * resolution) and unparseable JSON data files in utils/.
 */
module.exports = {
    '*.js': (files) => files.map((f) => `node --check "${f}"`),
    '*.json': 'node scripts/validate-json.js',
};
