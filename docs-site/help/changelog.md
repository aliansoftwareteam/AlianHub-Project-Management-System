# Changelog

AlianHub changes often. This page explains how versions are numbered, where to read the full list of changes, and what came in the latest releases.

## Where to read what changed

| Where | What it holds |
|---|---|
| [CHANGELOG.md on GitHub](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/CHANGELOG.md) | Every released version and what changed in it |
| [Releases page](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/releases) | The same, one release at a time, with the version tag |
| In the app | **More**, then **See what's new in this version** (in the **Workspace** group) |
| [Beta build log](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/staging/docs/BETA-LOG.md) | Every test build made before the next release |

## How versions work

AlianHub uses three-part version numbers, such as **14.40.2**:

| Part | Goes up when | Example |
|---|---|---|
| First (major) | A change could break how you use or run AlianHub | 14 → 15 |
| Second (minor) | New features arrive | 14.39 → 14.40 |
| Third (patch) | Only fixes | 14.40.1 → 14.40.2 |

Nobody picks the number by hand. Each change is described in a standard way (as a feature, a fix and so on), and a release tool reads those descriptions, works out the next number, and writes the changelog.

### Beta builds

Before a release, changes are merged into a test branch first. Each merge there becomes a numbered beta build, such as **14.41.0-beta.9**: the ninth test build on the way to 14.41.0. Beta builds are listed in the beta build log. They are for testing; run a released version for real work.

### Which version am I on?

Your admin can tell you, or see **See what's new in this version** in the app. The person who runs your server can upgrade it; see [Upgrades](/admin/upgrades).

## Recent releases

### 14.40.2 (20 October 2026)

- Fix: the pickers in the new-project form open above the form instead of behind it.

### 14.40.1 (20 October 2026)

- Fix: email can be sent with a separate login user for the mail server.
- Fix: the app fits under the banner on the demo site.

### 14.40.0 (19 October 2026)

- New: the demo log-in fills itself in, with a one-click **Try the demo** button.
- New: an industry demo company for each company blueprint, with role agents, automations, task routing and workflow runs.
- Fix: delayed automation jobs no longer wait in line.
- Fix: AI apps that list sign-in types the server does not use can still connect.
- Fix: per-project permission settings show only when your plan includes them.
- Fix: a waiting workflow run names the person it waits for.

### 14.39.0 (14 October 2026)

- New: an approved change in the Inbox links to the project it made or changed.
- Fix: a newly invited person stays signed in, and gets their notifications set up, after joining.
- Fix: the log-in page says how to get an account on an invitation-only server.
- Fix: **What next** on **Home** points at your own work before the sample project.
- Fix: clearer project letter tiles, and an explained empty archive view.

### 14.38.0 (14 October 2026)

- New: an AI-generated project plan can add a project dashboard.

For everything else, read the [full changelog](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/CHANGELOG.md).

## Related

- [Upgrades (admin)](/admin/upgrades)
- [Branches, versions and releases (developers)](/developer/releases)
- [Getting help](./support)
