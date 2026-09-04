/* Marks the schema every install had before migrations existed. Nothing to
 * change; its record tells the Upgrade page and the CLI where history starts. */
module.exports = {
    id: '001-baseline',
    scope: 'global',
    async up() {},
};
