// The one rule for a password a person chooses (setup, sign-up, reset, change). The auth
// forms bundle this file through the `@passwordRule` alias, so a form refuses exactly what
// the server refuses. Sign-in never applies it: passwords stored before the rule keep working.
// Dependency-free so it can be bundled.

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

// Any character that is not an ASCII letter, a digit or whitespace is the symbol, so the
// `.` or `_` a password manager generates counts. No `|` or `:`: the legacy validation
// composable splits its rule string on both.
const PASSWORD_PATTERN = new RegExp(`^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{${MIN_PASSWORD_LENGTH},${MAX_PASSWORD_LENGTH}}$`);

const PASSWORD_RULE_MESSAGE = `Use ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters, including an uppercase letter, a lowercase letter, a number and a symbol.`;

const meetsPasswordRule = (password) => typeof password === 'string' && PASSWORD_PATTERN.test(password);

module.exports = { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_PATTERN, PASSWORD_RULE_MESSAGE, meetsPasswordRule };
