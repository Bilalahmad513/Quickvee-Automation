// Runs in Node (cypress.config.js task), not in the browser: reads the Gmail
// inbox Quickvee sends export emails to, over IMAP. Read-only - nothing is
// marked, moved or deleted.
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// Gmail lists every message under "All Mail" - confirmed live that the
// export emails weren't all found by searching INBOX.
const ALL_MAIL = "[Gmail]/All Mail";
const SENDER = "ecs@quickvee.us";
const SUBJECT = "CSV Export Notification";

// The email's plain-text part only says "Please view this email in HTML";
// the details are in the HTML part, e.g. "Export is ready For Merchant:
// BIL2215335CA Report: Item Sold Report | 2026-01-01 to 2026-11-04 Rows: 221
// Download Report".
function htmlText(mail) {
  return (mail.html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "For Merchant: BIL2215335CA Report: ..." (one store) or "For Merchants
// (3): BIL1813474MA, BIL2215335CA, BIL2222577CA Report: ..." (several -
// confirmed live on a PO Products export) -> what the email says it holds.
const DETAILS = /For Merchants?(?: \(\d+\))?: ([A-Z0-9, ]+?) Report: (.+?) \| (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/;
function detailsOf(text) {
  const m = text.match(DETAILS);
  return m && { merchantIds: m[1].split(",").map((s) => s.trim()).filter(Boolean).sort(), report: m[2].trim(), startDate: m[3], endDate: m[4] };
}

// Waits (checking every `pollMs`, for up to `timeoutMs`) for an export email
// that arrived after `since` (ms timestamp - a minute is allowed for clock
// differences) for exactly the stores in `merchantIds` (any order),
// `report` and the date range. Resolves { url, rows, receivedAt } of the
// newest match; rejects with what it did see if none came.
async function findExportEmail({ user, appPassword, merchantIds, report, startDate, endDate, since, timeoutMs = 600000, pollMs = 15000 }) {
  if (!user || !appPassword) {
    throw new Error("exportEmailUser / exportEmailAppPassword missing in cypress.env.json - needed to read emailed exports.");
  }
  const stores = [...merchantIds].sort();
  const wanted = `${stores.join(", ")} / ${report} / ${startDate} to ${endDate}`;
  const isWanted = (d) =>
    d && d.report === report && d.startDate === startDate && d.endDate === endDate && d.merchantIds.join() === stores.join();
  const deadline = Date.now() + timeoutMs;
  let seen = [];

  while (Date.now() < deadline) {
    const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass: appPassword }, logger: false });
    await client.connect();
    const lock = await client.getMailboxLock(ALL_MAIL);
    try {
      const uids = await client.search({ from: SENDER, subject: SUBJECT, since: new Date(since - 24 * 3600 * 1000) }, { uid: true });
      const matches = [];
      seen = [];
      if (uids.length) {
        for await (const msg of client.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
          if (msg.internalDate.getTime() < since - 60000) continue;
          const mail = await simpleParser(msg.source);
          const text = htmlText(mail);
          seen.push(text.slice(0, 160));
          if (!isWanted(detailsOf(text))) continue;
          const link = [...(mail.html || "").matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].find((m) => /download/i.test(m[2].replace(/<[^>]+>/g, "")));
          const rows = (text.match(/Rows: (\d+)/) || [])[1];
          if (link) matches.push({ url: link[1].replace(/&amp;/g, "&"), rows: rows === undefined ? null : Number(rows), receivedAt: msg.internalDate.toISOString() });
        }
      }
      if (matches.length) return matches[matches.length - 1];
    } finally {
      lock.release();
      await client.logout();
    }
    await sleep(pollMs);
  }
  throw new Error(`No export email for "${wanted}" within ${Math.round(timeoutMs / 60000)} min. Export emails seen since the click: ${seen.length ? seen.join(" || ") : "none"}`);
}

module.exports = { findExportEmail };
