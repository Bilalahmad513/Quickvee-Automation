// Runs in Node (cypress.config.js tasks), not in the browser.
//
// Merchant login now asks for a one-time password (since 11 Nov 2026): after
// Store name / Username / Password and "Login", the form shows a "One-time
// password" box (input[name="otp"], 6 digits) and the button becomes
// "Verify & Sign In". Quickvee emails the code to the login's email
// (otpEmailUser in cypress.env.json); this reads it from that Gmail inbox
// over IMAP with a Google App Password (otpEmailAppPassword). Read-only -
// nothing is marked, moved or deleted.
//
// "Trust this device" makes the server return a device token, which the app
// keeps in localStorage ("qv_device_token") and sends with the next login -
// then no code is asked. The token is kept between runs in
// cypress/.auth/device-tokens.json (gitignored), one per site.
const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const ALL_MAIL = "[Gmail]/All Mail";
const TOKENS_FILE = path.join(__dirname, "..", ".auth", "device-tokens.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(user, appPassword) {
  return new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass: appPassword }, logger: false });
}

function textOf(mail) {
  const html = (mail.html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return `${mail.subject || ""} ${mail.text || ""} ${html}`.replace(/\s+/g, " ");
}

// The 6-digit code in an email that talks about a code / OTP / verification.
// A code right after one of those words wins; otherwise the first
// standalone 6-digit number.
function codeIn(text) {
  if (!/otp|one[- ]time|verification|passcode|code/i.test(text)) return null;
  const near = text.match(/(?:otp|one[- ]time password|verification code|passcode|code)\D{0,40}?\b(\d{6})\b/i);
  if (near) return near[1];
  const any = text.match(/\b(\d{6})\b/);
  return any ? any[1] : null;
}

// The next UID the "All Mail" mailbox will give a new message - taken right
// before "Login" is clicked, so only an email that arrives after it can be
// taken as the code (never an older one still in the inbox). null when the
// OTP inbox isn't configured (a login that needs no code still works).
async function otpMailboxMark({ user, appPassword }) {
  if (!user || !appPassword) return null;
  const client = connect(user, appPassword);
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(ALL_MAIL, { readOnly: true });
    return mailbox.uidNext;
  } finally {
    await client.logout();
  }
}

// Waits (checking every `pollMs`, for up to `timeoutMs`) for a Quickvee
// email with UID >= fromUid holding a 6-digit code. Resolves { code,
// subject, receivedAt } of the newest one; rejects with what it did see.
async function findLoginOtp({ user, appPassword, fromUid, timeoutMs = 180000, pollMs = 5000 }) {
  if (!user || !appPassword) {
    throw new Error(
      "Login asked for a one-time password, but otpEmailUser / otpEmailAppPassword are missing in cypress.env.json - " +
        "needed to read the code from the login's Gmail inbox."
    );
  }
  if (!fromUid) throw new Error("findLoginOtp needs fromUid (from otpMailboxMark, taken before Login was clicked).");
  const deadline = Date.now() + timeoutMs;
  let seen = [];

  while (Date.now() < deadline) {
    const client = connect(user, appPassword);
    await client.connect();
    const lock = await client.getMailboxLock(ALL_MAIL);
    try {
      // "n:*" also returns the newest message when nothing is newer than n,
      // so the UID is checked again below.
      const uids = (await client.search({ uid: `${fromUid}:*`, from: "quickvee" }, { uid: true })) || [];
      const found = [];
      seen = [];
      for (const uid of uids.filter((u) => u >= fromUid)) {
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
        const mail = await simpleParser(msg.source);
        const code = codeIn(textOf(mail));
        seen.push(`"${mail.subject}" from ${mail.from && mail.from.text}${code ? " (has a code)" : ""}`);
        if (code) found.push({ code, subject: mail.subject, receivedAt: msg.internalDate.toISOString() });
      }
      if (found.length) return found[found.length - 1];
    } finally {
      lock.release();
      await client.logout();
    }
    await sleep(pollMs);
  }
  throw new Error(
    `No Quickvee one-time password email arrived in ${user} within ${Math.round(timeoutMs / 1000)}s. ` +
      `Quickvee emails seen since Login was clicked: ${seen.length ? seen.join(" || ") : "none"}`
  );
}

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  } catch (error) {
    return {};
  }
}

// The device token kept for `site` (e.g. https://quickvee.com), or null.
function readDeviceToken(site) {
  return readTokens()[site] || null;
}

function saveDeviceToken({ site, token }) {
  const tokens = readTokens();
  if (tokens[site] === token) return null;
  tokens[site] = token;
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  return null;
}

module.exports = { otpMailboxMark, findLoginOtp, readDeviceToken, saveDeviceToken, codeIn };
