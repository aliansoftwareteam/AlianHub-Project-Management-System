import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Comments/Comments.vue'), 'utf8');

describe('comment notifications are composed by the server', () => {
    it('the comment box posts no notification of its own', () => {
        expect(source).not.toMatch(/HANDLE_NOTIFICATION/);
    });

    it('the comment box leaves the "everyone" recipients to the server', () => {
        expect(source).not.toMatch(/mentionIds\s*=\s*users\.value/);
    });
});
