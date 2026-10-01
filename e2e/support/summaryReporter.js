/* One GitHub annotation that names every failing test and the first lines of its error, because
 * the log of a run is not always reachable and the built-in annotations stop at ten. */
const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const plain = (text) => String(text || '').replace(/\u001b\[[0-9;]*m/g, '');

class SummaryReporter {
    constructor() {
        this.failed = new Map();
        this.counts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
    }

    onTestEnd(test, result) {
        if (result.status === 'passed') return;
        if (result.status === 'skipped') return;
        const lines = plain(result.error && result.error.message).split('\n').filter(Boolean).slice(0, 8).join('\n');
        const tree = result.attachments.find((attachment) => attachment.name === 'page-tree');
        const seen = tree && tree.body ? `\n[page tree]\n${tree.body.toString().slice(0, 3000)}` : '';
        this.failed.set(test.id, `${test.titlePath().slice(2).join(' > ')}\n${lines}${seen}`);
    }

    onEnd() {
        if (!process.env.CI || !this.failed.size) return;
        const body = [...this.failed.values()].join('\n\n');
        console.log(`::error title=${this.failed.size} test(s) failed or flaked::${escapeData(body.slice(0, 60000))}`);
    }
}

module.exports = SummaryReporter;
