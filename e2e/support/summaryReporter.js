/* One GitHub annotation per failing test, with the first lines of its error and the page it left
 * behind, because the log of a run is not always reachable and an annotation holds about 4 KB. */
const ANNOTATION_LIMIT = 10;
const BODY_LIMIT = 3600;

const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
const ESCAPE = String.fromCharCode(27);
const plain = (text) => String(text || '').replace(new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g'), '');

/* A dialog is what a test was working in, so it comes first; the shell navigation and the project
 * picker repeat on every page and would push it out of the limit. */
const screenOf = (tree) => {
    const lines = tree.split('\n').filter((line) => !/^\s*- (treeitem|option) /.test(line));
    const dialog = lines.findIndex((line) => /^\s*- dialog/.test(line));
    const main = lines.findIndex((line) => line.startsWith('- main:'));
    const head = dialog === -1 ? [] : lines.slice(dialog);
    return [...head, ...lines.slice(main === -1 ? 0 : main, dialog === -1 ? undefined : dialog)].join('\n');
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
