const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_DIR = path.join(ROOT, 'e2e', 'visual-baseline');
const LOCAL_BASELINE_DIR = path.join(ROOT, 'e2e', '.state', 'visual', 'baseline-local');
const PROPOSED_DIR = path.join(ROOT, 'e2e', 'visual-proposed');
const ARTIFACT = 'visual-baseline';

/* Not measured yet: no two CI runs of one commit existed when these were written. Set them from
 * the diff the job reports between two such runs, then leave a margin of a few times that. */
const THRESHOLD = 0.2;
const MAX_DIFF_PIXEL_RATIO = 0.0005;

// A screenshot made on macOS or Windows never matches one made in the Linux image, so it gets a folder of its own.
const baselineDir = (env = process.env) => (env.VISUAL_LOCAL ? LOCAL_BASELINE_DIR : BASELINE_DIR);

const mayRun = (env = process.env) => Boolean(env.CI || env.VISUAL_LOCAL);

module.exports = { ROOT, BASELINE_DIR, LOCAL_BASELINE_DIR, PROPOSED_DIR, ARTIFACT, THRESHOLD, MAX_DIFF_PIXEL_RATIO, baselineDir, mayRun };
