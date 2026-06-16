# Languages (Japanese / Korean / Brazilian Portuguese) — Test Cases

**Location:** Settings → My Settings → Language · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Language Switching

| ID     | Title                                     | Precondition          | Steps                                                                   | Expected Result                                                                                    | Actual Result | Status |
|--------|-------------------------------------------|-----------------------|-------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|---------------|--------|
| LG_001 | Switch to Japanese                        | Logged in             | 1. Open Settings → My Settings  2. Select Japanese  3. Save            | Success toast; navigation and common labels switch to Japanese immediately, no reload needed       |               | ⏳     |
| LG_002 | Switch to Korean and Brazilian Portuguese | Logged in             | 1. Repeat LG_001 choosing Korean, then Português (Brasil)               | Same behavior for both locales                                                                     |               | ⏳     |
| LG_003 | Untranslated strings fall back to English | One new locale active | 1. Browse less common screens (e.g. the `...` menu features, settings) | Untranslated strings show English text — never blank, never a raw key like `Projects.more_features` |               | ⏳     |
| LG_004 | Choice persists across sessions           | LG_001 done           | 1. Log out and back in (or hard-reload)                                 | UI comes back in the chosen language                                                               |               | ⏳     |
| LG_005 | Switch back to English                    | A new locale active   | 1. Set the language back to English                                     | Everything returns to English cleanly                                                              |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
