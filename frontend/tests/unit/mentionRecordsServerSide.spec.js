import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Comments/Comments.vue'), 'utf8');

describe('mention records are written by the server', () => {
    it('the comment box stores no mention record of its own', () => {
        expect(source).not.toMatch(/APP_NOTIFICATION/);
        expect(source).not.toMatch(/app-notification\/comment/);
        expect(source).not.toMatch(/mentionsRefObj/);
    });
});
