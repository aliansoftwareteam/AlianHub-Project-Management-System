// The app version, read from the SAME package.json electron-builder stamps onto the
// installer — so the label in the UI cannot drift from the file people downloaded.
//
// Inlined at build time through `env` rather than publicRuntimeConfig: this is a static
// export (`output: 'export'`), and Next disables runtime config for those, so a value read
// that way would arrive undefined.
const { version: appVersion } = require('../package.json');

/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    return config
  },
  serverRuntimeConfig: {
    APIURL:process.env.APIURL,
  },
  publicRuntimeConfig:{
    APIURL:process.env.APIURL,
  }
}
