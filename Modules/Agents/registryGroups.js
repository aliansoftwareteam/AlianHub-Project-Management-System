const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'registry');

/* The order the list had as one file, which registry.keys() and the manifest keep.
 * A new group needs no line here: every other file in the folder loads after these, by name. */
const FIRST = Object.freeze(['performance', 'data', 'manage', 'work', 'goals', 'taskLists', 'connectors']);

const names = fs.readdirSync(DIR).filter((file) => file.endsWith('.js')).map((file) => path.basename(file, '.js'));
const later = names.filter((name) => !FIRST.includes(name)).sort();

module.exports = Object.freeze([...FIRST, ...later].map((name) => require(path.join(DIR, name))));
