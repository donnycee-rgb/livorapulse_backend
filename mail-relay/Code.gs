/**
 * LivoraPulse mail relay
 * Google Apps Script Web App  ->  MailApp (Gmail)
 *
 * The backend writes each email and posts it here; this script only checks
 * the secret and sends it. Emails go out from the Google account that
 * deploys this script, so deploy it from the sender account.
 *
 * PRIVATE CONFIGURATION
 * ---------------------
 * Set these in Apps Script: Project Settings > Script Properties
 *   RELAY_SECRET      Long random string (32+ characters). Same value as
 *                     MAIL_RELAY_SECRET on the backend.
 *   MAIL_SENDER_NAME  Optional. Name shown as the sender. Default: "LivoraPulse".
 *   MAIL_REPLY_TO     Optional. Where replies go (e.g. a support address).
 *   MAIL_ENABLED      Optional. "false" stops all email.
 *
 * Create this script from a Google Sheet (Extensions > Apps Script) and every
 * email it handles is recorded in a "Mail log" tab: time, recipient, type and
 * result. Never the subject or body.
 *
 * Request (POST, JSON):  { secret, to, kind, subject, text, html }
 * Response (always 200): { ok: true } or { ok: false, code }
 */

var PROPS = PropertiesService.getScriptProperties();
var RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var MAX_BODY = 200000;

function cfg_(name, fallback) {
  var v = PROPS.getProperty(name);
  return v === null || v === '' ? fallback : v;
}

function doGet() {
  // Health check only. Says nothing about quota or settings.
  return json_({ ok: true, service: 'LivoraPulse mail relay' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return fail_('BAD_REQUEST');
    if (e.postData.contents.length > MAX_BODY) return fail_('TOO_LARGE');

    var body;
    try { body = JSON.parse(e.postData.contents); }
    catch (err) { return fail_('BAD_REQUEST'); }

    var secret = cfg_('RELAY_SECRET', '');
    if (secret.length < 32) return fail_('NOT_CONFIGURED');
    if (typeof body.secret !== 'string' || !safeEqual_(body.secret, secret)) return fail_('UNAUTHORIZED');

    // From here on the caller is the backend, so each result is logged
    var to = String(body.to || '').trim();
    var kind = String(body.kind || '').slice(0, 20);
    var result = send_(body, to);
    log_(to, kind, result);
    return result === 'SENT' ? json_({ ok: true }) : fail_(result);
  } catch (err) {
    // Log the error only, never the request: it holds codes and reset links
    console.error('Mail relay failed: ' + (err && err.message ? err.message : err));
    return fail_('SEND_FAILED');
  }
}

// Sends one email. Returns 'SENT' or an error code. Never throws.
function send_(body, to) {
  try {
    if (String(cfg_('MAIL_ENABLED', 'true')).toLowerCase() === 'false') return 'DISABLED';

    var subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    var text = String(body.text || '');
    var html = String(body.html || '');
    if (!RE_EMAIL.test(to) || to.indexOf(',') !== -1 || to.indexOf(';') !== -1) return 'BAD_RECIPIENT';
    if (!subject || !text) return 'BAD_REQUEST';

    if (MailApp.getRemainingDailyQuota() < 1) return 'QUOTA_EXCEEDED';

    var options = { name: cfg_('MAIL_SENDER_NAME', 'LivoraPulse') };
    if (html) options.htmlBody = html;
    var replyTo = cfg_('MAIL_REPLY_TO', '');
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(to, subject, text, options);
    return 'SENT';
  } catch (err) {
    console.error('Mail relay failed: ' + (err && err.message ? err.message : err));
    return 'SEND_FAILED';
  }
}

// ------------------------------------------------------------------
// Mail log (when the script belongs to a spreadsheet)
// ------------------------------------------------------------------

var LOG_SHEET = 'Mail log';
var LOG_HEADERS = ['Time', 'To', 'Type', 'Result'];
var LOG_MAX_ROWS = 5000;

// Adds one row: when, who, which email, and whether it went. Never the
// subject or body, which hold codes and reset links. Never throws, so a
// logging problem cannot stop an email.
function log_(to, kind, result) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return; // standalone script: nothing to log to
    var sheet = ss.getSheetByName(LOG_SHEET) || createLogSheet_(ss);
    sheet.appendRow([new Date(), guard_(to), guard_(kind), result]);
    // Keep the newest rows only
    var extra = sheet.getLastRow() - 1 - LOG_MAX_ROWS;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (err) {
    console.error('Mail log failed: ' + (err && err.message ? err.message : err));
  }
}

function createLogSheet_(ss) {
  var sheet = ss.insertSheet(LOG_SHEET);
  sheet.appendRow(LOG_HEADERS);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  return sheet;
}

// Stops a cell from being read as a formula
function guard_(value) {
  var s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code) {
  return json_({ ok: false, code: code });
}

// ------------------------------------------------------------------
// Run manually from the Apps Script editor
// ------------------------------------------------------------------

// Sends one test email to the account running the script and logs it.
// Running it the first time also asks for the permissions the relay needs.
function sendTestEmail() {
  var me = Session.getEffectiveUser().getEmail();
  var result = send_({
    subject: '[TEST] LivoraPulse mail relay',
    text: 'The mail relay can send email from this account.'
  }, me);
  log_(me, 'test', result);
  Logger.log('Result: %s', result);
  Logger.log('Sent a test email to %s. %s emails left today.', me, MailApp.getRemainingDailyQuota());
}

// Prints a fresh random secret to paste into RELAY_SECRET and MAIL_RELAY_SECRET.
function generateSecret() {
  var bytes = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime();
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  Logger.log(Utilities.base64EncodeWebSafe(hash).replace(/=+$/, ''));
}
