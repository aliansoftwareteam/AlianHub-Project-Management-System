import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';
import en from '@/locales/en.js';

const source = fs.readFileSync(path.join(__dirname, '../../src/views/Approvals/Approvals.vue'), 'utf8');
const template = source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'));

describe('Approvals labels come from the locale files', () => {
    test('the agent chip is translated', () => {
        expect(template).not.toMatch(/>\s*AGENT\s*</);
        expect(template).toContain("$t('Time.agent_tag')");
        expect(en.Time.agent_tag).toBe('AGENT');
    });

    test('the filter nav names itself through a key', () => {
        expect(template).not.toMatch(/\saria-label="[^"]*"/);
        expect(template).toContain(":aria-label=\"$t('Time.approval_types')\"");
        expect(en.Time.approval_types).toBe('Approval types');
    });
});
