/* One file per industry; the order is the order the command builds them in. */
const SCENARIOS = Object.freeze([
    require('./technova'),
    require('./finedge'),
    require('./swiftlogix'),
    require('./peoplefirst'),
]);

module.exports = { SCENARIOS };
