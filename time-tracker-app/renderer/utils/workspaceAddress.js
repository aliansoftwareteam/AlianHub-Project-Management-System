// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

const HOSTED_DOMAIN = 'alianhub.com';
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const isLocalHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
};

const withScheme = (text) => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  const host = text.split(/[/:?#]/)[0];
  return `${isLocalHost(host) ? 'http' : 'https'}://${text}`;
};

/* "acme" is a hosted workspace; anything with a dot, a port or a scheme is taken as the full
 * address of a self-hosted one. Only https leaves the machine: a session token sent over plain
 * http to another host can be read on the way. allowHttp is for an address a build already
 * shipped with, which worked before the upgrade and must keep working. */
const normaliseWorkspaceAddress = (input, { allowHttp = false } = {}) => {
  const text = String(input == null ? '' : input).trim();
  if (!text) return { ok: false, reason: 'empty' };
  const full = SUBDOMAIN.test(text) && !isLocalHost(text) ? `https://${text.toLowerCase()}.${HOSTED_DOMAIN}` : withScheme(text);
  let parsed;
  try {
    parsed = new URL(full);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return { ok: false, reason: 'invalid' };
  if (parsed.protocol === 'http:' && !allowHttp && !isLocalHost(parsed.hostname)) return { ok: false, reason: 'insecure' };
  const path = parsed.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}` };
};

const workspaceHost = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return String(url || '');
  }
};

const sameWorkspace = (a, b) => {
  const left = normaliseWorkspaceAddress(a);
  const right = normaliseWorkspaceAddress(b);
  return left.ok && right.ok && left.url === right.url;
};

module.exports = { HOSTED_DOMAIN, normaliseWorkspaceAddress, workspaceHost, sameWorkspace, isLocalHost };
