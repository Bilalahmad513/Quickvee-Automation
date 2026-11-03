const salesByOrderTypePage = require("../../pages/SalesByOrderTypePage");
const ordersPage = require("../../pages/OrdersPage");
const reportsApi = require("../../reports/ReportsApi");
const { getStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine } = require("../../reports/reconciliationReport");

// Checked one store at a time (the reportStores list in cypress.env.json -
// see reconciliationConfig.js), for each of these date filters - one test
// per store and filter. There's no all-stores check: the Orders page only
// ever shows the store you're in (no store picker), so there's nothing on
// it to compare the report's all-stores total with.
const STORES = getStores();
const RANGE_LABELS = ["today", "yesterday", "last month", "this year"];

const ORDER_LIST_API = "https://api-node.quickvee.us/orders-management-new-ui/order_list";

// The Online tab's Order Status filter as the check uses it: every status
// except "Accepted", "Refunded", "Cancelled" and "Failed" - the report
// doesn't count cancelled orders (confirmed live: Aug 2026's one cancelled
// online order was missing from it), and failed ones aren't sales either.
// The tab's default (Accepted, Packing, Ready, Out for Delivery) leaves out
// completed orders, so it would undercount.
const ONLINE_ORDER_STATUSES = ["Packing", "Ready", "Out for Delivery", "Delivered", "Picked Up"];

// "Packing, Ready, ..." -> sorted names, so the order the page sends them in
// doesn't matter.
const statusSet = (value) => (value || "").split(",").map((s) => s.trim()).filter(Boolean).sort();

// Fully refunded orders aren't counted on either side (partially refunded
// ones are). The report sends them as separate rows with no order type and
// $0 (confirmed live: Oct 2026 had 3 there for Store B) - those are left out
// of its total; `untyped` says how many.
function reportOrderCount(rows) {
  const [typed, untyped] = Cypress._.partition(rows, (row) => row.order_method !== "");
  return {
    total: Cypress._.sumBy(typed, (row) => Number(row.total_count)),
    untyped: Cypress._.sumBy(untyped, (row) => Number(row.total_count)),
  };
}

// Sets `range` on both tabs of the Orders page (and the Online tab's status
// filter) and yields the page's own order_list calls: { inStore, online }.
// The page is opened inside the step that waits for its call: it opens on
// today, so for "today" the call made on opening is the one wanted - picking
// the date it already shows may not reload anything. The list reloads after
// each date pick (two calls each time: all orders and refunded only), and
// after each status ticked, hence the calls to skip.
function captureOrderCalls(range, rangeLabel) {
  const isRange = (fields) => fields.start_date === range.startDate && fields.end_date === range.endDate;
  const calls = {};

  reportsApi
    .callAfter(
      ORDER_LIST_API,
      () => {
        ordersPage.visit();
        ordersPage.selectDates(range);
      },
      (fields) => fields.is_online === "0" && fields.list_type === "all_orders" && isRange(fields),
      `In-Store orders, ${rangeLabel}`,
      20
    )
    .then((call) => {
      calls.inStore = call;
    });

  ordersPage.selectOnlineOrders();
  reportsApi
    .callAfter(
      ORDER_LIST_API,
      () => {
        ordersPage.selectDates(range);
        ordersPage.selectOrderStatuses(ONLINE_ORDER_STATUSES);
      },
      (fields) =>
        fields.is_online === "1" &&
        fields.order_method === "All" &&
        isRange(fields) &&
        Cypress._.isEqual(statusSet(fields.orderStatus), [...ONLINE_ORDER_STATUSES].sort()),
      `Online orders (completed and in-progress statuses), ${rangeLabel}`,
      25
    )
    .then((call) => {
      calls.online = call;
    });

  return cy.then(() => calls);
}

// In-Store (all orders - fully refunded) + Online, from the calls
// captureOrderCalls() yielded: the page's own responses, plus its In-Store
// call sent again for the whole "Refunded Only" list.
//
// The "Refunded Only" list holds every order with any refund, partial ones
// too (confirmed live: Oct 2026 had 8 for Store B - 7 full, 1 partial). Full
// refunds are the ones whose status became Refunded (m_status "7", the same
// status the Online tab's "Refunded" filter shows); a partially refunded
// order keeps its normal status.
function storeOrderCounts(calls) {
  const counts = {
    inStoreAll: Number(calls.inStore.body.all_orders_count),
    online: Number(calls.online.body.all_order_count),
  };

  return reportsApi
    .resend(ORDER_LIST_API, calls.inStore, { list_type: "refunded_only", perpage: "1000", page: "1" })
    .then((refunded) => {
      expect(refunded.order_data, "every In-Store refunded order").to.have.length(Number(refunded.refunded_only_count));
      counts.inStoreFullyRefunded = refunded.order_data.filter((order) => order.m_status === "7").length;
      counts.inStore = counts.inStoreAll - counts.inStoreFullyRefunded;
      counts.total = counts.inStore + counts.online;
      return counts;
    });
}

const ordersLabel = (c) =>
  `In-Store (${c.inStoreAll} - ${c.inStoreFullyRefunded} fully refunded = ${c.inStore}) + Online (${c.online})`;

describe("Order Count Reconciliation", () => {
  const rowsByTest = {};

  before(() => {
    injectLogStyles();
  });

  // Retries re-run a test from the top - start each attempt with an empty
  // list for that test, so the HTML report only reflects its last attempt.
  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/order-count-reconciliation-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString(), "Order Count Reconciliation"));
    cy.task("log", `HTML report written to ${file}`);
  });

  // Logs one comparison and keeps it for the HTML report. The test asserts
  // once at the end (assertAllMatch), so every row gets logged first.
  function recordRow(title, store, range, reportLabel, report, ordersText, orders) {
    const row = {
      kind: "group",
      store,
      range,
      label: "Total Orders",
      format: "count",
      values: [
        { label: reportLabel, raw: report, amount: report },
        { label: `Orders ${ordersText}`, raw: orders, amount: orders },
      ],
      match: report === orders,
    };
    row.line = `[${store}] ${formatLine(row)}`;
    logRow(row);
    cy.task("log", row.line, { log: false });
    rowsByTest[title].push(row);
  }

  const assertAllMatch = (title) =>
    cy.then(() => {
      const mismatches = rowsByTest[title].filter((r) => !r.match);
      expect(mismatches, "\n" + mismatches.map((m) => m.line).join("\n")).to.be.empty;
    });

  // Each count is taken from the API call the page itself makes once its
  // filters are set, so it's exactly what that page shows.
  STORES.forEach((store) => {
    RANGE_LABELS.forEach((rangeLabel) => {
      it(`Sales by Order Type total orders = In-Store + Online orders for store: ${store} (${rangeLabel})`, function () {
        const title = this.test.title;
        const range = getDateRanges().find((r) => r.label === rangeLabel);
        const isRange = (fields) => fields.start_date === range.startDate && fields.end_date === range.endDate;
        let report;

        cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);

        reportsApi
          .reportCallAfter(
            "order_type_new_fact",
            () => {
              salesByOrderTypePage.visit();
              salesByOrderTypePage.selectDatesAndSearch(range);
            },
            isRange,
            `Sales by Order Type, ${rangeLabel}`
          )
          .then(({ body }) => {
            report = reportOrderCount(body.data.current);
          });

        captureOrderCalls(range, rangeLabel)
          .then((calls) => storeOrderCounts(calls))
          .then((orders) => {
            recordRow(
              title,
              store,
              range,
              `Sales by Order Type Total Orders (leaving out ${report.untyped} with no order type)`,
              report.total,
              ordersLabel(orders),
              orders.total
            );
          });

        assertAllMatch(title);
      });
    });
  });
});
