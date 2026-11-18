import { describe, expect, it } from 'vitest';
import fileIcons from '@/components/organisms/ImagePreviewer/fileIcons';

const iconFor = (ext) => fileIcons.find((entry) => entry.ext.includes(ext));
const iconForType = (type) => fileIcons.find((entry) => (entry.type || []).includes(type));

describe('the file icon table', () => {
    it('gives every entry an icon address and at least a type or an extension', () => {
        fileIcons.forEach((entry) => {
            expect(typeof entry.url).toBe('string');
            expect(entry.url.length).toBeGreaterThan(0);
            expect((entry.type || []).length + (entry.ext || []).length).toBeGreaterThan(0);
        });
    });

    it('keeps extensions and types in lower case', () => {
        fileIcons.forEach((entry) => {
            [...(entry.ext || []), ...(entry.type || [])].forEach((value) => expect(value).toBe(value.toLowerCase()));
        });
    });

    it('lists each extension only once, so the first match is the only match', () => {
        const seen = fileIcons.flatMap((entry) => entry.ext || []);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('lists each type only once', () => {
        const seen = fileIcons.flatMap((entry) => entry.type || []);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('shows the same icon for the spreadsheet type and its two extensions', () => {
        expect(iconForType('excel')).toBe(iconForType('sheet'));
        expect(iconFor('xls')).toBe(iconFor('xlsx'));
        expect(iconForType('excel')).toBe(iconFor('xls'));
    });

    it('shows one icon for both presentation extensions and for the two document ones', () => {
        expect(iconFor('ppt')).toBe(iconFor('pptx'));
        expect(iconFor('doc')).toBe(iconFor('docs'));
    });

    it('covers the files people attach most', () => {
        ['pdf', 'zip', 'csv', 'json', 'txt', 'mp4', 'psd', 'sql'].forEach((ext) => expect(iconFor(ext)).toBeDefined());
        ['image', 'video', 'audio', 'pdf'].forEach((type) => expect(iconForType(type)).toBeDefined());
    });

    it('does not know an extension it has no icon for', () => {
        expect(iconFor('exe')).toBeUndefined();
        expect(iconFor('PDF')).toBeUndefined();
    });

    it('gives different extensions different icons', () => {
        expect(iconFor('pdf').url).not.toBe(iconFor('zip').url);
        expect(iconFor('csv').url).not.toBe(iconFor('json').url);
    });
});
