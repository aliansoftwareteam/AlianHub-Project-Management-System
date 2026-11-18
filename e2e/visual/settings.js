const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_DIR = path.join(ROOT, 'e2e', 'visual-baseline');
const LOCAL_BASELINE_DIR = path.join(ROOT, 'e2e', '.state', 'visual', 'baseline-local');
const PROPOSED_DIR = path.join(ROOT, 'e2e', 'visual-proposed');
const ARTIFACT = 'visual-baseline';

/* THRESHOLD is how far one pixel may move (0 to 1, in YIQ) before it counts; MAX_DIFF_PIXEL_RATIO
 * is the share of a screenshot that may count. Measured once, on macOS, between two fresh seeds
 * of one build: 2 of 28 shots differed, by at most 9 pixels and 3/255 a channel, so none counted.
 * Not measured in CI yet: after the first runs there, set both from the noise two runs of one
 * commit show, with a margin of a few times that. */
const THRESHOLD = 0.1;
const MAX_DIFF_PIXEL_RATIO = 0.0001;

// A screenshot made on macOS or Windows never matches one made in the Linux image, so it gets a folder of its own.
const baselineDir = (env = process.env) => (env.VISUAL_LOCAL ? LOCAL_BASELINE_DIR : BASELINE_DIR);

const mayRun = (env = process.env) => Boolean(env.CI || env.VISUAL_LOCAL);

module.exports = { ROOT, BASELINE_DIR, LOCAL_BASELINE_DIR, PROPOSED_DIR, ARTIFACT, THRESHOLD, MAX_DIFF_PIXEL_RATIO, baselineDir, mayRun };
