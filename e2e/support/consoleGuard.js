/* Console errors every spec accepts. An entry hides its message in the whole suite, so it carries
 * the reason the message is not a defect; `url` narrows it to the resource the browser was loading.
 * An uncaught error in the page is never accepted. A spec that provokes an error on purpose names
 * it with `test.use({ expectedConsoleErrors: [...] })` instead of adding it here. */
const ALLOWED = [];

const SNAPSHOT_LIMIT = 20000;
const SNAPSHOT_TIMEOUT_MS = 5000;

const describeError = (entry) => (entry.kind === 'pageerror'
    ? `uncaught error: ${entry.text}`
    : `console.error: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`);

const onList = (entry, allowed) => allowed.some((rule) => rule.text.test(entry.text) && (!rule.url || rule.url.test(entry.url || '')));

function unexpectedErrors(entries, { allowed = ALLOWED, expected = [] } = {}) {
    return entries.filter((entry) => {
        if (entry.kind === 'pageerror') return true;
        return !onList(entry, allowed) && !expected.some((pattern) => pattern.test(describeError(entry)));
    });
}

function watchConsole(context) {
    const entries = [];
    context.on('console', (message) => {
        if (message.type() === 'error') entries.push({ kind: 'console', text: message.text(), url: message.location().url || '' });
    });
    context.on('weberror', (webError) => {
        const error = webError.error();
        entries.push({ kind: 'pageerror', text: (error && error.message) || String(error), url: '' });
    });
    return entries;
}

/* What each open page showed, as its accessibility tree: enough to see from a CI log alone why a
 * locator found nothing. */
async function pageTrees(context) {
    const trees = [];
    for (const page of context.pages()) {
        const tree = await page.locator('body').ariaSnapshot({ timeout: SNAPSHOT_TIMEOUT_MS }).catch((error) => `no tree: ${error.message}`);
        trees.push(`${page.url()}\n${tree}`);
    }
    return trees.join('\n\n').slice(0, SNAPSHOT_LIMIT);
}

module.exports = { ALLOWED, describeError, pageTrees, unexpectedErrors, watchConsole };
