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

## [14.17.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.16.0...v14.17.0) (2026-07-23)


### 🚀 Features

* **tracker:** custom idle notification via a shared notification template ([6c6b606](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/6c6b6060a05edfbc00c7704af89ed98c64fd957e))
* **tracker:** custom idle notification via a shared notification template ([c937681](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c93768187da9bdc7e720605a43049884e6f57d16))


### 🐛 Bug Fixes

* prevent comment count overlapping the project view tab label ([a55a92d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a55a92d410ab5beb5628db4e85325171bbe7980a))
* prevent comment count overlapping the project view tab label ([ecfb350](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ecfb350b85ddeec4db095f77ba126e376a59e3bd))

## [14.16.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.15.0...v14.16.0) (2026-07-22)


### 🚀 Features

* **dashboard:** add refresh button to Task List card ([2b6f5a0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2b6f5a071acd3197c6eec68dad74324a07e2dfeb))
* **projects:** compact project sidebar header and "+ New" menu ([3157419](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/315741975bfed3ebda577ac37573a7548c1c74b4))
* **projects:** move view switcher to its own row + lighter header ([65361ef](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/65361ef6c353843b624f919cb633f972ccd8d358))


### 🐛 Bug Fixes

* **dashboard:** base achievements on-time on last worklog, status fallback ([32c780b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/32c780bb1ffd2009cdd89a05f459dc8571946562))
* **dashboard:** count on-time via last worklog when status flip is late ([4abd197](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4abd19730400bb7e3e0d7513c7de8986fda9a899))
* **dashboard:** exclude chat tasks and zero-evidence completions from member cards ([a159d52](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a159d528308073f6dc61401a01558af2058d16de))
* **dashboard:** relabel achievements 'Needs Improvement' tab to 'Over Estimate' ([00d2ea5](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/00d2ea5ef87f9a7d8f70483b4461653a85c64858))
* **kanban:** clean up card checkbox and drop task type from board cards ([baa4c7e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/baa4c7e04c198a6d24f7e565dfecb21c7459d624))
* **projects:** only grow view tabs on hover when the user has the view menu ([c4e5488](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c4e548889e4c89247734998710efa6a187572c6b))
* **projects:** stop the filter search stretching when the toolbar wraps ([ef47b9c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ef47b9ca76df58cbe9b17f102efc23c568ce2346))

## [14.15.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.14.0...v14.15.0) (2026-07-20)


### 🚀 Features

* **dashboard:** all-projects toggle for card project selector ([3d8d639](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3d8d6393d496af1f77ca2bfb46df35bd7dff0a77))
* **dashboard:** project scope selector (all/include/exclude) + wire personal cards ([837a75c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/837a75c9083d0c336442643b939e9e5ed4afc121))
* **dashboard:** project-scope selector + time tracker UX/deep-link improvements ([fa513ff](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fa513ff79d5182b1f83423b1c0e8f84736f59c13))
* **dashboard:** roll out project scope (include/exclude) to remaining cards ([0ab39a9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0ab39a940fd48c318d53a2193f58f3d4a8ba0c5e))
* **tracker:** collapsible Today's Tasks rows with grouped totals ([acecc66](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/acecc66c4495e0c2f6ff9fc8f67fe7134d664206))
* **tracker:** compact start sheet, running-screen polish, open-in-web ([6e39a02](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/6e39a023dc4b0849eb39d7208acfaa6d91938505))
* **tracker:** hide Start Tracker on completed tasks ([b320866](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b3208665bcadb5bd6ac2b2e2e114ac3083e88fa8))
* **tracker:** notify on idle instead of auto-stopping ([94b14ae](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/94b14ae087c983c8f97978bf429a19151779bdea))
* **tracker:** prompt on deep-link start while already tracking ([692cf6b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/692cf6bf714a623c332a14b01d8ea53b47971e0a))
* **tracker:** toast when the Start Tracker deep link doesn't open ([b79502b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b79502b459f576435882f97ece5780659c54918a))
* **tracker:** toast when the Start Tracker deep link doesn't open ([fd03f1b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fd03f1b4bd98da4700dc46cc6ddac9f2ad9ad5db))


### 🐛 Bug Fixes

* **dashboard:** address CodeRabbit review on [#387](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/387) ([9fe8d2c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9fe8d2cb2acf12aa40dd3e8a06d50ee6b21c455d))
* **dashboard:** correct my-achievements ownership/completion and add projectpulse project filter ([f331718](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f3317186ff30889a891c525394876eaed7d314fb))
* **dashboard:** free resources pool from store companyUsers, excluding deleted/admin ([5f80e4e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5f80e4e3ea750f9656be4b2688e479e25dbb0ddf))
* **tracker:** exclude soft-deleted tasks from By-Task search ([9d49423](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9d4942384eb1ad703a1a1e8fb24f748c145a3079))

## [14.14.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.13.0...v14.14.0) (2026-07-17)


### 🚀 Features

* **tracker:** deep link to start a task in the desktop tracker from web ([bb463cf](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bb463cf909108f9699812adeda1ee034068aebff))
* **tracker:** edit comment on running screen restarts session ([e900276](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e90027612d2929973ca6159d1e6a4622bf1e2cd1))
* **tracker:** pop-in/pop-out animation for the screenshot notification ([cbe69f0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/cbe69f01e569cc5ea409c5073c7e573478ac36cc))
* **tracker:** rework header/form UI, add task search & today's logged hours ([b52313c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b52313c57e91a06dca27538878654061b3a02a7d))


### 🐛 Bug Fixes

* **storage:** getUserProfile returns a valid signed URL ([b52313c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b52313c57e91a06dca27538878654061b3a02a7d))
* **tracker:** address CodeRabbit review on [#384](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/384) ([de42749](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/de427491e40a762cd5007a51a52e7904b82e1359))
* **tracker:** hide header refresh button while tracking ([d6f141e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d6f141e737a89b12ebc623f487ed5375412c1e4d))
* **tracker:** replace dead Firebase default task image with local asset ([2991c0f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2991c0f6a8983edd982a2414dadb74db190be481))


### ♻️ Refactors

* **tracker:** use project Modal for the Start Tracker prompt ([f8442f5](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f8442f50995684917bdd13482fc4357786bdd8e6))

## [14.13.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.12.0...v14.13.0) (2026-07-17)


### 🚀 Features

* **dashboard:** task-list date filter, ETA links, resize + RBAC/conf… ([fc589f2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fc589f2d94776d10bffd1396c2a6b89468ce0275))
* **dashboard:** task-list date filter, ETA links, resize + RBAC/config fixes ([67f66d0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/67f66d02ccb8b9d1618a6784e6aa399a14f61f3b))


### 🐛 Bug Fixes

* **dashboard:** key task-list load paths off merged filterQuery ([591cfff](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/591cfffa4dfabe74192542638163d7d78fa0344b))
* **dashboard:** keyboard-accessible task links in Team Logged vs ETA card ([0ec6fd8](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0ec6fd88b68b3d927e7f7dfb6efebebd4ef69d2c))

## [14.12.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.11.0...v14.12.0) (2026-07-16)


### 🚀 Features

* **dashboard:** milestone card due-date timeline table ([c28019a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c28019a8ca98f75c0c2d9fcdd3aefbf1f4ef7921))
* **dashboard:** milestone card due-date timeline table ([a9d2fd2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a9d2fd29ac486717d7fbdd76dfe26e65c1008fb8))

## [14.11.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.10.1...v14.11.0) (2026-07-10)


### 🚀 Features

* add bulk move operation to task bulk action bar ([70ddc8b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/70ddc8bd27baf55307e26c44aa68012d8d1df472))
* **dashboard:** add Owner/Admin Milestone report card ([2afd127](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2afd12742c3eca2d570a0baac60fd4630c7b877b))
* **dashboard:** fix milestone card display + add status filter ([e6dda99](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e6dda9955f13dbad22082283fb3e000bef24d1cf))
* **dashboard:** milestone card single USD tile + period receivable filter ([3b70c85](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3b70c852062796a7a0cae5108cc028b1a2676eb6))
* **dashboard:** restrict Active Projects / Projects by Type / Running Projects cards to Owner/Admin ([422504e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/422504e0e77e14fe3c38d1e56614d6e753a337b4))
* **pto:** 9h day default, working-days capacity, leave-day totals + Total Days column ([b6e7b5d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b6e7b5d2f17ebf18a6c6eb7ec6140198eccf9176))
* **pto:** notify requester on leave approve/reject (in-app + email) ([ee156a4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ee156a44f430611ac3aabfdb4609a6442a01b2df))
* **pto:** time-off table search/filters/pagination, date validation, created column + saved-format dates ([2522c6c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2522c6cdb1263663ff811a69fecbc381a7af2f81))


### 🐛 Bug Fixes

* **dashboard:** pin milestone card footer + responsive tiles + open report in new tab ([bece857](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bece857da490080505f5cd3a9f84980c73a0f51f))
* **pto:** drop the month date-range from the capacity label, keep the working-days count ([b5c6afc](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b5c6afcf8f27bd839b3e72eba7893e2204ac67a7))
* **task:** remove permission gate on story points field ([563fc3d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/563fc3d38ff2b1ada471051d87f1b2c68097dfed))
* **tasks:** re-sync sprint counts in real time after bulk move ([01c3b76](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/01c3b76bc63772ec9d2523fbe8c70375c1e91329))
* **tasks:** update sprint-count badges in real time on bulk move ([8063ebb](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8063ebb414aee2de65a9872187f0a8624db5f123))
* **views:** remove duplicate legacy gantt and timeline views ([4856bf2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4856bf2cbadb4d81985fc17ab331fb3ebcd710e9))

## [14.10.1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.10.0...v14.10.1) (2026-07-09)


### 🐛 Bug Fixes

* **header:** hide the integrations item in the workspace menu ([f2289e4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f2289e48d3b51b6b22acd9aebd79800f4f9d4db0))
* **header:** hide the integrations item in the workspace menu ([7993276](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/79932768fc8ae53c64c115c5d806f957ac97f055))
* **pto:** add reason column to the time-off table ([eeb7832](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/eeb78328faf93c012db55c092f054977cf6fc60c))
* **pto:** restrict leave types and add reason column to time-off table ([a33e346](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a33e346bb4e90c83acd0a8c87f28d6ce16b810f7))
* **pto:** restrict time-off types to casual, privilege, sick leave ([58620ae](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/58620ae625312301636aad8408641e7b4e0d9cb3))
* **pto:** show the requester's name in the admin time-off table ([9e8f5df](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9e8f5df7918a37178300b786c23d2495ee240435))
* **pto:** show the requester's name in the admin time-off table ([c5db565](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c5db565a9ec99b8305ef9f2eeb232aea8f54de53))
* **settings:** hide sso, scim and audit log from the settings sidebar ([769976c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/769976c096c5e64d3788f44180358e763be8c185))
* **settings:** hide sso, scim and audit log from the settings sidebar ([9480e44](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9480e449302c2e4cebf714513066efbe2c747238))

## [14.10.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.9.0...v14.10.0) (2026-07-08)


### 🚀 Features

* **ai-assist:** richer task plans — few-shot examples + reliable sub-tasks/epics ([1c67031](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1c670312214e0fc9ac777b35baa02ed9f7e9bb4a))
* **dashboard:** member self-view cards + role-based template routing ([edf6761](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/edf6761d1f9dd7ef17986d43222da21d29230048))


### 🐛 Bug Fixes

* **ai-assist:** count sub-tasks in the sprint task count ([5cad5d4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5cad5d4001718fc73c0c91c52a045f79519711a2))
* **dashboard:** harden taskMatch filtering + review polish ([0787ffa](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0787ffad91ba1d663a0b4f39f0ae00728adb2c4c))
* **docker:** build multi-arch on native runners instead of QEMU ([eb06909](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/eb069095c9de5a170e35dc13625223c923d399de))


### 📘 Documentation

* design spike for de-risking the shared default Sprint (P1-1) ([713cc30](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/713cc3081c0ac21be8b7a09145bd13d50d3fddd1))

## [14.9.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.8.0...v14.9.0) (2026-07-07)


### 🚀 Features

* **dashboard:** add "Is Not" filter operator and fix Free Resources exclusion ([2dc1d88](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2dc1d88183b9084e37abfb237a59da8e280d4b37))
* **dashboard:** export/import dashboard layout via a settings menu ([81016b0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/81016b02a6e64e62ca5c37cebf8d666fd192359e))
* **settings:** auto-close inactive projects (AHE-3798) + admin access to settings cards ([e9c219b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e9c219bc950a19a67fab72492b1afb45dc47c990))
* **timesheet:** per-company opt-in settings for daily time-log reminder ([07a1726](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/07a17260b6f7577aac6e8dba1e174e70c5614f98))


### 🐛 Bug Fixes

* **auto-close:** query projects by createdAt, not the non-existent Created_At ([fc19e66](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fc19e66d597e06e545934e58b641c92f6cccb970))
* **auto-close:** don't swallow activity-check errors ([29629b0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/29629b028792a2e9603ce03d4e183d6f02a34ea6))
* **deploy:** husky prepare must not fail npm ci when .husky is absent ([df758b9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/df758b98ac103d37f9bf95cfa773e3f37e4850ea))
* **estimate:** require a task description before generating an AI estimate ([54e91ac](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/54e91acd3cbf407d2002d309998a84f20653f63d))
* address CodeRabbit review nits (mongoose require + shared ASSIGNEE_FIELD) ([ecb9ef2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ecb9ef231739a6679b8f21ef8a37f8cab5573427))

## [14.8.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.7.0...v14.8.0) (2026-07-03)


### 🚀 Features

* **dashboard:** add Project Progress cards (AHE-3789) ([49b8f5c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/49b8f5cb0ebb4d84e83081b0b0e2069994c00a06))
* **dashboard:** add resource-utilization cards ([9156045](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9156045a5089be347220aabf45c530857df15369))
* **dashboard:** on-leave card, project drill-downs, global date range ([e945234](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e945234e05ba2b545842b511c38204fabc0ff65f))
* **dashboard:** tracker logged columns and on-leave ticket links ([afc32cc](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/afc32cc8ca8ecb48187bf5c3429007bba3863730))
* **settings:** distinct nav icons for security and integration menus ([d50aca7](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d50aca7e9139fd2b67a904b2e91a988bab34db17))


### 🐛 Bug Fixes

* **dashboard:** resolve CodeRabbit PR [#328](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/328) findings ([d8c888a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d8c888a46abc34b5668c81f039f8f71b0e8dd39f))
* force lf line endings on husky hooks via gitattributes ([e7568d1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e7568d15346c09e99be78ad0cd48fad5c29b798d))
* **mail:** harden Nodemailer transport + accurate errors (CodeRabbit [#328](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/328)) ([7d8b44e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7d8b44e75be6bce2022bf6a90d84343e8db91f41))
* rename LiveWorkTableCard to ActiveWorkTableCard to avoid key collision ([4ba6297](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4ba62978a1fe1a733cd024664c4b6f86dde9715d))
* skip husky setup when devDependencies are omitted ([52c184f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/52c184f1e9001ff4356b27ef7b9fe0a511923880))
* use npx to resolve frontend eslint in lint-staged on windows ([fda8faf](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fda8fafa71b100201180f4a89c0783e242c8af1e))


### ♻️ Refactors

* **service:** use nodemailer SMTP transport in service.js ([a34c55b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a34c55b03da9386e251189a25920ffcae9121a5e))

## [14.7.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.6.1...v14.7.0) (2026-07-01)


### 🚀 Features

* **ai-assist:** add Tasks-only and Sprints-only modes to Plan with AI ([a46093b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a46093b77ff223b65c8755f1a08c5a8a21c9a31a))
* **ai-assist:** add AI-generated sub-tasks (Advanced toggle) ([8851f3f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8851f3fc3a3503e26cbd3d6f4f103ec3bc5c0df3))
* **ai-assist:** add task links, epics, and custom fields (Advanced toggles) ([7283a10](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7283a10f1b7758faf75aa5c76ac6bccdc4279326))
* **ai:** add "Add to description" mode to Write with AI ([c87e735](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c87e735224dd44cf4722dfd662558601605036b7))
* **installer:** dynamic first-run setup, no default user ([d4af596](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d4af596620ff991618b687558ffde764f51ea84c))


### 🐛 Bug Fixes

* **installer:** remove License Key step from setup wizard ([4bf0b00](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4bf0b00d8c7124887f45e1e956c2fe3e8fdb11aa))
* **logtime:** show real date in tracked-time activity log (was DATE_undefined) ([bc5cafd](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bc5cafd02d600e5e3964260ba6233769844475be))
* **projects:** align empty-state CTA buttons into a consistent pair ([6fce7b9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/6fce7b904776b89129d2456ac85592505a757e98))
* **task-detail:** accurate subtask progress % for parents with &gt;35 subtasks ([1da89cf](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1da89cf8a74f8ae311093c924ec0333cfcc0d435))

## [14.6.1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.6.0...v14.6.1) (2026-06-27)


### 🐛 Bug Fixes

* release-please auto-tagging and duplicate docker builds ([10920f7](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/10920f7424d58ce0483f0486c3304423c10395d5))

## [14.6.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.5.0...v14.6.0) (2026-06-26)


### 🚀 Features

* AI Assist — plan sprints and tasks with AI for an existing project (AHE-3777) ([20685f3](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/20685f396b08f8f3fa94e995f7e3c851378628e9))
* AI Assist — richer task plans and hide the list-view "Suggest Tasks" link ([0065682](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/00656822db4b3ff589db1e4cebbf12b18a53c4f2))
* Subtask completion-percentage badge on parent tasks (AHE-3776) ([3d4ef75](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3d4ef756f6692083ea75e34f74d34f517cbce508))


### 🐛 Bug Fixes

* AI Assist — show AI-created sprints and tasks live without reload (AHE-3777) ([85e5441](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/85e54413fb4b898d6ef7fc3028bf012a825ddba9))
* Email — send via AWS SES instead of SMTP/Resend (BUG-041) ([0dac7db](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0dac7db0983c21b3ca9fdbbf73be4e589b4e93f1))
* Projects — force-hide the list-view "Suggest Tasks" CTA in production ([b29d6b6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b29d6b6ee755de012a15aab33574fe5146b37496))
* Projects — keep the filter toolbar on a single line (AHE-3783) ([59c13c4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/59c13c4e790ba5c5726b5b28dfb6c6961670da45))
* Projects — filter actions were hidden on sub-desktop widths (AHE-3783) ([8c0a9a0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8c0a9a0fb4f4607699c85e7302212ddd136a5f63))
* Projects — make project view-tabs responsive and readable ([7e87e1b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7e87e1b3d5111afb0cce51bddb49d9bd9530bddf))
* Notes — resolve notes by authenticated user + modern Notepad UI ([a17024b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a17024b572bbaa335f62840b57c27699c117f703))
* RBAC — remove SEC-01 guest-role scoping that broke dynamic roles ([3ad3b9a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3ad3b9a8a71733b4012c8dcb6239c25b5a76a61a))
* Timesheet — tidy the User Timesheet header toolbar layout ([fa250ba](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fa250ba42ee3cf7b7a643db84ba11b8ffc43c43c))

## [14.5.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.4.0...v14.5.0) (2026-06-23)


### 🚀 Features

* admin, security & access module (SEC-01..08, v14.5.0) ([e499150](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e4991500f3e19c1d2f038da083717b7840ef7ece))
* **ai:** dedicated "Write with AI" for descriptions (generate/clarify/preview) ([1c359ba](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1c359ba1bf55f202e7773e054db41e90e0221133))
* **ai:** dedicated "Write with AI" for task/project descriptions ([2c0a2c6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/2c0a2c62000cb7d0b65962e3b376d9ec66e528d2))
* **audit:** audit log viewer in Settings (SEC-04 frontend) ([e845d25](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e845d257999561b3ca405d48273b12c71e72d1df))
* **audit:** tamper-evident audit logs with retention (SEC-04) ([20ac6d1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/20ac6d151422da89cd7ae025b998ce4bbc7f2b19))
* **clips:** global multi-purpose clip recorder + my clips library ([5bb7069](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5bb7069dbe2fe55aecbd4782d47f98a7b08f9762))
* **clips:** global multi-purpose clip recorder + My Clips library (COLLAB-04) ([de6003f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/de6003f8c058592dba9f6b8b0e21be009d5c44e7))
* **clips:** minimize-to-background recording + safe close + leave warning ([0cba1e4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0cba1e46f170d03fc1f7ffde982101e74c7ccc90))
* **clips:** record screen/voice clips and attach to a task (COLLAB-04) ([ad051d8](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ad051d86e64e9fdb4fdaf336c6429fd5b9e059da))
* **collab:** reminders + notepad (COLLAB-03, COLLAB-06) ([43ae61f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/43ae61fc540834c41238e5a94f6b1f07406caae7))
* **custom-fields:** formula & rollup custom field types (TASK-01) ([4cc3d53](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4cc3d535d9255721ffa0f1a1b780e6f5188e43ea))
* **custom-fields:** formula & rollup field UI — builder + read-only display (TASK-01) ([1c46c9e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1c46c9e13df51b2a0b5b861cbd9f8351955146bf))
* **custom-fields:** formula/rollup config schema + safe compute engine (TASK-01) ([0e7025d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0e7025d0688612b5a9f50ce9c2a204450afe863c))
* **dashboard:** 3 new dashboard card types (REP-03) ([b7dc6af](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b7dc6afcd85fa7368709ef55f5a70ad5d834ca74))
* **docs-import:** Asana/Monday importers + live task chips in Pages (DOCS-01, DOCS-02) ([ccee738](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ccee738192f93e635d6b6bbc8e8437c492ed2d91))
* **estimate:** ground AI time estimate in historical actuals + calibration ([bc9eba4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bc9eba41200c8547a37e181b67016243a77895b9))
* **estimate:** historical-actuals grounding + calibration for AI time estimate ([e538992](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e538992e248a63d312c3e244528a0e0b97bf7d94))
* **import:** asana + monday.com importers (DOCS-01) ([3f960ba](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3f960ba383e2d90e74d6294ec8fafd7999817f05))
* **integrations:** automation & integrations track (AUTO-01..07) ([1f05d5e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1f05d5ea8602f7c6d40fb434f9e3e209dba44d54))
* **integrations:** automation builder (AUTO-03) ([5fb0689](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5fb0689cff1ed4eff66a803ba2313ef780c42d8a))
* **integrations:** calendar iCal feed (AUTO-02) ([080bcd7](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/080bcd7130caa9db653059420dab82215f0cd34f))
* **integrations:** connections registry + catalog (AUTO-04) ([51a0609](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/51a0609ed3dda70c17d2a5cb6fbfce088d13e0de))
* **integrations:** custom iframe apps (AUTO-07) ([9f737c9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/9f737c931c06ba292a7f900c0a1d431a6b9c799e))
* **integrations:** email-to-task inbound webhook (AUTO-01) ([18a7793](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/18a7793dc5c477f575f4ac6b8b643804905c4bb5))
* **integrations:** integrations hub + email-to-task UI (AUTO-01) ([33bd3df](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/33bd3df1d59b32e31521a47afe2a0c0b5d0073a2))
* **integrations:** integrations marketplace UI (AUTO-05) ([6928b76](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/6928b76c9e12ccb64bbcc9cf045dc2521b36d4bb))
* **integrations:** slack slash-command bot (AUTO-06) ([65588ef](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/65588ef4d495787d649963ca826685127d7d8150))
* **notepad:** personal notes convertible to tasks (COLLAB-06) ([0fd9c0a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0fd9c0a4e8e7dad1180150a6f77fd33d3eb832cc))
* **offline:** work offline + sync on reconnect, app-level (SEC-06) ([685fdeb](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/685fdebd355d8941e774d7744b8d254ce2e93f4c))
* **pages:** live task-status chips in docs (DOCS-02) ([0ba0723](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0ba0723c3204c78e715ca6195898abf08f12c947))
* **portfolio:** cross-project portfolio rollup (REP-01) ([3e24cc2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3e24cc293bda3de01e73f760113da6d448f3f764))
* **projects:** "Move to folder" for sprints (non-drag) + live re-group ([46702fc](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/46702fc6222ccf50c944b60b22bfcf1b50e22216))
* **projects:** "move to folder" from sprint menus + live re-group ([16b3559](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/16b35598a17ca4881a6e2c51758778e5fc22691a))
* **pto:** time-off / PTO with capacity reduction (SEC-08) ([898f1c0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/898f1c060917175c8382775b02f03a572f3c4724))
* **pwa:** installable PWA — manifest + service worker (SEC-03) ([7c58e26](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7c58e26bc74884c70de13cb6872531b2047cb60e))
* **rbac:** guard task detail + per-project task data for guests (SEC-01) ([5098ca8](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5098ca8ddc4611b54912b987a7f0232f06c09636))
* **rbac:** guest role foundation + project-scope guards (SEC-01) ([8f686fb](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8f686fbc9968667f1767b6d6cb60d63b4d9d3086))
* **rbac:** scope projects to assigned set for guests (SEC-01) ([bf9b3b5](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bf9b3b5764c685ded85691d2c469077a9d1bd319))
* **rbac:** scope task-query + comment endpoints for guests (SEC-01) ([55c4f9a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/55c4f9a3b95c96fa83fe8695775810b624ec4d48))
* **reminders:** personal task reminders that fire on schedule (COLLAB-03) ([16037ab](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/16037ab2a60ae012b97fa2f0a40a0a3ebea4f295))
* reports & dashboards module — part 1 (REP-01..04) ([50dc21f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/50dc21f465ea4970224257113ba6e868b35249c1))
* **reports:** add capacity planning / resource leveling report (REP-06) ([54e014a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/54e014ad5f22476958d83127b588486e32bb1eca))
* **reports:** add reusable report templates + duplicate (REP-07) ([3499bd9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3499bd9c5216d3b4aa5e0c742989f33224ce44aa))
* **reports:** add scheduled / emailed reports (REP-08) ([f84cd80](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f84cd804a3f9d533f93eaf3c60ef7915a0900eab))
* **reports:** custom report builder (REP-02) ([bc885ab](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/bc885aba644b85070734e7ab338a5a6169ffc52a))
* **reports:** estimate-vs-actual variance report (REP-04) ([7878379](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7878379e66a53b3a06768b7f637404b146b2ea46))
* **reports:** export reports to CSV and Excel (REP-05) ([48c8bed](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/48c8bedb6c9d99ab6a7299c866d3b05649cf1f68))
* **reports:** reports & dashboards parity part 2 (REP-05..09) ([e82f42d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e82f42dc5055f01993ca70c60c78e4d272a0ca63))
* **reports:** share a saved report via public link (REP-09) ([a8562a9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a8562a9d0aa5dd0f48c8563044e10236ad85b502))
* **scim:** user provisioning via SCIM 2.0, paired with SSO (SEC-05) ([de1b2dc](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/de1b2dc41b3f524ac28c29a12e56d5d404d2077c))
* **sso:** admin SSO config UI + settings page (SEC-02) ([634b0a2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/634b0a2e0930e912ea5418d3ee47c206ed79b768))
* **sso:** enterprise SSO backend with SAML and OIDC (SEC-02) ([3b6024a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3b6024a83062b318627a2e456beb6563b8433cd0))
* **timesheet:** add timesheet approval UI + test cases (TIME-01) ([a1c84d3](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a1c84d3da928e90a632a7bb1412f3673d10a9de7))
* **timesheet:** add timesheet approval workflow API (TIME-01) ([a8185dd](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a8185dd4a5a42dddd2ad5a266c594ab3c7228efc))
* **timesheet:** billable flag on time entries + summary API (TIME-02) ([db08f1a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/db08f1a0fbdf0f870e36805f91b9a8b20bce4b61))
* **timesheet:** billable toggle + summary readout (TIME-02) ([1914f21](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1914f21b41052ac23c5f35ab3a7850c9f54e90e8))
* **timesheet:** billing rates + invoice generation (TIME-07) ([f3a7cb9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f3a7cb9a294955d915507a019dad4e1e8e7c1c6e))
* **timesheet:** daily time-entry reminders (TIME-06) ([80b3ec1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/80b3ec1a523009425721514ae177bc03862ceb42))
* **timesheet:** lock time entries in approved periods (TIME-03) ([496bd17](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/496bd17c52e4ba53196a98c3381209bae3767be6))
* **timesheet:** payroll CSV export (TIME-04) ([e13b340](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/e13b340184d90404a01ae87cd9266d69d672edc7))
* **timesheet:** v14.5.0 Time & Timesheets module (TIME-01..07) ([ef76a11](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/ef76a11fcad1c3ed48497f90302055e362b03226))
* **tracker:** idle-time detection auto-pause (TIME-05) ([80a383b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/80a383bd78b95ad97b3a9e3820273d84c9004890))
* **views:** canvas / dynamic-layout project view (VIEW-04) ([7f8deeb](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7f8deeb2343e2cb0002d310551efed05eb7ee7f0))
* **views:** mind map project view (VIEW-02) ([cf0512b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/cf0512b4071566338cf24bc9899797d302027c31))
* **views:** offline SVG map project view (VIEW-05) ([d68a100](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d68a10064ed3eb1062b41f36b79361aea327d254))
* **views:** project views & canvas — timeline, mind map, whiteboard, canvas, map ([10c5da9](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/10c5da9ffd49d64df4886434b0f08fff7a2a5e9e))
* **views:** timeline project view (VIEW-01) ([96ddb4d](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/96ddb4dec280fd36a22c122f2939eb973a909ee4))
* **views:** unique tab icons for Mind Map, Whiteboard, Canvas, Map ([22107cd](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/22107cd29ed83ccc2b5a42420085bba76cf427b7))
* **views:** whiteboard project view (VIEW-03) ([65e0af3](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/65e0af3603ffd99b8a171a87aa3d5fa994151342))


### 🐛 Bug Fixes

* **clips:** copy link resolves a real url (wasabi stored an uncopyable key) ([15f5eb1](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/15f5eb1f0fcf14f273beed0432eb7f406ea47a82))
* **clips:** dark text in recorder + my-clips panel (was inheriting header white) ([d54ac7e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d54ac7edb5925baff97af7e596b533dcedc2c6e8))
* **clips:** disable save button visually + cap recording bitrate ([83e171c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/83e171c21bc95876f40b86c860e9bfce04b064cc))
* **clips:** resolve userId on create/list (staging blocker) + wasabi/font fixes ([b2e63da](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b2e63dadef9004d6f852bd0622fdb6433eec7149))
* **clips:** send userId so create + list resolve the user ([b224a08](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b224a0826e493d47e6b03e6fa02a5cdb12a1c276))
* **clips:** small record-clip toolbar icon (was rendering full-size) ([5719dcb](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5719dcb995a08f4da8f0125bddfd7c1a37416d03))
* **custom-fields:** matching tile icons for formula & rollup types ([f5bc398](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f5bc398a48cccd5f50c24db5b2929ebe093febce))
* **custom-fields:** rollup reads subtasks from the populated store source ([04dbb11](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/04dbb11a7f628c37f5fb78da94bd3f75c02dfd98))
* **deps:** make samlify xsd validator optional so deploy npm ci survives ([86057da](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/86057da29419c6347bc30e31a59298071d00cfbd))
* **deps:** make samlify xsd validator optional so deploy npm ci survives ([798c553](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/798c553d2ea0be67ffb12b2fb0e40f840c69e4a7))
* **integrations:** give Slack a live hub section (was "coming soon") ([046abe2](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/046abe234e6903ba863098bd61488ee58f941eba))
* **integrations:** give Slack a live hub section (was coming-soon) ([b789976](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b789976edb2ec9e1e66b8fb3585557aa23aa3db3))
* **notepad:** white header icon matching the other header icons ([017fb2f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/017fb2f599804361dead940c03e57a1e9ff906cb))
* **projects:** cascade folder to a sprint's tasks on move (breadcrumb/routes) ([6504e15](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/6504e154977be8f7c3d17baf4c118792b9937c80))
* **pwa:** stop reload loop — withdraw the SEC-03 service worker ([780f16e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/780f16e8122aeeef34e3670c29c778cf4564daeb))
* **reports:** hide closed/deleted/archived projects from module pickers ([00e67be](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/00e67be6d83001470a49361c45152968a2dc826c))
* **reports:** hide closed/deleted/archived projects from module pickers ([3edae54](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3edae54acb1d69d01d4f2fdc2581f258ef808c5f))
* **sso:** use a published samlify schema validator ([f4c480f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/f4c480f092b02c608483564e8c8afecf98708480))
* **timesheet:** compute approval-period totals in seconds (TIME-01) ([3b442f6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3b442f6f33579b45a1c4322ff0152a6dad01eac6))
* **views:** de-dupe "+ View" catalog by view label ([21525e0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/21525e0b4e2e404ced8ae42002dcd2db4a80f862))
* **views:** drop "View" suffix from view tab labels ([92c0c8e](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/92c0c8e39e85162fe19f976e0b8adcdbb939266b))
* **views:** resolve "+ View" catalog labels for the new project views ([dfd03fd](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/dfd03fda396aa7480b4f056ba8a3bfe413824547))
* **views:** seed missing Reports/Gantt/Recurring views in project-tab catalog ([1fd76a3](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/1fd76a36e09844a8386edd0f5cddef3f721334c7))
* **views:** stop "+ View" crash on unknown catalog keyName ([4dae224](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4dae224da4572849d5e9f0228160c1d34a20b4d5))


### ♻️ Refactors

* **frontend:** group navbar menus under Reports and Workspace ([830c1fe](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/830c1fe2eceaa8bfbd4a2f94930542a7209d767d))
* **frontend:** group navbar menus under Reports and Workspace ([039b5d4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/039b5d4a2c637b1678a99d6da83795a4a8757d43))


### 📘 Documentation

* **branching:** merge-commit promotions so release-please auto-cuts releases ([18bb4be](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/18bb4bea463bc2833613627c0cadf89c619d546b))
* **branching:** promote with a merge commit so release-please auto-cuts ([d813073](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/d813073bb940894b28a359e4bf5e601fd371fe24))
* **compliance:** posture pack for SOC 2 / ISO 27001 / HIPAA (SEC-07) ([759bd24](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/759bd240ecb297fa71dd73e58a5523499f761977))
* **compliance:** review checklist for the SEC-07 posture pack ([986efb5](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/986efb500952b93579a3681ce456be968d258142))
* **views:** regression test cases for the +View icon-fallback fix ([c6d0ef5](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/c6d0ef54fab27e877a33f1b5d6e9834029ea458a))

## [14.4.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.3.0...v14.4.0) (2026-06-19)


### 🚀 Features

* **agile:** Sprint 2 — integrations: webhooks UI, CSV/Trello importers, action-aware notifications ([#252](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/252))
* **agile:** Sprint 3 — story points + estimation scale, Trello rich import, @mention notifications ([#253](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/253))
* **reports:** Sprint 4 — agile reports: burndown, velocity, CFD + branded PDF export ([#255](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/255))
* **gantt:** Sprint 5 — Gantt / timeline view + recurring tasks ([#256](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/256))
* **public-share:** harden public read-only links — expiry, password, hard-revoke, rate-limit ([#258](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/258))
* **tasks, epics:** blocked-task warning + epic dates / owner / priority / progress ([#259](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/259))


### 🐛 Bug Fixes

* **tracker:** detect keyboard vs mouse via cursor movement; powerMonitor idle activity ([#254](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/254))
* **gantt:** render tasks when the Gantt tab is the reload entry point ([#257](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/257))


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
