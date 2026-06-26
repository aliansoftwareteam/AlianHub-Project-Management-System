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

## [14.6.0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/compare/v14.5.0...v14.6.0) (2026-06-26)


### 🚀 Features

* AI Assist — plan a project (sprints + tasks) with AI (AHE-3777) ([20685f3](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/20685f396b08f8f3fa94e995f7e3c851378628e9))
* **ai-assist:** richer task plans and hide list-view suggest-tasks link ([0065682](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/00656822db4b3ff589db1e4cebbf12b18a53c4f2))
* plan sprints and tasks with AI for an existing project (AHE-3777) ([4cc6415](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4cc64155c962f0c41bd1fed458d78d610a229011))
* show subtask completion percentage badge on parent tasks (AHE-3776) ([8c2a3f6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8c2a3f6d34a34afddd0f6bbc03bc48e2a92486a8))
* show subtask completion percentage badge on parent tasks (AHE-3776) ([3d4ef75](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3d4ef756f6692083ea75e34f74d34f517cbce508))


### 🐛 Bug Fixes

* **ai-assist:** show AI-created sprints and tasks live without reload ([85e5441](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/85e54413fb4b898d6ef7fc3028bf012a825ddba9))
* **email:** send via AWS SES instead of SMTP/Resend (BUG-041) ([0dac7db](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/0dac7db0983c21b3ca9fdbbf73be4e589b4e93f1))
* force-hide list-view Suggest Tasks CTA in production ([07ba4f8](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/07ba4f8763f036e75960820bb31f5c70c94c8751))
* keep list-view filter toolbar on a single line (AHE-3783) ([cbfaf45](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/cbfaf45da4f64b001288d9b610bdde86c5575118))
* list-view filter actions hidden on sub-desktop widths (AHE-3783) ([171382f](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/171382fcbb56ade69b0d3ed8dba9e2c3c4d746f2))
* **notes:** resolve notes by authenticated user + modern Notepad UI ([5c02d4c](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/5c02d4c5950a2ac8205e6ddbcfe056aa4ebd706e))
* **notes:** resolve notes by authenticated user + modern Notepad UI ([a17024b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/a17024b572bbaa335f62840b57c27699c117f703))
* **projects:** force-hide list-view Suggest Tasks CTA in production ([b29d6b6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/b29d6b6ee755de012a15aab33574fe5146b37496))
* **projects:** keep list-view filter toolbar on a single line ([59c13c4](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/59c13c4e790ba5c5726b5b28dfb6c6961670da45))
* **projects:** list-view filter actions hidden on sub-desktop widths ([8c0a9a0](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/8c0a9a0fb4f4607699c85e7302212ddd136a5f63))
* **projects:** make project view-tabs responsive and readable ([23936ac](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/23936aca9da995a0b7cd9ac382e1d46e43900d24))
* **projects:** make project view-tabs responsive and readable ([7e87e1b](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/7e87e1b3d5111afb0cce51bddb49d9bd9530bddf))
* **rbac:** remove SEC-01 guest-role scoping that broke dynamic roles ([3846541](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3846541ddc1254e331099c3a068d611ee3e501e7))
* **rbac:** remove SEC-01 guest-role scoping that broke dynamic roles ([3ad3b9a](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/3ad3b9a8a71733b4012c8dcb6239c25b5a76a61a))
* send email via AWS SES instead of SMTP/Resend (BUG-041) ([4f08749](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/4f087498c8a966ea60d68577ca4d8fa816cf8d37))
* show AI-created sprints and tasks live without reload (AHE-3777) ([dc536d6](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/dc536d6ddf1d3a7e73c979321cc5f8ecd8737536))
* **timesheet:** tidy the User Timesheet header toolbar layout ([39db515](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/39db51544988bbb2203f9f14fb8c0f431ffc9357))
* **timesheet:** tidy the User Timesheet header toolbar layout ([fa250ba](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commit/fa250ba42ee3cf7b7a643db84ba11b8ffc43c43c))

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
