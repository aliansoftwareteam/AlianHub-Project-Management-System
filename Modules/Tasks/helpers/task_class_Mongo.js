// Task domain methods are organized by concern under ./taskMongo/*.
// Each mixin is a plain object of methods merged into Task.prototype, so
// internal `this.foo(...)` calls and the exported `taskMongo` singleton
// keep working exactly as before. See issue #164 for the rationale.

const createMixin = require('./taskMongo/create');
const updateBasicMixin = require('./taskMongo/updateBasic');
const updateAssignmentMixin = require('./taskMongo/updateAssignment');
const updateMetaMixin = require('./taskMongo/updateMeta');
const structuralMixin = require('./taskMongo/structural');
const mergeDuplicateMixin = require('./taskMongo/mergeDuplicate');
const internalsMixin = require('./taskMongo/internals');

class Task {}

Object.assign(
    Task.prototype,
    createMixin,
    updateBasicMixin,
    updateAssignmentMixin,
    updateMetaMixin,
    structuralMixin,
    mergeDuplicateMixin,
    internalsMixin,
);

exports.taskMongo = new Task();
