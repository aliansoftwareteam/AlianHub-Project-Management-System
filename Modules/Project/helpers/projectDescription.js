'use strict';

const { cleanDescription, DESCRIPTION_FIELDS } = require('../../Tasks/helpers/cleanRichText');

const SAVED_WHOLE = 'A description is saved whole.';

const touches = (path) => DESCRIPTION_FIELDS.includes(String(path).split('.')[0]);

class ProjectDescriptionRefused extends Error {
    constructor() {
        super(SAVED_WHOLE);
        this.name = 'ProjectDescriptionRefused';
        this.statusCode = 400;
    }
}

/* A project's description is cleaned where it stands in the update. It is replaced whole or removed: an update that
 * reaches inside it, appends to it or renames another field onto it could put text there that was never cleaned. */
const holdProjectDescription = (updateObject, key) => {
    if (!updateObject || typeof updateObject !== 'object') return;
    const operator = key || '$set';
    const paths = Object.keys(updateObject).filter(touches);
    const renamedOnto = operator === '$rename' && Object.values(updateObject).some(touches);
    if (!paths.length && !renamedOnto) return;
    if (operator === '$unset' && !renamedOnto) return;
    if (operator !== '$set' || paths.some((path) => path.includes('.'))) throw new ProjectDescriptionRefused();
    cleanDescription(updateObject);
};

module.exports = { ProjectDescriptionRefused, holdProjectDescription, SAVED_WHOLE };
