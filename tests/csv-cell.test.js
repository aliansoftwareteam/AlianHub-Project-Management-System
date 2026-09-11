const { csvCell, csvRow } = require('../utils/csv');
const { csvEscape: reportEscape } = require('../Modules/Export/helpers/exportRules');
const { csvEscape: jobEscape } = require('../Modules/ExportJobs/helpers/exportRules');
const { escapeCsv: timesheetEscape } = require('../Modules/TimeSheet/helpers/timesheetCsv');

describe('csvCell', () => {
    it.each([
        ['=1+1', "'=1+1"],
        ['+cmd', "'+cmd"],
        ['-2+3', "'-2+3"],
        ['@SUM(A1)', "'@SUM(A1)"],
        ['\tTab', "'\tTab"],
        ['\rReturn', `"'\rReturn"`],
        ['=HYPERLINK("x","y")', `"'=HYPERLINK(""x"",""y"")"`],
    ])('neutralises %j', (value, expected) => {
        expect(csvCell(value)).toBe(expected);
    });

    it.each([
        ['plain', 'plain'],
        ['a,b', '"a,b"'],
        ['say "hi"', '"say ""hi"""'],
        ['line1\nline2', '"line1\nline2"'],
        [null, ''],
        [undefined, ''],
        [42, '42'],
        [-5, '-5'],
        ['-12.5', '-12.5'],
        ['+3', '+3'],
    ])('keeps %j readable', (value, expected) => {
        expect(csvCell(value)).toBe(expected);
    });

    it('joins a row', () => {
        expect(csvRow(['a', '=b', 3])).toBe("a,'=b,3");
    });

    it('is the escaper every export uses', () => {
        [reportEscape, jobEscape, timesheetEscape].forEach((escape) => expect(escape('=1+1')).toBe("'=1+1"));
    });
});
