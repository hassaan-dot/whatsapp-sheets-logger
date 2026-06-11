/**
 * Google Apps Script Webhook for WhatsApp Message Logger
 *
 * Quick setup (auto column headers):
 * 1. Open your Google Sheet → Extensions → Apps Script → paste this file → Save
 * 2. Select function "setupSheetHeaders" in the dropdown → click Run (▶)
 * 3. Allow permissions when asked — row 1 on Sheet1 gets all 19 columns automatically
 * 4. Deploy → New deployment → Web app (Execute as: Me, Anyone) → copy URL to .env WEBHOOK_URL
 *
 * Headers are also auto-fixed on each incoming message if row 1 is missing or wrong.
 */

var SHEET_HEADERS = [
  'Date',
  'Time',
  'Group',
  'Sender',
  'Message',
  'Is Reply',
  'Reply To Sender',
  'Reply To Text',
  'Type',
  'Has Media',
  'Caption',
  'Forwarded',
  'Links',
  'Mentions',
  'Sender ID',
  'Group ID',
  'Message ID',
  'Reply To Msg ID',
  'Logged At'
];

function getSheet1_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Sheet1') || ss.insertSheet('Sheet1');
}

function headersMatch_(sheet) {
  var headers = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
  for (var i = 0; i < SHEET_HEADERS.length; i++) {
    if (headers[i] !== SHEET_HEADERS[i]) return false;
  }
  return true;
}

function applyHeaders_(sheet) {
  sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
  sheet.getRange(1, 1, 1, SHEET_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#128c7e')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || !headersMatch_(sheet)) {
    applyHeaders_(sheet);
  }
}

/**
 * Run this once from the Apps Script editor to write column headers automatically.
 * Extensions → Apps Script → select setupSheetHeaders → Run ▶
 */
function setupSheetHeaders() {
  var sheet = getSheet1_();
  applyHeaders_(sheet);
  SpreadsheetApp.getUi().alert(
    'Done! Row 1 on Sheet1 now has ' + SHEET_HEADERS.length + ' columns.\n\n' +
      SHEET_HEADERS.join(' | ')
  );
}

function findColumn_(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf(headerName);
  return idx === -1 ? -1 : idx + 1;
}

function rowFromPayload_(data) {
  return [
    data.date || '',
    data.time || '',
    data.group || '',
    data.sender || '',
    data.message || '',
    data.isReply || 'no',
    data.replyToSender || '',
    data.replyToText || '',
    data.type || '',
    data.hasMedia || 'no',
    data.caption || '',
    data.forwarded || 'no',
    data.links || '',
    data.mentions || '',
    data.senderId || data.phone || '',
    data.groupId || '',
    data.id || '',
    data.replyToMsgId || '',
    data.loggedAt || ''
  ];
}

function doPost(e) {
  try {
    var sheet = getSheet1_();
    ensureHeaders_(sheet);
    var data = JSON.parse(e.postData.contents);

    var messageId = String(data.id || '');
    if (messageId) {
      var idCol = findColumn_(sheet, 'Message ID');
      if (idCol > 0) {
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          var existingIds = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
          if (existingIds.indexOf(messageId) !== -1) {
            return ContentService.createTextOutput(
              JSON.stringify({ status: 'duplicate', id: messageId })
            ).setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    sheet.appendRow(rowFromPayload_(data));

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
