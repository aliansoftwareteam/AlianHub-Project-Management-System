/* What one connector read may take, and what a whole run may take across its reads. Kept apart from the readers
 * so the skill catalogue can state the bounds without loading a connector. */
const SLACK_READ = Object.freeze({ MESSAGES: 50, CHARS: 20000, HOURS: 168, DEFAULT_HOURS: 24 });
const RUN = Object.freeze({ CALLS: 3, CHARS: 40000 });

module.exports = { SLACK_READ, RUN };
