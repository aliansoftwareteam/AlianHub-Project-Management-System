# Sign-in: OAuth, SSO and SCIM

How people sign in to your instance, and how an identity provider can manage members. Everyone can always sign in with email and password. On top of that you can add social sign-in (Google, GitHub, GitLab) for the whole instance, single sign-on (SAML or OIDC) and SCIM provisioning per workspace, and two-factor authentication per person.

| Method | Set by | Where |
|---|---|---|
| Email and password | always on | |
| Sign-in link by email (magic link) | instance owner | **Settings › Instance › Settings › Sign-in** |
| Google, GitHub, GitLab | instance owner | **Settings › Instance › Settings › Sign-in** |
| SAML or OIDC single sign-on | each workspace's owner or admin | **Settings › Sign-in & SSO** |
| SCIM provisioning | each workspace's owner or admin | **Settings › SCIM** |
| Two-factor authentication | each person | their own account settings |

## Google, GitHub and GitLab

Each provider has an enable switch, a client id and a client secret under **Settings › Instance › Settings › Sign-in**. The login page asks `GET /api/v2/instance/public-config` which buttons to show, so turning one on needs no rebuild.

| Provider | Keys | Create the client at |
|---|---|---|
| Google | `GOOGLE_LOGIN_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud console › APIs & Services › Credentials › OAuth client ID (type **Web application**) |
| GitHub | `GITHUB_LOGIN_ENABLED`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_BASE_OAUTH_URL` | GitHub › Settings › Developer settings › OAuth Apps |
| GitLab | `GITLAB_LOGIN_ENABLED`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `GITLAB_BASE_OAUTH_URL`, `GITLAB_BASE_API_URL` | GitLab › Preferences › Applications, with the `read_user` scope |

Steps:

1. Make sure `WEBURL` is your public `https://` address.
2. Create the OAuth client at the provider:
   - **Google** signs in through a popup: add your `WEBURL` (for example `https://pm.example.com`) under **Authorized JavaScript origins**.
   - **GitHub** and **GitLab** send the browser back to the app: set the callback (redirect) URL to your `WEBURL`.
3. Paste the client id and secret into the Sign-in group, switch the provider on, and **Save**.
4. Open the login page in a private window and try the new button.

For GitHub Enterprise Server change `GITHUB_BASE_OAUTH_URL` (default `https://github.com/login/oauth`). For a self-managed GitLab change both `GITLAB_BASE_OAUTH_URL` (default `https://gitlab.com/oauth`) and `GITLAB_BASE_API_URL` (default `https://gitlab.com/api/v4`).

The redirect the app sends to GitHub and GitLab is the origin of the page the person is on, so it matches only when people open the instance at `WEBURL`. GitHub asks for the `read:user user:email` scopes and GitLab for `read_user`. The same buttons on the sign-up and invitation pages create the account.

## Sign-in links

**Sign in with an emailed link** (`MAGIC_LINK_ENABLED`, on by default) lets people request a one-time sign-in link instead of typing a password. It needs working [mail](./mail). Turn it off with `MAGIC_LINK_ENABLED=false`.

## Single sign-on (SAML or OIDC)

SSO is set per workspace, by its owner or an admin, under **Settings › Sign-in & SSO**. It works with an identity provider that speaks SAML 2.0 or OpenID Connect, such as Okta, Microsoft Entra ID or Google Workspace.

1. Switch on **Enable single sign-on** and pick the **Provider** type: OIDC or SAML. Give it a **Display name** (such as "Okta"), shown on the login page.
2. Copy the values the page shows into your identity provider:

   | Type | Values to register at the identity provider |
   |---|---|
   | OIDC | **Callback URL**: `https://pm.example.com/api/v2/sso/oidc/callback` |
   | SAML | **ACS URL** `https://pm.example.com/api/v2/sso/saml/acs?companyId=<id>`, **Entity ID** and **Metadata URL** `https://pm.example.com/api/v2/sso/saml/metadata?companyId=<id>` |

3. Fill in what the identity provider gives you: for OIDC the discovery URL, client id, client secret and scopes; for SAML the entry point (SSO URL), its entity ID and its signing certificate.
4. Add the **Email domains** your people use (such as `example.com`) and verify each one: publish the TXT record the page shows (name `_alianhub-sso.<domain>`, value `alianhub-sso-verification=<token>`) at your DNS provider, then press **Verify**.
5. Choose **Enforcement**:
   - **Optional**: SSO is one more button on the login screen.
   - **Required, except guests**: members and admins must use SSO; guests keep email or Google.
   - **Required for everyone**: every sign-in goes through your identity provider.

   Members who never signed in with SSO are asked to link their account on their next login. The owner keeps a password fallback so the workspace cannot be locked out.
6. Under **Provisioning**, decide whether people from a verified domain who sign in through SSO without an invitation get an account automatically, and with which **Role for new people**.
7. **Save**, then press **Test sign-in**.

Good to know:

- Company sign-in adds people only from verified domains. The TXT record is checked daily; after three missed checks in a row the domain stops counting as verified until you verify it again. Keep the record published.
- The **Continue with SSO** button on the login page appears once any workspace has an enabled connection with a verified domain (checked at most once a minute, and again whenever a connection is saved or a domain verified). `SSO_LOGIN_ENABLED=false` hides it regardless.
- The identity provider's client secret and certificate are visible only to the workspace's owners and admins.

## SCIM provisioning

SCIM 2.0 lets your identity provider create, update and deactivate members automatically, so someone who leaves loses access as soon as they are removed there. It is set per workspace under **Settings › SCIM**, by an owner or admin.

1. Switch SCIM on and pick the **Default role for provisioned users** (Admin, Member or Guest).
2. Press **Generate token** and copy it straight away; it is shown once and stored only as a hash. **Regenerate token** replaces it.
3. In your identity provider's SCIM (user sync) settings, enter:
   - **SCIM base URL**: `https://pm.example.com/scim/v2`
   - **Access token**: the token, sent as a Bearer token.

Supported: `Users` (list, get, create, replace, patch, delete) plus `ServiceProviderConfig`, `ResourceTypes` and `Schemas`. Setting a user inactive or deleting them turns the member off in the workspace. Groups are not supported. Every SCIM change is recorded in the workspace audit log ("Member sync added a person", and so on).

## Two-factor authentication

Each person can turn on two-factor authentication in their own account settings with any authenticator app (Google Authenticator, Authy, 1Password and others). They get recovery codes to keep; each works once. At sign-in with a password, they then enter the 6-digit code or a recovery code.

| Key | Purpose |
|---|---|
| `TWO_FACTOR_ISSUER` | Name shown in authenticator apps (default `AlianHub`); **Name in authenticator apps** in the Sign-in group |
| `TWO_FACTOR_ENC_KEY` | Key that encrypts the stored authenticator secrets. Set a long random value. |
| `TWO_FACTOR_TEMP_SECRET` | Signs the short-lived token between the password and the code; defaults to one derived from `JWT_SECRET` |

There is no switch that forces two-factor authentication on every member. To require it, use SSO with **Required for everyone** and enforce MFA in your identity provider.

## Sign-in protection

| Key | Default | Meaning |
|---|---|---|
| `AUTH_RATE_LIMIT_MAX_ATTEMPTS` | `5` | failed logins allowed per window, per IP |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | window over which failures are counted |
| `AUTH_RATE_LIMIT_BLOCK_MS` | `1800000` (30 min) | how long an IP stays blocked afterwards |
| `SESSIONEXPIREDTIME` | `172800` | idle time after which a login session expires |
| `JWT_EXP` | `24h` | access token lifetime |

Passwords must be 8 to 256 characters with an uppercase letter, a lowercase letter, a number and a symbol, and are stored as bcrypt hashes. See [Security](./security).

## Related

- [The Instance console](./instance-console)
- [Security](./security)
- [People and roles](/user-guide/people-and-roles)
