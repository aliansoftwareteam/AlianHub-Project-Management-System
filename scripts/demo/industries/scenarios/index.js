/* One file per industry; the order is the order the command builds them in. */
const SCENARIOS = Object.freeze([
    require('./technova'),
    require('./finedge'),
    require('./swiftlogix'),
    require('./peoplefirst'),
    require('./forgeline'),
    require('./brightwave'),
    require('./cartwheel'),
    require('./northgate'),
    require('./maplegrove'),
    require('./carewell'),
    require('./hartleymoss'),
]);

module.exports = { SCENARIOS };
