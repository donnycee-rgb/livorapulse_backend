# Mail relay (Google Apps Script)

The backend sends sign-up codes and password reset links through this small
Apps Script web app. The script sends each email with Gmail (`MailApp`) from
the Google account that deploys it. No email API keys are needed.

```
backend (EmailService.ts) ──POST {secret,to,subject,text,html}──▶ Apps Script ──MailApp──▶ inbox
```

The backend writes the emails. The relay only checks the secret and sends
them, so you edit the wording in `src/services/EmailService.ts` without
redeploying the script.

## Setup

1. **Sign in as the sender account.** Use the Gmail account the emails should
   come from (e.g. `livorapulse.app@gmail.com`).
2. Go to <https://script.google.com>, create a **New project** and name it
   `LivoraPulse mail relay`.
3. Replace `Code.gs` with [`Code.gs`](Code.gs) from this folder.
4. **Project Settings** → tick **Show "appsscript.json" manifest file in editor**,
   then replace that file with [`appsscript.json`](appsscript.json).
5. In the editor, choose **`generateSecret`** → **Run**. Approve the permissions
   when asked. Copy the value from the execution log.
6. **Project Settings → Script Properties**, add:

   | Property | Value |
   | --- | --- |
   | `RELAY_SECRET` | the value from step 5 |
   | `MAIL_SENDER_NAME` | `LivoraPulse` (optional) |
   | `MAIL_REPLY_TO` | support address for replies (optional) |

7. Run **`sendTestEmail`**. A test email should land in the sender's inbox.
8. **Deploy → New deployment** → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**

   Copy the **Web app URL** (ends in `/exec`).
9. On the backend (Railway variables, or `.env` locally):

   ```
   MAIL_RELAY_URL=https://script.google.com/macros/s/…/exec
   MAIL_RELAY_SECRET=<same value as RELAY_SECRET>
   ```

"Anyone" access is needed so the backend can call the script without a Google
sign-in. Without the secret, the script refuses to send.

## Updating the script

After editing `Code.gs`: **Deploy → Manage deployments** → edit the existing
deployment → **Version: New version** → **Deploy**. This keeps the same URL.
A *new* deployment gets a new URL.

## Limits

- About **100 emails a day** on a personal Gmail account and about **1,500** on
  Google Workspace. Over the limit, the relay answers `QUOTA_EXCEEDED`.
- To stop all email without redeploying, set `MAIL_ENABLED` to `false`.

## Error codes

The relay always answers HTTP 200 and returns `{ ok: false, code }` on failure.
The backend logs only the code, never the email.

| Code | Meaning |
| --- | --- |
| `UNAUTHORIZED` | `MAIL_RELAY_SECRET` doesn't match `RELAY_SECRET` |
| `NOT_CONFIGURED` | `RELAY_SECRET` is missing or shorter than 32 characters |
| `DISABLED` | `MAIL_ENABLED` is `false` |
| `QUOTA_EXCEEDED` | daily Gmail limit reached |
| `BAD_RECIPIENT` / `BAD_REQUEST` / `TOO_LARGE` | the request was malformed |
| `SEND_FAILED` | Gmail refused; see **Executions** in the Apps Script editor |
