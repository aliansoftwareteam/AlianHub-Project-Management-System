const URL_RX = /\bhttps?:\/\/[^\s'"<>]+/gi;

/* An S3 error can echo the request URL, and a presigned one carries the
 * credential and signature in its query string. */
const withoutQuery = (url) => url.split(/[?#]/)[0];

const failureReason = (error) => {
    const code = error?.Code || error?.code || (error?.name && error.name !== 'Error' ? error.name : 'Error');
    const status = error?.$metadata?.httpStatusCode;
    const message = String(error?.message || error || 'unknown error').replace(URL_RX, withoutQuery);
    return { code: String(code), ...(status ? { status } : {}), message };
};

const failuresOf = (items, results) => results.flatMap((result, i) => (
    result.status === 'rejected' ? [{ file: items[i].path, ...failureReason(result.reason) }] : []
));

const describeFailures = (failures) => failures
    .map(({ file, code, status, message }) => `${file} (${code}${status ? ` ${status}` : ''}: ${message})`)
    .join('; ');

/* The log format prints only the message string, so the detail has to be in it. */
const logUploadFailures = (logger, items, results) => {
    const failures = failuresOf(items, results);
    if (failures.length) logger.error(`Some uploads failed: ${describeFailures(failures)}`);
    return failures;
};

module.exports = { failureReason, failuresOf, describeFailures, logUploadFailures };
