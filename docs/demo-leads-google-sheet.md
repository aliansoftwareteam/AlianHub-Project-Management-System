# Demo leads → Google Sheet

The demo-site popup (shown only when `DEMO_MODE=true`) posts each visitor's details to the server. The server forwards them to a Google Apps Script web app, which appends one row to a Google Sheet.

## 1. Create the sheet

1. Create a new Google Sheet, for example "AlianHub demo leads".
2. In row 1, add the headers: `Timestamp | Name | Email | Find from | Other | Page`.

## 2. Add the script

1. In the sheet, open **Extensions → Apps Script**.
2. Replace the editor contents with:

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || '',
    data.email || '',
    data.findFrom || '',
    data.findFromOther || '',
    data.page || '',
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Save the project.

## 3. Deploy it

1. Click **Deploy → New deployment**, and pick the type **Web app**.
2. Set **Execute as** to *Me* and **Who has access** to *Anyone*.
3. Click **Deploy**, authorize when Google asks, and copy the **Web app URL** (it ends in `/exec`).

After you edit the script, redeploy with **Deploy → Manage deployments → Edit → New version**, or the old code keeps running.

## 4. Point the server at it

Add the URL to the server `.env` and restart the server:

```env
DEMO_MODE="true"
DEMO_LEADS_SHEET_URL="https://script.google.com/macros/s/XXXX/exec"
```

The URL is only read on the server and is never sent to the browser.

Use the **Web app URL** from the deployment (`https://script.google.com/macros/s/.../exec`), not the sheet's own address (`https://docs.google.com/spreadsheets/d/.../edit`). With the sheet address no rows are added, and the popup shows the "couldn't save" message.
