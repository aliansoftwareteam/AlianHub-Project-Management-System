'use strict';

const { AsyncResource } = require('async_hooks');
const multer = require('multer');

/* busboy calls back from its own async context, so without this an upload's filter, storage and handler
 * would run outside the request's AsyncLocalStorage stores (agent mark, narrowing, request id). */

const scopes = new WeakMap();

const inRequestScope = (fn) => function scoped(req, ...rest) {
    const scope = scopes.get(req);
    return scope ? scope.runInAsyncScope(fn, this, req, ...rest) : fn.call(this, req, ...rest);
};

const keepContext = (middleware) => function multerMiddleware(req, res, next) {
    const scope = new AsyncResource('upload');
    scopes.set(req, scope);
    return middleware(req, res, (...args) => {
        scopes.delete(req);
        scope.runInAsyncScope(next, null, ...args);
    });
};

const scopedStorage = (storage) => ({
    _handleFile: inRequestScope(storage._handleFile.bind(storage)),
    _removeFile: inRequestScope(storage._removeFile.bind(storage)),
});

function contextMulter(options) {
    const instance = multer(options);
    instance.storage = scopedStorage(instance.storage);
    instance.fileFilter = inRequestScope(instance.fileFilter);
    for (const method of ['single', 'array', 'fields', 'none', 'any']) {
        const make = instance[method].bind(instance);
        instance[method] = (...args) => keepContext(make(...args));
    }
    return instance;
}

contextMulter.diskStorage = multer.diskStorage;
contextMulter.memoryStorage = multer.memoryStorage;
contextMulter.MulterError = multer.MulterError;

module.exports = contextMulter;
