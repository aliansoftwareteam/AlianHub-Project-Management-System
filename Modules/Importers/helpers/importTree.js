const MAX_LISTED = 50;

const COUNT_KEY = Object.freeze({ TOO_DEEP: 'tooDeep', PARENT_MISSING: 'parentMissing', CYCLE: 'cycle' });

/* What createMultipleTasks had to re-hang, counted by reason and named, for the person who ran the import. */
const adjustedReport = (adjusted) => {
    const known = (Array.isArray(adjusted) ? adjusted : []).filter((entry) => entry && COUNT_KEY[entry.reason]);
    if (!known.length) return null;
    const report = { tooDeep: 0, parentMissing: 0, cycle: 0 };
    known.forEach((entry) => { report[COUNT_KEY[entry.reason]] += 1; });
    return { ...report, rows: known.slice(0, MAX_LISTED).map((entry) => ({ name: String(entry.TaskName || ''), reason: entry.reason })) };
};

const SENTENCES = Object.freeze({
    tooDeep: (count) => (count === 1
        ? '1 subtask was deeper than three levels and was placed under its nearest parent.'
        : `${count} subtasks were deeper than three levels and were placed under their nearest parent.`),
    parentMissing: (count) => (count === 1
        ? '1 row named a parent that is not in the file and was imported as a task.'
        : `${count} rows named a parent that is not in the file and were imported as tasks.`),
    cycle: (count) => (count === 1
        ? '1 row named parents that loop and was imported as a task.'
        : `${count} rows named parents that loop and were imported as tasks.`),
});

const adjustedSentences = (report) => Object.keys(SENTENCES)
    .filter((key) => report && report[key] > 0)
    .map((key) => SENTENCES[key](report[key]));

module.exports = { MAX_LISTED, adjustedReport, adjustedSentences };
