const fs = require('fs');

function failingTests(report) {
    const failures = [];
    for (const suite of report.testResults || []) {
        const file = suite.name || suite.testFilePath;
        const cases = suite.assertionResults || suite.testResults || [];
        const failed = cases.filter((c) => c.status === 'failed');
        for (const c of failed) failures.push({ file, name: c.fullName || c.title });
        if (!failed.length && suite.status === 'failed') failures.push({ file, name: suite.message ? 'suite failed to run' : 'suite failed' });
    }
    return failures;
}

function summarize(report, { label, days }) {
    const failures = failingTests(report);
    const heading = `### ${label}, clock +${days} days`;
    if (!failures.length) return `${heading}\n\nNo failing tests.\n`;
    const rows = failures.map((f) => `- \`${f.file}\`: ${f.name}`);
    return `${heading}\n\n${failures.length} failing at +${days} days:\n\n${rows.join('\n')}\n`;
}

function annotations(report, days) {
    const byFile = new Map();
    for (const f of failingTests(report)) byFile.set(f.file, [...(byFile.get(f.file) || []), f.name]);
    return [...byFile].map(([file, names]) => `::error title=clock +${days}d::${file.replace(/^.*\/(tests|frontend\/tests)\//, '$1/')} (${names.length}): ${names.slice(0, 3).join(' | ').replace(/[\r\n%]/g, ' ')}\n`).join('');
}

if (require.main === module) {
    const [reportPath, label, days] = process.argv.slice(2);
    const out = process.env.GITHUB_STEP_SUMMARY;
    let text;
    if (fs.existsSync(reportPath)) {
        text = summarize(JSON.parse(fs.readFileSync(reportPath, 'utf8')), { label, days });
    } else {
        text = `### ${label}, clock +${days} days\n\nNo report was written: the run crashed before reporting (out of memory or a setup failure). See the job log.\n`;
    }
    if (out) {
        fs.appendFileSync(out, text + '\n');
        if (fs.existsSync(reportPath)) process.stdout.write(annotations(JSON.parse(fs.readFileSync(reportPath, 'utf8')), days));
    }
    else process.stdout.write(text);
}

module.exports = { failingTests, summarize };
