import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import en from '@/locales/en.js';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const openTags = (source, match) => [...source.matchAll(/<DropDown\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => match.test(tag));
const lookup = (key) => key.split('.').reduce((node, part) => node?.[part], en);

const TOOLBAR = 'views/Projects/components/ProjectFiltersToolbar.vue';
const TIMESHEET_ROW = 'components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetTrComponent.vue';

/* A DropDown with a mode opens as a titled sheet on phones; without a title the sheet header is blank. */
describe('mobile sheet titles', () => {
    it('names the group-by sheet with the Group by label', () => {
        const [groupBy] = openTags(read(TOOLBAR), /id="group_by"/);
        expect(groupBy).toMatch(/:title="\$t\('Projects\.group_by'\)"/);
    });

    it('names every tracked/manual split sheet in the project timesheet row', () => {
        const splits = openTags(read(TIMESHEET_ROW), /tracktime_dropdown/);
        expect(splits.length).toBeGreaterThan(0);
        for (const tag of splits) {
            const key = tag.match(/:title="\$t\('([\w.]+)'\)"/)?.[1];
            expect(key, tag).toBeTruthy();
            expect(lookup(key)).toEqual(expect.any(String));
        }
    });
});

/* The split trigger's only content is absolutely positioned, so the trigger box collapsed to
 * 0 px and its focus ring drew nothing; the trigger now owns that position and wraps its content. */
describe('the tracked/manual split trigger in the project timesheet row', () => {
    const style = read(TIMESHEET_ROW).split('<style')[1].replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector) => [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, selectors]) => selectors.split(',').map((s) => s.trim()).includes(selector))
        .map(([, , body]) => body)
        .join('');

    it('is the positioned box and sizes to its content', () => {
        const trigger = rule('.tracktime_dropdown :deep(.dropdown-trigger)');
        expect(trigger).toMatch(/position:\s*absolute/);
        expect(trigger).toMatch(/width:\s*auto/);
    });

    it('lets the images inside it flow instead of escaping the trigger box', () => {
        expect(rule('.tracktime_dropdown .logType__Img--show')).toMatch(/position:\s*static/);
    });
});
