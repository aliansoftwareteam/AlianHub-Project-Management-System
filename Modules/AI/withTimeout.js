'use strict';

/* Ends `call` after `ms` with `message`. The timer is cleared as soon as either side settles: one left to run
 * keeps the process, and every test file that made a call, alive until it fires. */
const withTimeout = (call, ms, message) => {
    let timer = null;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
};

module.exports = { withTimeout };
