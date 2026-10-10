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
 * Request (POST, JSON):  { secret, to, subject, text, html }
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

    if (String(cfg_('MAIL_ENABLED', 'true')).toLowerCase() === 'false') return fail_('DISABLED');

    var to = String(body.to || '').trim();
    var subject = String(body.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    var text = String(body.text || '');
    var html = String(body.html || '');
    if (!RE_EMAIL.test(to) || to.indexOf(',') !== -1 || to.indexOf(';') !== -1) return fail_('BAD_RECIPIENT');
    if (!subject || !text) return fail_('BAD_REQUEST');

    if (MailApp.getRemainingDailyQuota() < 1) return fail_('QUOTA_EXCEEDED');

    var options = { name: cfg_('MAIL_SENDER_NAME', 'LivoraPulse') };
    if (html) options.htmlBody = html;
    var replyTo = cfg_('MAIL_REPLY_TO', '');
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(to, subject, text, options);
    return json_({ ok: true });
  } catch (err) {
    // Log the error only, never the request: it holds codes and reset links
    console.error('Mail relay failed: ' + (err && err.message ? err.message : err));
    return fail_('SEND_FAILED');
  }
}

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

// Sends one test email to the account running the script. Running it the
// first time also asks for the "send email as you" permission.
function sendTestEmail() {
  var me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(me, '[TEST] LivoraPulse mail relay', 'The mail relay can send email from this account.', {
    name: cfg_('MAIL_SENDER_NAME', 'LivoraPulse')
  });
  Logger.log('Sent a test email to %s. %s emails left today.', me, MailApp.getRemainingDailyQuota());
}

// Prints a fresh random secret to paste into RELAY_SECRET and MAIL_RELAY_SECRET.
function generateSecret() {
  var bytes = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime();
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  Logger.log(Utilities.base64EncodeWebSafe(hash).replace(/=+$/, ''));
}
