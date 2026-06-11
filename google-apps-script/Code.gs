/**
 * Google Apps Script Webhook for WhatsApp Message Logger
 *
 * Quick setup (auto column headers):
 * 1. Open your Google Sheet → Extensions → Apps Script → paste this file → Save
 * 2. Select function "setupSheetHeaders" in the dropdown → click Run (▶)
 * 3. Allow permissions when asked — row 1 on Sheet1 gets all 19 columns automatically
 * 4. Deploy → New deployment → Web app (Execute as: Me, Anyone) → copy URL to .env WEBHOOK_URL
 *
 * Sheet layout:
 *   Row 1 — main column headers (frozen)
 *   Per date — date banner, column sub-headers, then message rows for that day
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

var NUM_COLS = SHEET_HEADERS.length;
var SECTION_NOTE_PREFIX = '__SECTION__:';
var SUBHEADER_NOTE = '__SUBHEADER__';
var SPACER_NOTE = '__SPACER__';

var COLORS = {
  mainHeaderBg: '#128c7e',
  mainHeaderFg: '#ffffff',
  dateBannerBg: '#0d6b60',
  dateBannerFg: '#ffffff',
  subHeaderBg: '#d4ede9',
  subHeaderFg: '#1a4d45',
  rowEven: '#f8fbfa',
  rowOdd: '#ffffff',
  border: '#b8e0db'
};

function getSheet1_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Sheet1') || ss.insertSheet('Sheet1');
}

function headersMatch_(sheet) {
  var headers = sheet.getRange(1, 1, 1, NUM_COLS).getValues()[0];
  for (var i = 0; i < SHEET_HEADERS.length; i++) {
    if (headers[i] !== SHEET_HEADERS[i]) return false;
  }
  return true;
}

function applyMainHeaders_(sheet) {
  var range = sheet.getRange(1, 1, 1, NUM_COLS);
  range.setValues([SHEET_HEADERS]);
  range
    .setFontWeight('bold')
    .setBackground(COLORS.mainHeaderBg)
    .setFontColor(COLORS.mainHeaderFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || !headersMatch_(sheet)) {
    applyMainHeaders_(sheet);
  }
}

/**
 * Run this once from the Apps Script editor to write column headers automatically.
 * Extensions → Apps Script → select setupSheetHeaders → Run ▶
 */
function setupSheetHeaders() {
  var sheet = getSheet1_();
  applyMainHeaders_(sheet);
  SpreadsheetApp.getUi().alert(
    'Done! Row 1 on Sheet1 now has ' + SHEET_HEADERS.length + ' columns.\n\n' +
      'New messages are grouped under a styled header for each date.'
  );
}

function findColumn_(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf(headerName);
  return idx === -1 ? -1 : idx + 1;
}

function normalizeDate_(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}/.test(String(dateStr))) {
    return String(dateStr).slice(0, 10);
  }
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateLabel_(isoDate) {
  var parts = isoDate.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
}

function getRowNote_(sheet, row) {
  return sheet.getRange(row, 1).getNote() || '';
}

function isSectionRow_(sheet, row) {
  return getRowNote_(sheet, row).indexOf(SECTION_NOTE_PREFIX) === 0;
}

function isSubHeaderRow_(sheet, row) {
  return getRowNote_(sheet, row) === SUBHEADER_NOTE;
}

function isSpacerRow_(sheet, row) {
  return getRowNote_(sheet, row) === SPACER_NOTE;
}

function isDataRow_(sheet, row) {
  if (row < 2) return false;
  if (isSectionRow_(sheet, row) || isSubHeaderRow_(sheet, row) || isSpacerRow_(sheet, row)) {
    return false;
  }
  return true;
}

function getSectionDateFromRow_(sheet, row) {
  var note = getRowNote_(sheet, row);
  if (note.indexOf(SECTION_NOTE_PREFIX) !== 0) return '';
  return note.slice(SECTION_NOTE_PREFIX.length);
}

function findSectionRowForDate_(sheet, isoDate) {
  var lastRow = sheet.getLastRow();
  for (var r = 2; r <= lastRow; r++) {
    if (getSectionDateFromRow_(sheet, r) === isoDate) return r;
  }
  return 0;
}

function collectMessageIds_(sheet) {
  var idCol = findColumn_(sheet, 'Message ID');
  if (idCol < 1) return [];

  var ids = [];
  var lastRow = sheet.getLastRow();
  for (var r = 2; r <= lastRow; r++) {
    if (!isDataRow_(sheet, r)) continue;
    var id = sheet.getRange(r, idCol).getValue();
    if (id) ids.push(String(id));
  }
  return ids;
}

function applySectionBannerStyle_(sheet, row) {
  var range = sheet.getRange(row, 1, 1, NUM_COLS);
  range
    .setBackground(COLORS.dateBannerBg)
    .setFontColor(COLORS.dateBannerFg)
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(row, 34);
}

function applySubHeaderStyle_(sheet, row) {
  var range = sheet.getRange(row, 1, 1, NUM_COLS);
  range
    .setFontWeight('bold')
    .setBackground(COLORS.subHeaderBg)
    .setFontColor(COLORS.subHeaderFg)
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(row, 28);
}

function applySpacerStyle_(sheet, row) {
  sheet.getRange(row, 1).setNote(SPACER_NOTE);
  sheet.getRange(row, 1, 1, NUM_COLS)
    .setBackground('#ffffff')
    .setBorder(false, false, true, false, false, false, COLORS.border, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(row, 10);
}

function applyMessageRowStyle_(sheet, row, indexInSection) {
  var bg = indexInSection % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
  var range = sheet.getRange(row, 1, 1, NUM_COLS);
  range
    .setBackground(bg)
    .setFontSize(10)
    .setVerticalAlignment('top')
    .setWrap(true);
  sheet.getRange(row, 5).setWrap(true); // Message
  sheet.getRange(row, 8).setWrap(true); // Reply To Text
  sheet.setRowHeight(row, 28);
}

function countDataRowsInSection_(sheet, sectionRow) {
  var lastRow = sheet.getLastRow();
  var count = 0;
  for (var r = sectionRow + 1; r <= lastRow; r++) {
    if (isSectionRow_(sheet, r) || isSpacerRow_(sheet, r)) break;
    if (isDataRow_(sheet, r)) count++;
  }
  return count;
}

function getLastDataRowInSection_(sheet, sectionRow) {
  var lastRow = sheet.getLastRow();
  var lastData = sectionRow;
  for (var r = sectionRow + 1; r <= lastRow; r++) {
    if (isSectionRow_(sheet, r) || isSpacerRow_(sheet, r)) break;
    if (isDataRow_(sheet, r)) lastData = r;
  }
  return lastData;
}

function insertDateSection_(sheet, insertAfterRow, isoDate) {
  var sectionRow = insertAfterRow + 1;
  sheet.insertRowAfter(insertAfterRow);

  var bannerCell = sheet.getRange(sectionRow, 1);
  bannerCell.setValue('  ' + formatDateLabel_(isoDate));
  bannerCell.setNote(SECTION_NOTE_PREFIX + isoDate);
  sheet.getRange(sectionRow, 1, 1, NUM_COLS).merge();
  applySectionBannerStyle_(sheet, sectionRow);

  sheet.insertRowAfter(sectionRow);
  var subHeaderRow = sectionRow + 1;
  sheet.getRange(subHeaderRow, 1, 1, NUM_COLS).setValues([SHEET_HEADERS]);
  sheet.getRange(subHeaderRow, 1).setNote(SUBHEADER_NOTE);
  applySubHeaderStyle_(sheet, subHeaderRow);

  return subHeaderRow;
}

function ensureDateSection_(sheet, isoDate) {
  var existing = findSectionRowForDate_(sheet, isoDate);
  if (existing) return existing;

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.insertRowAfter(lastRow);
    applySpacerStyle_(sheet, lastRow + 1);
    lastRow++;
  }

  insertDateSection_(sheet, lastRow, isoDate);
  return findSectionRowForDate_(sheet, isoDate);
}

function getInsertAfterRowForSection_(sheet, sectionRow) {
  var lastData = getLastDataRowInSection_(sheet, sectionRow);
  if (lastData > sectionRow) return lastData;
  var subRow = sectionRow + 1;
  if (subRow <= sheet.getLastRow() && isSubHeaderRow_(sheet, subRow)) return subRow;
  return sectionRow;
}

function appendMessageRow_(sheet, data) {
  var isoDate = normalizeDate_(data.date);
  ensureDateSection_(sheet, isoDate);

  var sectionRow = findSectionRowForDate_(sheet, isoDate);
  var insertAfter = getInsertAfterRowForSection_(sheet, sectionRow);
  var indexInSection = countDataRowsInSection_(sheet, sectionRow);

  sheet.insertRowAfter(insertAfter);
  var targetRow = insertAfter + 1;
  sheet.getRange(targetRow, 1, 1, NUM_COLS).setValues([rowFromPayload_(data)]);
  applyMessageRowStyle_(sheet, targetRow, indexInSection);
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
      var existingIds = collectMessageIds_(sheet);
      if (existingIds.indexOf(messageId) !== -1) {
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'duplicate', id: messageId })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    appendMessageRow_(sheet, data);

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
