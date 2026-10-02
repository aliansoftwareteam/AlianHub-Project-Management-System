/* The longest text the server takes in a search (MAX_SEARCH_TEXT in Modules/Company/helpers/callerQueryRules.js). */
export const SEARCH_TEXT_MAX = 200;

/* What a person typed, as the pattern that finds exactly that text. */
export const searchTextPattern = (typed) => String(typed ?? '').slice(0, SEARCH_TEXT_MAX).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
