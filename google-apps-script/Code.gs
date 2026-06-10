/**
 * Google Apps Script Webhook for WhatsApp Message Logger
 *
 * Setup:
 * 1. Create a Google Sheet with headers in Sheet1:
 *    Date | Time | Sender | Phone | Message | Type | Message ID
 * 2. Extensions → Apps Script → paste this file
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL into your .env WEBHOOK_URL
 */

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');

    if (!sheet) {
      return ContentService.createTextOutput(
        JSON.stringify({ error: 'Sheet1 not found' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);

    // Deduplicate by Message ID (column G)
    const messageId = String(data.id || '');
    if (messageId) {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const existingIds = sheet.getRange(2, 7, lastRow - 1, 1).getValues().flat();
        if (existingIds.includes(messageId)) {
          return ContentService.createTextOutput(
            JSON.stringify({ status: 'duplicate', id: messageId })
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    sheet.appendRow([
      data.date || '',
      data.time || '',
      data.sender || '',
      data.phone || '',
      data.message || '',
      data.type || '',
      data.id || ''
    ]);

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'OK' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('WhatsApp Sheets Logger webhook is running.');
}
