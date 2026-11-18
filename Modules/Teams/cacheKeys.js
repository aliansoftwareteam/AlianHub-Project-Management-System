/* Every teams entry sits under `teams:<companyId>:` so one company's list can never be
 * served to another, and so a single prefix delete drops the list together with the
 * per-user sprint identities Modules/Sprints derives from it. */
const teamsCachePrefix = (companyId) => `teams:${companyId}:`;

const teamsListKey = (companyId) => `${teamsCachePrefix(companyId)}list`;

const teamIdentitiesKey = (companyId, uid) => `${teamsCachePrefix(companyId)}identities:${uid}`;

module.exports = { teamsCachePrefix, teamsListKey, teamIdentitiesKey };
