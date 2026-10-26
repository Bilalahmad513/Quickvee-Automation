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

// isCurrentPeriod: the range includes today.
function range(label, start, end) {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  const today = formatDate(new Date());
  return { label, startDate, endDate, isCurrentPeriod: startDate <= today && today <= endDate };
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
    range("day before yesterday", daysAgo(2), daysAgo(2)),
    range("this month", new Date(year, month, 1), now),
    range("last month", new Date(year, month - 1, 1), new Date(year, month, 0)),
    range("before last month", new Date(year, month - 2, 1), new Date(year, month - 1, 0)),
    range("this year", new Date(year, 0, 1), now),
  ];
}

module.exports = { getStores, getDateRanges };
