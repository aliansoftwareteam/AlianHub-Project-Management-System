import { describe, expect, it } from 'vitest';
import { readSheet } from '@/components/organisms/WorkspaceImport/readSheet';

const BYTE_ORDER_MARK = String.fromCharCode(0xFEFF);
const CSV = 'Task Name,Task Content,Due Date\n"Größe prüfen – 日本語 ✓","Preise in € und £",1764547200000\n';

// The encoder's buffer belongs to another realm here; copying it gives the kind of buffer a browser's File answers.
const fileOf = (text) => ({ arrayBuffer: async () => Uint8Array.from(new TextEncoder().encode(text)).buffer });

describe('reading an export file in the import dialog', () => {
    it('reads a UTF-8 CSV that has no byte order mark as the text it holds', async () => {
        const [row] = await readSheet(fileOf(CSV));
        expect(row['Task Name']).toBe('Größe prüfen – 日本語 ✓');
        expect(row['Task Content']).toBe('Preise in € und £');
    });

    it('reads the same file with a byte order mark the same way', async () => {
        const [row] = await readSheet(fileOf(`${BYTE_ORDER_MARK}${CSV}`));
        expect(row['Task Name']).toBe('Größe prüfen – 日本語 ✓');
    });

    it('still reads a CSV saved in Latin-1, as a spreadsheet program on Windows saves it', async () => {
        const latin1 = Uint8Array.from('Task Name\nGröße prüfen\n', (letter) => letter.charCodeAt(0));
        const [row] = await readSheet({ arrayBuffer: async () => latin1.buffer });
        expect(row['Task Name']).toBe('Größe prüfen');
    });

    it('keeps every cell as text, so a date in milliseconds stays whole', async () => {
        const [row] = await readSheet(fileOf(CSV));
        expect(row['Due Date']).toBe('1764547200000');
    });
});
