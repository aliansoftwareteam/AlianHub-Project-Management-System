// CommonJS, so the repository's jest run can load it without the Electron toolchain.

/* myapp:// is what tracker 5 registered and what the web app's "Start in tracker" and older
 * servers' sign-in pages still open, so it stays registered beside the new name. */
const SCHEMES = ['alianhub-tracker', 'myapp'];

const isTrackerLink = (arg) => typeof arg === 'string' && SCHEMES.some((scheme) => arg.toLowerCase().startsWith(`${scheme}://`));

const findTrackerLink = (argv) => (Array.isArray(argv) ? argv.find(isTrackerLink) : undefined) || null;

const paramsOf = (link) => new URLSearchParams(String(link || '').split('?').slice(1).join('?'));

const hostOf = (link) => {
  const match = String(link || '').match(/^[a-z-]+:\/\/([^/?#]*)/i);
  return match ? match[1].toLowerCase() : '';
};

const deepLinkKind = (link) => {
  if (!isTrackerLink(link)) return null;
  if (hostOf(link) === 'connect') return 'connect';
  if (paramsOf(link).get('type') === 'trackerStart') return 'trackerStart';
  return 'authorize';
};

const connectTarget = (link) => (deepLinkKind(link) === 'connect' ? paramsOf(link).get('url') || '' : '');

module.exports = { SCHEMES, isTrackerLink, findTrackerLink, deepLinkKind, connectTarget };
