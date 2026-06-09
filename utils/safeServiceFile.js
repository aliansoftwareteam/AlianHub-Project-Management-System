/**
 * BUG-036 / #90 — safe resolver for the firebase-adminsdk service file.
 *
 * `Modules/checkinstallstep/controller.js` did
 *   `require("../" + process.env.SERVICE_FILE)`
 * which lets an attacker (or a careless installer wizard input) write
 * an arbitrary relative path into `SERVICE_FILE` and have Node `require`
 * any file inside the repo. With `../../etc/passwd`-style payloads the
 * load fails (because `require` only accepts JS/JSON), but a path that
 * resolves to a real JS file inside the project still gets executed
 * with full process privileges.
 *
 * This helper:
 *   * resolves the supplied path against the project root (the parent
 *     of `Modules/`),
 *   * confirms the resolved path is still inside the project root
 *     (no `..` escape),
 *   * confirms the file extension is `.json` (the Firebase service-
 *     account file is always JSON; this blocks the "make me execute an
 *     arbitrary .js" path),
 *   * confirms the file actually exists.
 *
 * If any check fails, it throws — the caller can return a useful
 * installer-step error instead of letting `require` blow up with a
 * confusing message (or worse, succeed on the wrong file).
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

exports.resolveServiceFile = function resolveServiceFile(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.length) {
        throw new Error('SERVICE_FILE is not set or is empty.');
    }

    // Reject absolute paths outright — installer should always point
    // somewhere inside the deployment. Check both POSIX and Windows
    // shapes regardless of host OS so a Linux host still rejects a
    // payload like `C:\Windows\System32\...` (path.isAbsolute is
    // platform-bound and would otherwise treat that as a relative
    // filename and fall through to the .json check).
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
        throw new Error('SERVICE_FILE must be a path relative to the project root.');
    }

    const resolved = path.resolve(PROJECT_ROOT, relativePath);
    const rootWithSep = PROJECT_ROOT + path.sep;
    if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) {
        throw new Error('SERVICE_FILE resolves outside the project root.');
    }

    if (path.extname(resolved).toLowerCase() !== '.json') {
        throw new Error('SERVICE_FILE must point to a .json credentials file.');
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`SERVICE_FILE not found: ${resolved}`);
    }

    return resolved;
};
