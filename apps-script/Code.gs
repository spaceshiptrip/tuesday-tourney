// ============================================================
// CONFIGURATION — update these two values before deploying
// ============================================================
var SHEET_ID   = 'YOUR_GOOGLE_SHEET_ID_HERE'; // from the Sheet URL
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
  var lines = text.split('\n')
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0; });

  var result = { team: '', players: [], pins: null, hdcp: null, totals: null };

  // Team name: first line containing "Team:"
  for (var i = 0; i < lines.length; i++) {
    var tm = lines[i].match(/Team[:\s]+(.+?)(?:\s+1st|\s+Games|$)/i);
    if (tm) { result.team = tm[1].trim(); break; }
  }

  // Player rows: text name + exactly 4 numbers (game1, game2, game3, series)
  // Series is typically 3–4 digits; individual game scores are 2–3 digits.
  var playerRe = /^([A-Za-z][A-Za-z\s.\-']+?)\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\s+(\d{3,4})\s*$/;
  var skipRe   = /^(Pins|\+HDCP|Totals|Games|1st|2nd|3rd)/i;

  lines.forEach(function(line) {
    if (skipRe.test(line)) return;
    var m = line.match(playerRe);
    if (m) {
      result.players.push({
        name:  m[1].trim(),
        game1: +m[2],
        game2: +m[3],
        game3: +m[4],
        series: +m[5]
      });
    }
  });

  // Summary rows — search all lines for keywords
  lines.forEach(function(line) {
    var nums;

    if (/\bPins\b/i.test(line)) {
      nums = line.match(/\d+/g);
      if (nums && nums.length >= 4) {
        result.pins = { game1: +nums[0], game2: +nums[1], game3: +nums[2], total: +nums[3] };
      }
    }

    if (/HDCP/i.test(line)) {
      nums = line.match(/\d+/g);
      if (nums && nums.length >= 4) {
        result.hdcp = { game1: +nums[0], game2: +nums[1], game3: +nums[2], total: +nums[3] };
      }
    }

    // Totals row has win/loss markers (X = loss, √/v/✓ = win)
    if (/Totals/i.test(line) && /[Xv✓√]/i.test(line)) {
      // Normalise markers then extract (marker)(score) pairs
      var norm   = line.replace(/[✓√]/gi, 'W').replace(/\bv\b/gi, 'W').replace(/\bX\b/g, 'L');
      var pairs  = norm.match(/([WL])\s*(\d+)/g) || [];
      var decode = function(s) {
        var p = s.match(/([WL])\s*(\d+)/);
        return (p[1] === 'W' ? '√' : 'X') + ' ' + p[2];
      };
      if (pairs.length >= 4) {
        result.totals = {
          game1: decode(pairs[0]),
          game2: decode(pairs[1]),
          game3: decode(pairs[2]),
          total: decode(pairs[3])
        };
      } else {
        // Fallback: store raw numbers without markers
        nums = line.match(/\d+/g);
        if (nums && nums.length >= 4) {
          result.totals = { game1: nums[0], game2: nums[1], game3: nums[2], total: nums[3] };
        }
      }
    }
  });

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
