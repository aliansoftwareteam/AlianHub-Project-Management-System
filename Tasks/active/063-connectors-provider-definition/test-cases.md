# 063 test cases: provider definition, registry, Google provider

Run 2026-10-30 on `feat/connectors-provider-registry` after the review fixes (section H). 45 of 46 cases pass; B-01 is not run.

Two kinds of case:
- **Auto**: covered by Jest. Run `node node_modules/jest/bin/jest.js --selectProjects unit --runTestsByPath tests/connector-registry.test.js --no-watchman`. Through `npx jest` on Windows the run can hang on watchman.
- **Manual**: run by hand in a `node -e` shell from the repo root. Each step gives the command.

Write the result in the **Result** column: `pass`, `fail` (with what happened), or `blocked`.

## Setup

1. Root `.env` exists (`cp .env.example .env`).
2. For the manual cases, set env values in the same shell before `node -e`. PowerShell: `$env:CONNECTORS="google"`. Bash: `CONNECTORS=google node -e "..."`.
3. Clear them after: `Remove-Item Env:CONNECTORS, Env:CONNECTOR_GOOGLE_CLIENT_ID, Env:CONNECTOR_GOOGLE_CLIENT_SECRET -ErrorAction SilentlyContinue`.

## A. Registry loads providers

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| R-01 | Manual | Google provider loads | `node -e "console.log(require('./Modules/Connectors/registry').list().map(d=>d.id))"` | `[ 'google' ]`, no error log | pass |
| R-02 | Manual | Get by id | `node -e "const r=require('./Modules/Connectors/registry');console.log(r.get('google').name, r.get('nope'))"` | `Google null` | pass |
| R-03 | Auto | A fake provider added as one file appears with no other change | Jest, fixture `tests/fixtures/connectors/fake/index.js` | Fake provider is in `list()` | pass |
| R-04 | Manual | A provider whose `id` does not match its folder is skipped | Copy `providers/google` to `providers/google2`, run R-01, then delete `google2` | `google2` not listed; error log `id google does not match its folder google2` | pass |
| R-05 | Manual | A provider file that throws on load is skipped, others still load | Make a folder `providers/broken/index.js` with `throw new Error('x')`, run R-01, then delete it | Only `google` listed; error log `provider broken skipped: its file failed to load` | pass |
| R-06 | Auto + Manual | Definitions are frozen, nested objects too | `node -e "const g=require('./Modules/Connectors/registry').get('google');g.name='X';g.products.drive.push('x');console.log(g.name)"` | `g.name` stays `Google`; the `push` throws `TypeError` | pass |

## B. When a provider is offered (FR-2)

| ID | Kind | Case | Env | Expected `isOffered('google')` | Result |
|---|---|---|---|---|---|
| O-01 | Auto + Manual | Not named in `CONNECTORS` | `CONNECTORS` empty, client id and secret set | `false` | pass |
| O-02 | Auto + Manual | Named, no OAuth app anywhere | `CONNECTORS=google`, no client env | `false` | pass |
| O-03 | Manual | Named, instance app has only the id | `CONNECTORS=google`, `CONNECTOR_GOOGLE_CLIENT_ID=x`, no secret | `false` | pass |
| O-04 | Auto + Manual | Named, instance app set | `CONNECTORS=google`, id and secret set | `true` | pass |
| O-05 | Auto + Manual | Named, company app only | `CONNECTORS=google`, no client env, `isOffered('google', { companyApps: ['google'] })` | `true` | pass |
| O-06 | Manual | `CONNECTORS=off` | `CONNECTORS=off`, id and secret set | `false` | pass |
| O-07 | Manual | Case and spacing in `CONNECTORS` | `CONNECTORS=" Slack , GOOGLE "`, id and secret set | `true` | pass |
| O-08 | Manual | Unknown provider id | `isOffered('dropbox')` with everything set | `false` | pass |

Command for this table (set the env first):

```
node -e "const r=require('./Modules/Connectors/registry');console.log(r.isOffered('google'), r.offered().map(d=>d.id))"
```

## C. Scopes per ticked product (FR-3)

| ID | Kind | Case | Call | Expected | Result |
|---|---|---|---|---|---|
| S-01 | Auto | No product ticked | `scopesFor('google', [])` | `['openid','email']` only | pass |
| S-02 | Auto | Calendar only | `scopesFor('google', ['calendar'])` | base scopes + the 3 calendar scopes | pass |
| S-03 | Auto | Calendar + Drive | `scopesFor('google', ['calendar','drive'])` | base + calendar + `drive.file`, no Meet scope | pass |
| S-04 | Manual | Same product twice | `scopesFor('google', ['drive','drive'])` | `drive.file` appears once | pass |
| S-05 | Auto | Unknown product | `scopesFor('google', ['gmail'])` | Throws `google has no product gmail` | pass |
| S-06 | Manual | Unknown provider | `scopesFor('nope', [])` | Throws `unknown connector provider nope` | pass |
| S-07 | Manual | No Gmail and no restricted Drive scope anywhere | Read `providers/google/index.js` | No `gmail.*`, no `drive` or `drive.readonly`, only `drive.file` | pass |
| S-08 | Auto | Products not a list | `scopesFor('google', 'drive')` | Throws `products for google must be a list of product names` | pass |

## D. Definition validation (FR-1)

Run each with `node -e "const {validate}=require('./Modules/Connectors/validate');console.log(validate(<object>))"`, starting from a copy of the Google definition and changing one thing.

| ID | Case | Change | Expected problem | Result |
|---|---|---|---|---|
| V-01 | Valid Google file | none | `[]` | pass |
| V-02 | Not an object | `validate(null)` | `the file does not export an object` | pass |
| V-03 | Bad id | `id: 'Google-1'` | `id must be lower-case letters, digits and _` | pass |
| V-04 | Missing name | `name: ''` | `name is missing` | pass |
| V-05 | http URL | `auth.tokenUrl: 'http://oauth2.googleapis.com/token'` | `auth.tokenUrl is not an https URL` | pass |
| V-06 | Host not in egress | `egressHosts` without `oauth2.googleapis.com` | `auth.tokenUrl host oauth2.googleapis.com is not in egressHosts` (and the same for `revokeUrl`) | pass |
| V-07 | No revoke URL is allowed | delete `auth.revokeUrl` | `[]` | pass |
| V-08 | Wrong PKCE | `auth.pkce: 'plain'` | `auth.pkce must be S256 or empty` | pass |
| V-09 | Credentials in the file | `auth.clientSecret: 'x'` | `auth.clientSecret must not be in the definition` | pass |
| V-10 | Empty products | `products: {}` | `products is empty` | pass |
| V-11 | Product with no scope | `products: { drive: [] }` | `product drive needs a lower-case name and at least one scope` | pass |
| V-12 | No `readAccount` | delete `readAccount` | `readAccount is not a function` | pass |
| V-13 | Bad rate limit | `rateLimit: { statuses: ['429'] }` | `rateLimit.statuses must be a list of HTTP statuses` | pass |
| V-14 | Several problems at once | V-03 + V-04 + V-12 together | All three listed in one array | pass |

## E. `resolveConnection` stub (contract section 5)

All four are also in Jest (`resolveConnection, until 066`).

| ID | Case | Call | Expected | Result |
|---|---|---|---|---|
| C-01 | Missing ids | `resolveConnection({ provider: 'google' })` | `TypeError: resolveConnection needs companyId and userId` | pass |
| C-02 | Unknown provider | `resolveConnection({ companyId: 'c', userId: 'u', provider: 'nope' })` | `ConnectorError`, `code` `provider_off` | pass |
| C-03 | Known provider, `CONNECTORS=google`, nobody connected yet | same with `provider: 'google'` | `ConnectorError`, `code` `not_connected` (066 replaces this body) | pass |
| C-04 | Known provider not named in `CONNECTORS` | `CONNECTORS=slack`, `provider: 'google'` | `ConnectorError`, `code` `provider_off` | pass |

Command: `node -e "require('./Modules/Connectors/resolveConnection').resolveConnection({companyId:'c',userId:'u',provider:'google'}).catch(e=>console.log(e.name,e.code))"`

## F. Google provider file

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| G-01 | `readAccount` reads the id token (also in Jest) | Call `readAccount({ tokenResponse: { id_token } })` with a test id token whose payload has `sub` and `email` | `{ id: <sub>, label: <email> }` | pass |
| G-02 | Offline refresh asked for | Read `auth.extraParams` | `access_type: 'offline'` | pass |
| G-03 | Dead grant | Read `deadGrantErrors` | `['invalid_grant']` | pass |
| G-04 | No `id_token`, or one without `sub` (also in Jest) | `readAccount({ tokenResponse: {} })` | Throws `google token response has no id_token subject` | pass |

## G. Boot log

| ID | Case | Steps | Expected | Result |
|---|---|---|---|---|
| B-01 | Server starts with `CONNECTORS=google` | Set `CONNECTORS=google` in `.env`, `npm run nodemon`, read the log | No crash. `CONNECTORS names google, which this server does not have` is expected until 073 (contract, open point 2) | not run: the test machine could not reach MongoDB |
| B-02 | Contract file present | Open `resources/contract.md` | Signed by both tracks; covers definition shape, the three collections and `resolveConnection` | pass |

## H. Review fixes made during this testing

| Finding | Risk | Fix | Covered by |
|---|---|---|---|
| The registry froze only the top level of a definition | One caller pushing onto `products.calendar` or `auth.baseScopes` would change the scopes asked for every later request, since every request shares the definition | `registry.js` freezes the whole definition | R-06, Jest `cannot be widened by changing the shared definition` |
| `resolveConnection` said `not_connected` for a provider that is defined but not switched on | Contract section 5 says `provider_off` means "not offered here"; the person would be told to connect on a page that does not offer the provider | `provider_off` also when `CONNECTORS` does not name the provider. The app check waits for 065's company app lookup | C-04, Jest `refuses a provider CONNECTORS does not name` |
| Google `readAccount` returned `{ id: '' }` when the token response had no `id_token` or no `sub` | Every such connection would be stored with account id `''`, and the unique index would treat different accounts as one | Throws instead, so the connect fails | G-04, Jest `refuses a Google token response without an account id` |
| `scopesFor` with a string instead of a list | Failed with `products.filter is not a function` | Clear `TypeError` | S-08, Jest `refuse products that are not a list` |
| `Config/config.js` read `require.main.filename` | Every `node -e` command in this file failed: the Google provider did not load and the registry was empty | Falls back to the working folder when there is no main module | R-01 |

Not changed, for the owner to decide: `validate.js` accepts any key in `auth.extraParams`, so a definition could set `redirect_uri`, `scope` or `state`. Refusing those keys is a contract change and needs track B's agreement.
