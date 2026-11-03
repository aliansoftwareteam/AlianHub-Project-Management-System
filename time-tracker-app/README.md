# AlianHub Tracker

The desktop time tracker for AlianHub: Electron with a Next.js renderer, built with Nextron. One build
connects to any AlianHub workspace, hosted (`acme.alianhub.com`) or self-hosted.

## Develop

```
npm install
npm run dev
```

The first run asks for a workspace address. A local server works over plain http (`localhost:4000`);
every other address must be https. A self-hosted build can pre-fill its own server as the first
workspace: `APIURL=https://hub.example.com npm run build`.

## How it connects

1. The address is normalised (`acme` becomes `https://acme.alianhub.com`) and the tracker asks
   `GET /api/v2/tracker/handshake`: is this AlianHub, does the plan include the tracker, and is this
   tracker at least the server's `minVersion`.
2. Sign-in is the browser PKCE flow: the tracker opens `<workspace>/#/oauth2?code_challenge=…&scheme=alianhub-tracker`
   and the page sends the code back on `alianhub-tracker://authorize`.
3. "Open in tracker" in the web app (Settings → Time tracking) opens
   `alianhub-tracker://connect?url=<encoded workspace address>`, which runs the same steps.

`myapp://` stays registered beside `alianhub-tracker://`, because tracker 5 links (the web app's
"Start in tracker", older servers' sign-in page) use it.

The workspace list lives in `workspaces.json` (electron-store) in the user-data folder; each workspace's
sign-in is kept aside in local storage while another one is in use. A tracker upgraded from version 5
starts on the address its old build had and keeps its sign-in.

## Release

Set the version in `package.json`, then push a tag `tracker-v<version>`. A version with a pre-release part
(`6.1.0-beta.2`) goes to the beta channel, anything else to stable. `.github/workflows/tracker-release.yml`
builds, signs and uploads to `https://downloads.alianhub.com/tracker/<channel>/`; the secrets it reads are
listed at its top. Each tracker updates from the channel of the build it runs.

### Release checklist

- [ ] Windows 11: the installer runs without a SmartScreen warning and the publisher reads Alian Software.
- [ ] macOS 14 or later: the dmg opens without a Gatekeeper warning; the screen recording prompt names AlianHub Tracker.
- [ ] Ubuntu 24.04: the AppImage and the deb start; `SHA256SUMS.asc` verifies against the published key.
- [ ] On each system an `alianhub-tracker://connect?url=…` link opens the tracker.
- [ ] Auto-update: a tracker on the previous stable version finds the new one, downloads it and installs it on quit.
- [ ] Settings → Time tracking shows the new version, and "Open in tracker" connects and signs in.
- [ ] A tracker 5 install upgraded to this one keeps its workspace and sign-in.
- [ ] A workspace without the time tracker in its plan shows the plan message at connect.
