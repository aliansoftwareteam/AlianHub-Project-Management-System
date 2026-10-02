/* The longest text the server takes in a search (MAX_SEARCH_TEXT in Modules/Company/helpers/callerQueryRules.js). */
export const SEARCH_TEXT_MAX = 200;

/* What a person typed, as a search sends it. The server reads it as text and escapes it; text escaped here as well
 * would be searched for with its backslashes. */
export const typedSearchText = (typed) => String(typed ?? '').slice(0, SEARCH_TEXT_MAX);
