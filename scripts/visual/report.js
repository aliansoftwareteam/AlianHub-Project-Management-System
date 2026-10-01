const { parseFileName } = require('../atlas/naming');

const label = (file) => {
    const { screen, theme, size } = parseFileName(file);
    return `${screen}, ${theme}, ${size}`;
};

const listed = (files) => files.map((file) => `  - ${label(file)}`);

function summarise({ proposed, baseline, runId = null, local = false, failed = false }) {
    const known = new Set(baseline);
    const shots = proposed.filter(parseFileName).sort();
    const changed = shots.filter((file) => known.has(file));
    const missing = shots.filter((file) => !known.has(file));
    if (!shots.length) {
        const text = failed
            ? 'Screenshot check: the run failed without proposing a screenshot, so nothing was compared. The log above says why.'
            : 'Screenshot check: every core screen matches the baseline.';
        return { changed, missing, text };
    }

    const lines = ['Screenshot check'];
    if (changed.length) lines.push('', `Changed (${changed.length}):`, ...listed(changed));
    if (missing.length) lines.push('', `Baseline missing, not a failure (${missing.length}):`, ...listed(missing));
    lines.push(
        '',
        `The expected, actual and diff images are in ${local ? 'e2e/visual-report' : 'the visual-report artifact of this run'}.`,
        'If the new look is intended, take it as the baseline and commit the result:',
        '',
        `    ${local ? 'VISUAL_LOCAL=1 npm run visual:accept' : `npm run visual:accept -- ${runId || '<run id>'}`}`,
    );
    return { changed, missing, text: lines.join('\n') };
}

module.exports = { summarise };
