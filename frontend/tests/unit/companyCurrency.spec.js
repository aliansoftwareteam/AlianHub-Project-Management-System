import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';
import { companyCurrency } from '@/utils/companyCurrency';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (file) => fs.readFileSync(path.resolve(HERE, '../../src', file), 'utf8');

/* On a currency row `isDelete: true` means the company uses it. */
const row = (code, { isDefault = false, inUse = false } = {}) => ({ _id: code, code, isDefault, isDelete: inUse });

describe('the currency a new project starts in', () => {
    test('is the default of the company, which it uses', () => {
        const rows = [row('USD'), row('INR', { isDefault: true, inUse: true }), row('EUR', { inUse: true })];
        expect(companyCurrency(rows).code).toBe('INR');
    });

    test('is the one currency in use when the default was switched off', () => {
        expect(companyCurrency([row('INR', { isDefault: true }), row('EUR', { inUse: true })]).code).toBe('EUR');
    });

    test('stays the default when several others are in use and it is not', () => {
        expect(companyCurrency([row('INR', { isDefault: true }), row('EUR', { inUse: true }), row('USD', { inUse: true })]).code).toBe('INR');
    });

    test('is empty until the list has loaded, so the server picks it', () => {
        expect(companyCurrency([])).toEqual({});
        expect(companyCurrency(undefined)).toEqual({});
    });

    test.each([
        'components/organisms/CreateProject/CreateProjectSidebar.vue',
        'components/templates/CreateProject/TemplateAllDetail.vue',
    ])('%s names no currency of its own', (file) => {
        expect(source(file)).not.toMatch(/code\s*===\s*["']INR["']/);
        expect(source(file)).toContain('companyCurrency(');
    });
});
