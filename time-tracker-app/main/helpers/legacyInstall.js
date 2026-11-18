// CommonJS, so the repository's jest run can load it without the Electron toolchain.

const path = require('path');

/* Tracker 5 was "Alian Hub Time Tracker 2.0" (package alianhubtimetracker) with its server address
 * baked into the pages it shipped, and kept its sign-in under its own name's user-data folder. */
const LEGACY_NAMES = ['Alian Hub Time Tracker 2.0', 'alianhubtimetracker'];
const LEGACY_PAGES = ['app/home/index.html', 'app/login/index.html', 'app/home.html', 'app/index.html'];
const SESSION_FOLDERS = ['Local Storage', 'IndexedDB'];

const legacyAsarCandidates = ({ platform, env = {}, home = '' }) => {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    return roots.flatMap((root) => LEGACY_NAMES.map((name) => path.join(root, name, 'resources', 'app.asar')));
  }
  if (platform === 'darwin') {
    return ['/Applications', home && path.join(home, 'Applications')].filter(Boolean)
      .flatMap((root) => LEGACY_NAMES.map((name) => path.join(root, `${name}.app`, 'Contents', 'Resources', 'app.asar')));
  }
  return LEGACY_NAMES.map((name) => path.join('/opt', name, 'resources', 'app.asar'));
};

const asServerAddress = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
};

const extractLegacyApiUrl = (html) => {
  const text = String(html || '');
  const data = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (data) {
    try {
      const found = asServerAddress((JSON.parse(data[1]).runtimeConfig || {}).APIURL);
      if (found) return found;
    } catch { /* fall through to the plain search */ }
  }
  const plain = text.match(/"APIURL"\s*:\s*"([^"]+)"/);
  return plain ? asServerAddress(plain[1]) : null;
};

const findLegacyApiUrl = ({ candidates, readFile }) => {
  for (const asar of candidates) {
    for (const page of LEGACY_PAGES) {
      try {
        const found = extractLegacyApiUrl(readFile(path.join(asar, page)));
        if (found) return found;
      } catch { /* not installed here */ }
    }
  }
  return null;
};

/* Copied once, into a profile that has never been used, so an upgrade keeps its sign-in and its
 * unsent offline entries; a profile the new tracker already wrote is never overwritten. */
const copyLegacySession = ({ appData, userData, fs }) => {
  if (fs.existsSync(path.join(userData, 'Local Storage'))) return null;
  const legacy = LEGACY_NAMES.map((name) => path.join(appData, name)).find((dir) => dir !== userData && fs.existsSync(path.join(dir, 'Local Storage')));
  if (!legacy) return null;
  SESSION_FOLDERS.forEach((folder) => {
    const from = path.join(legacy, folder);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(userData, folder), { recursive: true });
  });
  return legacy;
};

module.exports = { LEGACY_NAMES, legacyAsarCandidates, extractLegacyApiUrl, findLegacyApiUrl, copyLegacySession };
