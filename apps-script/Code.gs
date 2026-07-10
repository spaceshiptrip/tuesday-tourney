// ============================================================
// CONFIGURATION — update these two values before deploying
// ============================================================
var SHEET_ID   = '14AzRptb55HlOfeQ46BOD4fS8YBleAw-27HNVJXqvP6U';
var SHEET_NAME = 'Scores';                     // tab name

// ============================================================
// Web App Entry Point
// POST body: JSON string { image: <base64>, mimeType: <string> }
// Sent as text/plain to avoid CORS preflight.
// ============================================================
function doPost(e) {
  try {
    var payload   = JSON.parse(e.postData.contents);
    var b64       = payload.image;
    var mimeType  = payload.mimeType || 'image/jpeg';

    if (!b64) return jsonResponse({ error: 'No image data received.' });

    var ocrText = ocrImage(b64, mimeType);
    Logger.log('OCR output:\n' + ocrText);

    var parsed = parseScores(ocrText);

    if (!parsed || parsed.players.length === 0) {
      return jsonResponse({
        error: 'Could not parse score table. Raw OCR text: ' + ocrText
      });
    }

    var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
    writeToSheet(parsed, date);

    // Build response rows for the frontend confirmation table
    var rows = parsed.players.map(function(p) {
      return { type: 'player', player: p.name, game1: p.game1, game2: p.game2, game3: p.game3, series: p.series };
    });

    if (parsed.pins) {
      rows.push({ type: 'pins', player: 'Pins',
        game1: parsed.pins.game1, game2: parsed.pins.game2, game3: parsed.pins.game3, series: parsed.pins.total });
    }
    if (parsed.hdcp) {
      rows.push({ type: 'hdcp', player: '+HDCP',
        game1: parsed.hdcp.game1, game2: parsed.hdcp.game2, game3: parsed.hdcp.game3, series: parsed.hdcp.total });
    }
    if (parsed.totals) {
      rows.push({ type: 'totals', player: 'Totals',
        game1: parsed.totals.game1, game2: parsed.totals.game2, game3: parsed.totals.game3, series: parsed.totals.total });
    }

    return jsonResponse({ team: parsed.team, date: date, rows: rows });

  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ error: 'Server error: ' + err.message });
  }
}

// ============================================================
// OCR via Google Drive
// Requires Drive Advanced Service enabled (Services > Drive API)
// ============================================================
function ocrImage(b64, mimeType) {
  var ext  = (mimeType || 'image/jpeg').split('/')[1] || 'jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mimeType, 'ocr_temp.' + ext);

  var imageFile = DriveApp.createFile(blob);

  var docFile = Drive.Files.copy(
    { title: 'ocr_temp_doc', mimeType: 'application/vnd.google-apps.document' },
    imageFile.getId(),
    { ocr: true }
  );

  var text = DocumentApp.openById(docFile.id).getBody().getText();

  DriveApp.getFileById(imageFile.getId()).setTrashed(true);
  DriveApp.getFileById(docFile.id).setTrashed(true);

  return text;
}

// ============================================================
// Parser
// Expected table layout (from TV display):
//
//   Team:Team 2      1st   2nd   3rd   Totals
//   Roger Webb       167   167   167   501
//   Rob Mochizuki   127   188   129   444
//   Andrew Choy     180   192   181   553
//   Michael Fajardo 175   202   135   512
//   Games  Pins     649   749   612   2010
//   1 to 3 +HDCP    152   152   152   456
//          Totals  X801  √901  X764  X2466
// ============================================================
function parseScores(text) {
  var lines = text.split(/\r?\n/)
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0; });

  // Full text on one string for global searches (Drive OCR often omits line breaks on TV screenshots)
  var fullText = lines.join(' ');

  var result = { team: '', players: [], pins: null, hdcp: null, totals: null };

  // Team name
  var tm = fullText.match(/Team[:\s]+(.+?)(?:\s+1st|\s+\d{3}|\s+Games|$)/i);
  if (tm) result.team = tm[1].trim();

  // Player rows: name + game1 (2-3 digits) + game2 + game3 + series (3-4 digits)
  // Try line-by-line first (clean OCR), then fall back to global search (no-newline OCR)
  var skipNames = /^(Pins|HDCP|Totals|Games|Press|Key|Exit|Recap|Sheet|Team)/i;

  var playerLineRe = /^([A-Za-z][A-Za-z\s.\-']+?)\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\s+(\d{3,4})\s*$/;
  lines.forEach(function(line) {
    if (skipNames.test(line)) return;
    var m = line.match(playerLineRe);
    if (m) {
      result.players.push({ name: m[1].trim(), game1: +m[2], game2: +m[3], game3: +m[4], series: +m[5] });
    }
  });

  // Fallback: scan full text with global regex (handles single-line OCR output)
  if (result.players.length === 0) {
    var playerGlobalRe = /([A-Za-z][A-Za-z\s.\-']{3,20}?)\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\s+(\d{3,4})/g;
    var containsKeyword = /\b(Totals|1st|2nd|3rd|Games|Pins|HDCP|Press|Key|Exit|Recap|Sheet|Team)\b/i;
    var gm;
    while ((gm = playerGlobalRe.exec(fullText)) !== null) {
      var name = gm[1].trim();
      // If the name swept up "Totals" (header word), extract the real name after it
      if (/\bTotals\b/i.test(name)) {
        name = name.replace(/^.*\bTotals\b\s*/i, '').trim();
      }
      if (!name || containsKeyword.test(name)) continue;
      if (result.players.some(function(p) { return p.name === name; })) continue;
      result.players.push({ name: name, game1: +gm[2], game2: +gm[3], game3: +gm[4], series: +gm[5] });
    }
  }

  // Summary rows — search full text by keyword (handles both line-break and no-line-break OCR)
  // Require total to be 3-4 digits so stray single-digit numbers (e.g. lane "1" sign) are ignored
  var pinsM = fullText.match(/Pins\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d{3,4}))?/i);
  if (pinsM) {
    result.pins = { game1: +pinsM[1], game2: +pinsM[2], game3: +pinsM[3], total: pinsM[4] ? +pinsM[4] : '' };
  }

  var hdcpM = fullText.match(/HDCP\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d{3,4}))?/i);
  if (hdcpM) {
    result.hdcp = { game1: +hdcpM[1], game2: +hdcpM[2], game3: +hdcpM[3], total: hdcpM[4] ? +hdcpM[4] : '' };
  }

  // Totals row — normalize all win/loss variants (X=loss, √/V/v/✓=win) then extract marker+score pairs
  // Use X(?=\d)|\bX\b so both "X801" and "X 801" are caught.
  // Use V(?=\d)|\bV\b so "V901" (no space between V and digit) is caught — \bV\b misses it.
  var norm = fullText
    .replace(/[✓√]/g, 'W')
    .replace(/V(?=\d)|\bV\b/g, 'W')
    .replace(/v(?=\d)|\bv\b/g, 'W')
    .replace(/X(?=\d)|\bX\b/g, 'L');

  // Find the LAST "Totals" — the header row also has "Totals" and comes first
  var totalsIdx = -1;
  var totRe = /\bTotals\b/gi;
  var totMatch;
  while ((totMatch = totRe.exec(norm)) !== null) { totalsIdx = totMatch.index; }

  if (totalsIdx >= 0) {
    // Extract plain numbers after win/loss markers — markers not stored, just the scores
    var totNums = norm.slice(totalsIdx).match(/[WL]\s*(\d+)/g) || [];
    var extractNum = function(s) { return +s.replace(/[WL]\s*/, ''); };
    if (totNums.length >= 3) {
      result.totals = {
        game1: extractNum(totNums[0]),
        game2: extractNum(totNums[1]),
        game3: extractNum(totNums[2]),
        total: totNums[3] ? extractNum(totNums[3]) : ''
      };
    }
  }

  // The OCR sometimes dumps the rightmost column (series totals) at the very end of the text.
  // Pattern: 4-digit pins total, 3-digit hdcp total, 4-digit totals total — e.g. "2010 456 2466"
  if (result.pins && !result.pins.total) {
    var trailing = fullText.match(/(\d{4})\s+(\d{3})\s+(\d{4})\s*$/);
    if (trailing) {
      result.pins.total = +trailing[1];
      if (result.hdcp) result.hdcp.total = +trailing[2];
    }
  }

  return result;
}

// ============================================================
// Write rows to Google Sheet
// Columns: Date | Team | Player | Game 1 | Game 2 | Game 3 | Series | Row Type
// ============================================================
function writeToSheet(parsed, date) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Date', 'Team', 'Player', 'Game 1', 'Game 2', 'Game 3', 'Series', 'Row Type']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  var team = parsed.team;

  parsed.players.forEach(function(p) {
    sheet.appendRow([date, team, p.name, p.game1, p.game2, p.game3, p.series, 'player']);
  });

  if (parsed.pins) {
    sheet.appendRow([date, team, 'Pins',
      parsed.pins.game1, parsed.pins.game2, parsed.pins.game3, parsed.pins.total, 'pins']);
  }
  if (parsed.hdcp) {
    sheet.appendRow([date, team, '+HDCP',
      parsed.hdcp.game1, parsed.hdcp.game2, parsed.hdcp.game3, parsed.hdcp.total, 'hdcp']);
  }
  if (parsed.totals) {
    sheet.appendRow([date, team, 'Totals',
      parsed.totals.game1, parsed.totals.game2, parsed.totals.game3, parsed.totals.total, 'totals']);
  }
}

// ============================================================
// Helper
// ============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
