// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

let base = '';

const setWorkspaceBase = (url) => {
  base = String(url || '').replace(/\/+$/, '');
};

const getWorkspaceBase = () => base;

/* Read on every request rather than fixed when the axios instances are made, so a workspace
 * connected or switched to after start-up is where the next request goes. */
const withWorkspaceBase = (config) => {
  if (!base) throw new Error('No workspace is connected');
  return { ...config, baseURL: base };
};

const workspaceUrl = (path = '') => `${base}${path}`;

module.exports = { setWorkspaceBase, getWorkspaceBase, withWorkspaceBase, workspaceUrl };
