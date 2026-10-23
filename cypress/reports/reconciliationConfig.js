// Which stores and date ranges the reconciliation runs against. Defaults to
// the usual storeUnderTest and a few standard ranges; override from
// cypress.env.json (or --env) without touching code:
//   "reportStores": ["storeb", "monster04"]   (or "storeb,monster04")
//   "reportStartDate": "2026-10-01", "reportEndDate": "2026-10-15"

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function getStores() {
  const configured = Cypress.env("reportStores");
  if (Array.isArray(configured) && configured.length) return configured;
  if (typeof configured === "string" && configured.trim()) {
    return configured.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [Cypress.env("storeUnderTest")];
}

function range(label, start, end) {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  return { label, startDate, endDate, isCurrentPeriod: endDate === formatDate(new Date()) };
}

function getDateRanges() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const customStart = Cypress.env("reportStartDate");
  const customEnd = Cypress.env("reportEndDate");

  if (customStart && customEnd) {
    return [
      { label: "custom", startDate: customStart, endDate: customEnd, isCurrentPeriod: customEnd === formatDate(now) },
    ];
  }

  // new Date(year, month, 0) is the last day of the previous month, and
  // negative months roll back into the previous year - so January's "last
  // month" correctly becomes December of last year.
  return [
    range("today", now, now),
    range("yesterday", daysAgo(1), daysAgo(1)),
    range("last 7 days", daysAgo(6), now),
    range("this month", new Date(year, month, 1), now),
    range("last month", new Date(year, month - 1, 1), new Date(year, month, 0)),
    range("month before last", new Date(year, month - 2, 1), new Date(year, month - 1, 0)),
    range("this year", new Date(year, 0, 1), now),
  ];
}

module.exports = { getStores, getDateRanges };
