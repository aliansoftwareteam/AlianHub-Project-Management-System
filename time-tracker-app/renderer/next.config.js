// The app version, read from the SAME package.json electron-builder stamps onto the
// installer — so the label in the UI cannot drift from the file people downloaded.
//
// Inlined at build time through `env` rather than publicRuntimeConfig: this is a static
// export (`output: 'export'`), and Next disables runtime config for those, so a value read
// that way would arrive undefined.
const { version: appVersion } = require('../package.json');

// A self-hosted build may still bake in its server: it becomes the first workspace, nothing more.
const defaultWorkspace = process.env.APIURL || '';

// The hosted workspace finder, unless a build names another; a self-hosted build that bakes in its
// server, or sets it empty, has no finder and signs in only by address.
const workspaceFinderUrl = process.env.WORKSPACE_FINDER_URL !== undefined
  ? process.env.WORKSPACE_FINDER_URL
  : (defaultWorkspace ? '' : 'https://auth.alianhub.com/tracker');

/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_DEFAULT_WORKSPACE: defaultWorkspace,
    NEXT_PUBLIC_WORKSPACE_FINDER_URL: workspaceFinderUrl,
  },
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    return config
  },
}
