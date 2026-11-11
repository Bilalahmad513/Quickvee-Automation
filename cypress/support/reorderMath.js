// Shared number helpers, date-range math and measure rules for the Reorder
// Report - New checks. Used by the assertive QA Checks specs so they stay
// consistent with the QA Testing 02 report spec. Pure functions, no Cypress.

const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,%\s]/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
};
const n0 = (v) => num(v) ?? 0;
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const close = (a, b, tol = 0.011) => a !== null && b !== null && a !== undefined && b !== undefined && Math.abs(a - b) <= tol;
const sumOf = (rows, k) => round2(rows.reduce((t, r) => t + n0(r[k]), 0));

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n, now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
function rangeDates(label) {
  const r = { Today: [0, 0], Yesterday: [1, 1], "Last 7 Days": [6, 0], "Last 30 Days": [29, 0] }[label];
  return { start: ymd(daysAgo(r[0])), end: ymd(daysAgo(r[1])), from: r[0], to: r[1], days: r[0] - r[1] + 1 };
}

const RANGES = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days"];
const MEASURES = ["All inventory", "On-hand-inventory", "Low inventory", "Out of stock"];
// What each Measure says it shows, so a returned row can be checked against it.
const MEASURE_RULES = {
  "All inventory": { test: () => true, text: "every product" },
  "On-hand-inventory": { test: (r) => n0(r.current_inventory) > 0, text: "current inventory > 0" },
  "Low inventory": { test: (r) => n0(r.current_inventory) <= n0(r.reorder_point), text: "current inventory ≤ reorder point" },
  "Out of stock": { test: (r) => n0(r.current_inventory) <= 0, text: "current inventory ≤ 0" },
};

// Totals the data rows should add up to, keyed by the reorder_totals field.
const SUM_KEYS = ["items_sold", "closing_inventory", "current_inventory", "inbound_inventory", "net_sale", "gross_profit", "sale_count", "cost_goods_sold", "inventory_cost", "return_count", "discount_value", "retail_value"];

const label = (r) => `${r.name} (#${r.product_id})`;

// The subset of rows (with sales) whose items sold, net sale and COGS add up
// to `diff` exactly - the rows a total leaves out. Capped at 20 rows so the
// 2^n search stays cheap. null when no subset matches.
function explainDiff(rows, diff) {
  const cand = rows.filter((r) => n0(r.items_sold) || n0(r.net_sale) || n0(r.cost_goods_sold)).slice(0, 20);
  const n = cand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let a = 0;
    let b = 0;
    let c = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        a += n0(cand[i].items_sold);
        b += n0(cand[i].net_sale);
        c += n0(cand[i].cost_goods_sold);
      }
    if (Math.abs(a - diff.items_sold) < 0.001 && Math.abs(b - diff.net_sale) < 0.011 && Math.abs(c - diff.cost_goods_sold) < 0.011) return cand.filter((_, i) => mask & (1 << i));
  }
  return null;
}

module.exports = { num, n0, round2, close, sumOf, rangeDates, RANGES, MEASURES, MEASURE_RULES, SUM_KEYS, label, explainDiff };
