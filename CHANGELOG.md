# Changelog

All notable changes to **AlianHub** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Starting from the next release, entries below this section are generated
automatically by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commits](https://www.conventionalcommits.org/) on `main`.

> 💡 **For maintainers:** never edit the auto-generated sections by hand —
> release-please will overwrite your changes on the next release cycle.
> If you need to amend changelog wording, edit the source commit message
> and force-push, then re-run the release workflow.

---

## [14.3.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.2.0...v14.3.0) (2026-06-16)


### 🚀 Features

* **platform:** Tier 2 & Tier 3 — outgoing webhooks with delivery log, global search, epics, async CSV/XLSX export jobs, personal API tokens + activity log, pages/wiki, public sharing + intake forms, and the import framework ([#229](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/229))
* **tier1:** comment reactions, recent tasks, auto-archive, burndown chart, and relation alerts ([#228](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/228))
* **auth:** add GitLab OAuth login and harden Google/GitHub sign-in ([#235](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/235))
* **mcp:** server-side permission enforcement and token auth for the AlianHub MCP server ([#238](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/238))
* **stickies:** add personal sticky notes ([#239](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/239))
* **webhooks:** add Slack and Discord delivery format presets ([#243](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/243))
* **demo:** env-gated demo-mode banner ([#244](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/244))
* **dashboard:** dismiss recently-added project suggestions ([#246](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/246))
* **changelog:** show release time in 12-hour format on the What's New page ([#233](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/233))


### 🐛 Bug Fixes

* **exports:** restore staging boot — xlsx was a frontend-only dependency ([#230](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/230))
* **server:** stop the recursive restart wrapper causing spawn EAGAIN outages ([#231](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/231))
* **ui:** consolidate toolbar features into a more-menu and fix Search-All and public share links ([#232](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/232))
* **i18n:** close the Stickies object in en.js so the frontend builds ([#245](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/245))
* scope MCP permission guards to PAT requests and drop the project-count cap ([#248](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/248))
* address safe CodeRabbit findings from the promotion review ([#249](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/249))


### 📘 Documentation

* **readme:** honest feature table, Plane comparison, and services section ([#241](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/241))
* add ROADMAP with a free-stays-free commitment ([#242](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/242))
* add manual test cases for the new features ([#234](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/234))

## [14.2.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.1.0...v14.2.0) (2026-06-10)


### 🚀 Features

* **tasks:** add task-to-task relations between work items — blocks, blocked-by, duplicates, duplicated-by and relates-to, with a Linked Tasks section in task detail, live socket sync, activity history on both sides, and a same-project task search ([07392b0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/07392b078b8a0b9fc6171a1fdcfb1b56fbea46a1), [#221](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/221))


### ⚙️ CI

* **docker:** build only on push to main + release — skip PR triggers ([#218](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/218))
* **lint:** allow long-running branches in promotion PRs ([#217](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/217))

## [14.1.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.0.26...v14.1.0) (2026-06-09)


### 🚀 Features

* add CI/CD workflow for deployment and validation ([dfd5b68](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/dfd5b68311ba8c44e2f3489e7cf6fafc66423511))
* add comprehensive naming conventions test suite ([0bba15d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0bba15d48203cdc1157021d63b32d5822c76908e))


### 🐛 Bug Fixes

* **auth:** prevent reset token reuse, fix logout session error, fix invite link typo ([7fc3ac1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7fc3ac1b2fa926bb0f73617cfbd9bb7e4bc02597))
* **email:** use Resend HTTP API to bypass SMTP port blocks on Render free tier ([1fbfabf](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1fbfabfcb214346ec7545f9ba519029c9ba3d61d))
* **repo-structure:** naming fixes, gitignore updates, env.example ove… ([dd1c3ac](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/dd1c3ac5644bf18914c47dde775f0b7331667753))
* **repo-structure:** naming fixes, gitignore updates, env.example overhaul ([69712b4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/69712b46136bba6821b7154a32a78c6c25b8c55d))


### 📘 Documentation

* **claude:** add comprehensive development guide for project management system ([5fff69c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5fff69cf0d1858bf0da8f4c08aa3d023d02c385c))

## [14.0.26] — Initial release-please baseline

The version captured at the moment `release-please` was introduced. No
changes are listed here; everything prior is preserved in the
[git commit log](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commits/main)
and on the [Releases page](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/releases).

Going forward, every release will appear above this line with grouped
changes (Features / Bug Fixes / Performance / Refactors / Documentation /
Reverts).
