const { neutraliseFormula } = require('../utils/csvSafe');
const reportExport = require('../Modules/Export/helpers/exportRules');
const taskExport = require('../Modules/ExportJobs/helpers/exportRules');

describe('neutraliseFormula', () => {
    it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x","y")'])('prefixes %j with an apostrophe', (value) => {
        expect(neutraliseFormula(value)).toBe(`'${value}`);
    });

    it.each(['plain', '', 'a=b', "'=already"])('leaves %j alone', (value) => {
        expect(neutraliseFormula(value)).toBe(value);
    });

    it('leaves numbers, signed numeric text and empty values alone', () => {
        expect(neutraliseFormula(-5)).toBe(-5);
        expect(neutraliseFormula('-12.5')).toBe('-12.5');
        expect(neutraliseFormula('+3')).toBe('+3');
        expect(neutraliseFormula(null)).toBeNull();
        expect(neutraliseFormula(undefined)).toBeUndefined();
    });
});

describe('PAG-05 report table export', () => {
    it('neutralises formula cells in CSV', () => {
        expect(reportExport.toCsv(['A'], [['=1+1']])).toBe("A\r\n'=1+1");
        expect(reportExport.toCsv([], [['=HYPERLINK("x","y")']])).toBe('"\'=HYPERLINK(""x"",""y"")"');
    });

    it('neutralises formula cells in the xlsx grid and keeps numbers', () => {
        expect(reportExport.toAoa(['@h'], [['-x', 5, null]], ['=t'])).toEqual([["'@h"], ["'-x", 5, ''], ["'=t"]]);
    });
});

describe('PAG-05 task export jobs', () => {
    it('neutralises task fields for both the CSV and the xlsx rows', () => {
        const row = taskExport.taskToRow({ TaskKey: 'K-1', TaskName: '=cmd|x' });
        expect(row.TaskName).toBe("'=cmd|x");
        expect(taskExport.rowsToCsv([row]).split('\r\n')[1].startsWith("K-1,'=cmd|x")).toBe(true);
    });

    it('neutralises any CSV cell', () => {
        expect(taskExport.csvEscape('+1+1')).toBe("'+1+1");
    });
});
