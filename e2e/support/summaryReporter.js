/* One GitHub annotation per failing test, with the first lines of its error and the page it left
 * behind, because the log of a run is not always reachable and an annotation holds about 4 KB. */
const ANNOTATION_LIMIT = 10;
const BODY_LIMIT = 3600;

const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
const plain = (text) => String(text || '').replace(/\u001b\[[0-9;]*m/g, '');

/* The shell navigation and the project picker repeat on every page and push the screen itself out of the limit. */
const screenOf = (tree) => {
    const main = tree.indexOf('- main:');
    return tree.slice(main === -1 ? 0 : main).split('\n').filter((line) => !/^\s*- (treeitem|option) /.test(line)).join('\n');
};

class SummaryReporter {
    constructor() {
        this.failed = new Map();
    }

    onTestEnd(test, result) {
        if (result.status === 'passed' || result.status === 'skipped') return;
        const error = plain(result.error && result.error.message).split('\n').filter(Boolean).slice(0, 7).join('\n');
        const tree = result.attachments.find((attachment) => attachment.name === 'page-tree');
        const screen = tree && tree.body ? screenOf(tree.body.toString()) : '';
        this.failed.set(test.id, { title: test.titlePath().slice(2).join(' > '), error, screen });
    }

    onEnd() {
        if (!process.env.CI || !this.failed.size) return;
        const all = [...this.failed.values()];
        all.slice(0, ANNOTATION_LIMIT).forEach(({ title, error, screen }, index) => {
            const room = index === ANNOTATION_LIMIT - 1 && all.length > ANNOTATION_LIMIT ? 200 : 0;
            const body = `${title}\n${error}\n[screen]\n${screen}`.slice(0, BODY_LIMIT - room);
            const rest = room ? `\n(+${all.length - ANNOTATION_LIMIT} more failing tests)` : '';
            console.log(`::error title=${escapeProperty(`e2e failed or flaked ${index + 1}/${all.length}`)}::${escapeData(body + rest)}`);
        });
    }
}

module.exports = SummaryReporter;
