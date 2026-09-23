const MAX_PROBLEMS = 20;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describeWrite(w) {
    const parts = [`${plural(w.calls, 'call')} in ${plural(w.databases, 'database')}`];
    if (w.documents !== null) parts.push(plural(w.documents, 'document'));
    if (w.upserts) parts.push(`${w.upserts} upserted`);
    const detail = [];
    if (w.filter && w.filter.length) detail.push(`filter {${w.filter.join(', ')}}`);
    if (w.update) detail.push(w.update);
    return `    ${w.op.padEnd(18)} ${w.collection}  ${parts.join(', ')}${detail.length ? `; ${detail.join('; ')}` : ''}`;
}

function formatDryRun({ results }) {
    const lines = ['Dry run: every write was refused and recorded; nothing is written and nothing is marked applied.'];
    if (!results.length) return [...lines, 'Nothing pending.'].join('\n');
    for (const r of results) {
        lines.push('');
        if (r.status === 'cannot-dry-run') lines.push(`${r.id} [${r.scope}]  cannot dry-run: ${r.reason}`);
        else if (r.status === 'failed') lines.push(`${r.id} [${r.scope}]  failed under the dry run: ${r.error}`);
        else lines.push(`${r.id} [${r.scope}]  would write:`);
        if (r.status === 'cannot-dry-run' && r.writes.length) lines.push('  writes recorded before it stopped being reliable:');
        if (r.status === 'plan' && !r.writes.length) lines.push('    nothing');
        r.writes.forEach((w) => lines.push(describeWrite(w)));
    }
    const count = (status) => results.filter((r) => r.status === status).length;
    lines.push('', `${plural(results.length, 'pending migration')}: ${count('plan')} planned, ${count('cannot-dry-run')} cannot dry-run, ${count('failed')} failed.`);
    return lines.join('\n');
}

const STATUS_TEXT = { pass: 'pass', fail: 'fail', 'no-check': 'no check' };

function formatVerify({ results, notApplied }) {
    const width = Math.max(0, ...results.map((r) => r.id.length));
    const lines = [];
    for (const r of results) {
        lines.push(`${r.id.padEnd(width)}  ${STATUS_TEXT[r.status]}`);
        if (r.error) lines.push(`    error: ${r.error}`);
        r.problems.slice(0, MAX_PROBLEMS).forEach((p) => lines.push(`    - ${p}`));
        if (r.problems.length > MAX_PROBLEMS) lines.push(`    ... and ${r.problems.length - MAX_PROBLEMS} more`);
    }
    if (notApplied.length) lines.push('', `Not applied, so not verified: ${notApplied.join(', ')}`);
    const count = (status) => results.filter((r) => r.status === status).length;
    lines.push('', `${plural(results.length, 'applied migration')}: ${count('pass')} pass, ${count('fail')} fail, ${count('no-check')} no check.`);
    return lines.join('\n');
}

module.exports = { formatDryRun, formatVerify };
