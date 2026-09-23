import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';
import en from '@/locales/en.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const runStatuses = () => {
    const source = fs.readFileSync(path.join(ROOT, 'Modules/Agents/runs.js'), 'utf8');
    const block = /const STATUS = Object\.freeze\(\{([^}]*)\}\)/.exec(source)[1];
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe('agent run status chip', () => {
    test('every status a run can have reads as words, not the stored code', () => {
        const statuses = runStatuses();
        expect(statuses).toContain('waiting_approval');
        for (const status of statuses) expect(en.Ai[`run_status_${status}`], status).toBeTruthy();
    });

    test('the recent-runs list shows the label, not run.status', () => {
        const vue = fs.readFileSync(path.join(ROOT, 'frontend/src/views/Ai/AgentSettings.vue'), 'utf8');
        expect(vue).not.toMatch(/\{\{\s*run\.status\s*\}\}/);
        expect(vue).toMatch(/runStatus\(run\)/);
    });
});
