/* "Done by" (29b) as a condition for the shared task search, so List, Table and Board narrow
 * from the same query their search, "Me" and saved filters already build. It classifies from
 * workBy and checkedBy the way badgeOf in provenance.js does, never from the stored badge, so
 * every row it returns carries the badge that was asked for. CommonJS so
 * tests/provenance-done-by-query.test.js can run it through Mongoose's matcher. */

const ALL = "all";
const DONE_BY_OPTIONS = Object.freeze([ALL, "human", "agent", "mixed", "unchecked"]);

const cleanDoneBy = (raw) => {
    const value = String(raw || "").toLowerCase();
    return DONE_BY_OPTIONS.includes(value) ? value : ALL;
};

const CLOSED_WITH_RECORD = [{ statusType: "close" }, { "completion.closedBy": { $ne: null } }];
const HAS_AGENT = { "completion.workBy": { $elemMatch: { actorType: "agent" } } };
const NO_AGENT = { "completion.workBy.actorType": { $ne: "agent" } };
const HAS_PERSON = { "completion.workBy": { $elemMatch: { actorType: { $ne: "agent" } } } };
const NO_PERSON = { "completion.workBy": { $not: { $elemMatch: { actorType: { $ne: "agent" } } } } };
const CHECKED = { "completion.checkedBy": { $ne: null } };
const NOT_CHECKED = { "completion.checkedBy": null };

const PATTERN = Object.freeze({
    human: [NO_AGENT],
    agent: [HAS_AGENT, NO_PERSON, CHECKED],
    mixed: [HAS_AGENT, HAS_PERSON, CHECKED],
    unchecked: [HAS_AGENT, NOT_CHECKED]
});

const doneByMatch = (option) => {
    const value = cleanDoneBy(option);
    return value === ALL ? null : { $and: [...CLOSED_WITH_RECORD, ...PATTERN[value]] };
};

module.exports = { ALL, DONE_BY_OPTIONS, cleanDoneBy, doneByMatch };
