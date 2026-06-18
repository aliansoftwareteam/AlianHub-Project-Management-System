# Reports PDF Export — Test Cases

**Location:** Project → `+ View` → Reports → (any chart) → Export PDF · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Export

| ID      | Title                          | Precondition                                          | Steps                                      | Expected Result                                                                  | Actual Result | Status |
|---------|--------------------------------|-------------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| PDF_001 | Export burndown to PDF         | `pdfmake` installed server-side; Reports → Burndown rendered | 1. Click **Export PDF** on the burndown chart | A branded PDF downloads containing the chart image + a data table matching the report |               | ⏳     |
| PDF_002 | Export velocity / CFD to PDF   | Velocity or CFD chart rendered                        | 1. Click **Export PDF** on the chart       | PDF downloads with that chart image + its data table                             |               | ⏳     |
| PDF_003 | Missing pdfmake degrades safely | Server where `pdfmake` is NOT installed              | 1. Start the app  2. Open a report  3. Click Export PDF | App starts and reports still render (lazy-loaded); only the export fails gracefully (no crash) |               | ⏳     |

---

**Total:** 3 test cases · **All status:** ⏳ Pending
