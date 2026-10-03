import { describe, expect, it } from 'vitest';
import { timeArray } from '@/components/atom/TimesheetView/TrackerTimeSheetView/TimeArray';

describe('the timesheet hour rows', () => {
    it('has one row for each hour of the day', () => {
        expect(timeArray).toHaveLength(24);
        expect(timeArray.map((row) => row.value)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    });

    it('starts at midnight and ends in the last hour before it', () => {
        expect(timeArray[0]).toEqual({ from: '12:00 AM', to: '01:00 AM', value: 0 });
        expect(timeArray[23]).toEqual({ from: '11:00 PM', to: '12:00 AM', value: 23 });
    });

    it('lets each row end where the next begins, wrapping at midnight', () => {
        timeArray.forEach((row, index) => {
            expect(row.to).toBe(timeArray[(index + 1) % 24].from);
        });
    });

    it('labels noon as 12 PM and the hour before it as 11 AM', () => {
        expect(timeArray[11]).toMatchObject({ from: '11:00 AM', to: '12:00 PM' });
        expect(timeArray[12]).toMatchObject({ from: '12:00 PM', to: '01:00 PM' });
    });

    it('agrees with the 24-hour value of every label', () => {
        const hourOf = (label) => {
            const [clock, meridiem] = label.split(' ');
            const hour = Number(clock.split(':')[0]) % 12;
            return meridiem === 'PM' ? hour + 12 : hour;
        };
        timeArray.forEach((row) => expect(hourOf(row.from)).toBe(row.value));
    });

    it('has no repeated label', () => {
        expect(new Set(timeArray.map((row) => row.from)).size).toBe(24);
    });
});
