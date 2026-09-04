const logger = require("../Config/loggerConfig");
const fs = require("fs");
const axios = require('axios');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');


/**
 * [description]
 * @param  {[type]} data   [description]
 * @param  {[type]} itemCB [description]
 * @param  {[type]} doneCB [description]
 * @return {[type]}        [description]
 */
exports.customParaller = (data, itemCB, doneCB) => {
    if (!(data && data.length)) {
        doneCB();
        return;
    }

    const dataR = JSON.parse(JSON.stringify(data));
    const responseData = [];
    let responseCount = 0;

    const happyTit = (dryFruitD) => {
        responseData.push(dryFruitD);
        if (responseCount >= dataR.length - 1) {
            doneCB(responseData);
            return;
        }
        responseCount += 1;
    };

    for (let k = 0; k < dataR.length; k += 1) {
        itemCB(dataR[k], (rd) => {
            happyTit(rd);
        });
    }
};


/**
 * [description]
 * @param  {[type]}   data         [description]
 * @param  {[type]}   loopCallback [description]
 * @param  {Function} done         [description]
 * @return {[type]}                [description]
 */
exports.customWaterfall = (data, loopCallback, done) => {
    if (!(data && data.length)) {
        done();
        return;
    }

    // data = JSON.parse(JSON.stringify(data));

    let loopCount = 0;
    const loop = () => {
        if (loopCount >= data.length) {
            done();
            return;
        }
        loopCallback(data[loopCount], () => {
            loopCount += 1;
            loop();
        });
    };
    loop();
};


/**
 * Resolves a series of promise factories, retrying if needed.
 *
 * @param {number} maxTryCount How many retries to perform.
 * @param {Array<() => Promise<any>>} promiseFactories Functions
 *     that return promises. These must be functions to enable retrying.
 * @return Corresponding Promise.allSettled values.
 */
exports.allSettledWithRetry = async (maxTryCount, promiseFactories) => {
    let results;
    for (let retry = 0; retry < maxTryCount; retry++) {
      let promiseArray;
      if (results) {
        // This is a retry; fold in results and new promises.
        promiseArray = results.map(
            (x, index) => x.status === "fulfilled"
              ? x.value
              : promiseFactories[index]())
      } else {
        // This is the first run; use promiseFactories only.
        promiseArray = promiseFactories.map(x => x());
      }
      results = await Promise.allSettled(promiseArray);
      // Avoid unnecessary loops, though they'd be inexpensive.
      if (results.every(x => x.status === "fulfilled")) {
        return results;
      }
    }
    return results;
};

exports.writeFile = (path, data, cb) => {
    try {
        fs.writeFile(path, data, (err, wData) => {
            if (err) {
                logger.error(`File Create Issue: ${path} : Error: ${err}`);
                cb({
                    status: false,
                    error: err
                });
                return;
            }
            logger.info(`Write File: ${JSON.stringify(data)} `);
            cb({
                status: true,
                data: wData
            });
        })
    } catch (error) {
        logger.error(`File Create Issue: ${path} : Error: ${error}`);
        cb({
            status: false,
            error
        });
    }
}

function parseDigestAuth(header) {
    const authDetails = {};
    const parts = header.split(', ');

    parts.forEach(part => {
        const [key, value] = part.split('=');
        authDetails[key] = value.replace(/"/g, '');
    });

    authDetails.uri = '/path'; // Replace with your actual URI
    authDetails.cnonce = crypto.randomBytes(16).toString('hex');
    authDetails.qop = 'auth';

    return authDetails;
}


/**
 * Sanitize Input
 * @param {String} input 
 * @returns 
 */
exports.sanitizeInput = (input) => {
    return input
    .replace(/&/g, "&amp;")      // Replace &
    .replace(/</g, "&lt;")       // Replace <
    .replace(/>/g, "&gt;")       // Replace >
    .replace(/"/g, "&quot;")     // Replace "
    .replace(/'/g, "&#39;")      // Replace '
    .replace(/`/g, "&#96;")      // Replace backticks (`)
    .replace(/\(/g, "&#40;")     // Replace (
    .replace(/\)/g, "&#41;");    // Replace )
};


/**
 * Mongo Error Message
 * @param {Object} errorObj 
 * @returns 
 */
exports.mongoErrorMessage = (errorObj) => {
    try {
        if (!errorObj || typeof errorObj !== "object") {
            return "An unknown error occurred.";
        }

        switch (errorObj?.errorResponse?.code) {
            case 11000:
                // Handle duplicate key error
                const key = Object.keys(errorObj?.errorResponse?.keyValue || {}).join(", ");
                const value = Object.values(errorObj?.errorResponse?.keyValue || {}).join(", ");
                return `The value '${value}' already exists for the field(s) '${key}'.`;
            case 13:
                // Unauthorized error
                return "Unauthorized: You do not have the necessary permissions to perform this action.";
            case 11601:
                // Interrupted or network errors
                return "The operation was interrupted or failed due to a network issue. Please try again.";

            default:
                // Handle missing required fields
                if (errorObj.errors) {
                    const missingFields = Object.keys(errorObj.errors).filter(field => {
                        return errorObj.errors[field].kind === "required";
                    });
                    if (missingFields.length > 0) {
                        return `Missing required field(s): ${missingFields.join(", ")}. Please provide all required fields.`;
                    }
                }

                // Catch-all for other error codes
                return errorObj.message || "An unexpected database error occurred.";
        }
    } catch (error) {
        return error.message || error
    }
};

/**
 * Get Browers Info
 * @param {String} userAgent 
 * @returns 
 */
exports.getBrowersInfo = (userAgent) => {
    const parser = new UAParser();
    const browserInfo = JSON.parse(JSON.stringify(parser.setUA(userAgent).getResult()));
    return {
        useragent: userAgent || 'Unknown',
        cpu: browserInfo.cpu || 'Unknown',
        browser: browserInfo.browser || 'Unknown',
        os: browserInfo.os || 'Unknown'
    };
};


exports.convertToSeconds = (input) => {
    // Extract the number and the unit (m or h)
    const match = input.match(/^(\d+)([mh])$/);
    if (!match) {
        throw new Error("Invalid input format. Use a number followed by 'm' or 'h'.");
    }

    const value = parseInt(match[1], 10); // Extract the numeric value
    const unit = match[2]; // Extract the unit ('m' or 'h')

    // Convert based on the unit
    if (unit === 'm') {
        return value * 60; // Convert minutes to seconds
    } else if (unit === 'h') {
        return value * 60 * 60; // Convert hours to seconds
    }
};
