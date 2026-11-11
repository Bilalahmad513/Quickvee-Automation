const itemSoldReportPage = require("../../pages/ItemSoldReportPage");
const reportsApi = require("../../reports/ReportsApi");
const { getStores, getAllStoresStores, getDateRanges } = require("../../reports/reconciliationConfig");
const { buildHtml, injectLogStyles, logRow, formatLine, assertNoMismatches } = require("../../reports/reconciliationReport");

// The Item Sold Report's search box and Category / Brand / Tag filters, and
// how it puts items together with every store selected. Each filter is
// checked against the report's own unfiltered list for the same store and
// dates: the rows it shows must be exactly the items that match - nothing
// extra, nothing missing - and the page's "All N items" and Total row must
// agree. Only reads data.
//
// Rules (from the user, 5 Nov 2026):
// - Search by part of a name: every item with that text anywhere in its
//   name (or UPC), any case. By the full name: that item only (exact match).
//   By UPC: that item.
// - Several values in one filter (two categories): items in either one.
//   Different filters together (category + brand + tag): items in all.
// - All stores selected: one row per UPC, its figures added up over the
//   stores, under any one of the stores' names for it. The same name with
//   different UPCs stays as separate rows.
//
// Stores: reportStores one at a time (the filters), reportAllStoresStores
// with every store selected (the UPC grouping). Stores whose account doesn't
// have the Item Sold Report are left out, as in item-sold-export.cy.js.
const STORES_WITHOUT_ITEM_SOLD_REPORT = ["jenny smoke shop"];
const STORES = getStores().filter((store) => !STORES_WITHOUT_ITEM_SOLD_REPORT.includes(store));
const ALL_STORES_STORES = getAllStoresStores();

// A full month, so there are enough items, categories, brands and tags to
// pick from (confirmed live: storeb, Oct 2026 = 143 items).
const RANGE_LABEL = "last month";

const ITEMS_API = "https://reports-api.quickvee.us/api/reports/items_sales_report_api";

// The page asks for 10 rows at a time; the checks need every row.
const PAGE_SIZE = 500;
const MAX_PAGES = 50;

// An item's identity in the report: its UPC. Items without one (Custom
// Item, Lottery Payout - not real products) are put together by name instead
// (confirmed live, all stores: Custom Item 1 = 5 + 4 sold in two stores).
const keyOf = (item) => (item.upc ? item.upc : `name:${(item.name || "").trim().toLowerCase()}`);
const tagsOf = (item) =>
  (item.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
const lower = (text) => (text || "").toLowerCase();
const cents = (n) => Math.round(Number(n || 0) * 100);
const idsOf = (value) => (value || "").split(",").filter(Boolean);

// Values, most items first.
function mostCommon(values) {
  const counts = Cypress._.countBy(values.filter(Boolean));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

// The best-selling item with a UPC and a name (the list comes sorted by
// sales, highest first).
const topItem = (items) => items.find((i) => i.upc && (i.name || "").trim());

// What each test filters by, chosen from the store's own unfiltered list so
// the filter always has items to show. `null` = nothing to pick (e.g. no
// item with a brand that month) - the test is skipped.
const FILTER_CASES = [
  {
    name: "search by part of an item name, in capitals",
    // A word from the middle/end of the name (not only its start), typed in
    // capitals - e.g. "Yoga Mat 79067" -> "MAT".
    choose: (items) => {
      const item = topItem(items);
      const words = item ? item.name.trim().split(/\s+/).filter((w) => w.length >= 3 && /[a-z]/i.test(w)) : [];
      return words.length ? { search: words[words.length > 1 ? 1 : 0].toUpperCase() } : null;
    },
  },
  {
    name: "search by full item name (exact match)",
    choose: (items) => {
      const item = topItem(items);
      return item ? { search: item.name.trim(), exactName: true } : null;
    },
  },
  {
    name: "search by UPC",
    choose: (items) => {
      const item = topItem(items);
      return item ? { search: item.upc } : null;
    },
  },
  {
    name: "one category",
    choose: (items) => {
      const [category] = mostCommon(items.map((i) => i.category_name));
      return category ? { categories: [category] } : null;
    },
  },
  {
    name: "two categories (items in either)",
    choose: (items) => {
      const categories = mostCommon(items.map((i) => i.category_name));
      return categories.length >= 2 ? { categories: categories.slice(0, 2) } : null;
    },
  },
  {
    name: "one brand",
    choose: (items) => {
      const [brand] = mostCommon(items.map((i) => i.brand));
      return brand ? { brands: [brand] } : null;
    },
  },
  {
    name: "one tag",
    choose: (items) => {
      const [tag] = mostCommon(items.flatMap(tagsOf));
      return tag ? { tags: [tag] } : null;
    },
  },
  {
    name: "category + brand + tag together (items in all three)",
    choose: (items) => {
      const item = items.find((i) => i.category_name && i.brand && tagsOf(i).length);
      return item ? { categories: [item.category_name], brands: [item.brand], tags: [tagsOf(item)[0]] } : null;
    },
  },
];

// e.g. 'search "MAT"', 'Category: ABC, Quickadd + Brand: sunmi'
function describeChoice(choice) {
  const parts = [];
  if (choice.search !== undefined) parts.push(`search "${choice.search}"${choice.exactName ? " (full name)" : ""}`);
  if (choice.categories) parts.push(`Category: ${choice.categories.join(", ")}`);
  if (choice.brands) parts.push(`Brand: ${choice.brands.join(", ")}`);
  if (choice.tags) parts.push(`Tag: ${choice.tags.join(", ")}`);
  return parts.join(" + ");
}

// Whether `item` should be shown under `choice` - the rules at the top.
function matchesChoice(item, choice) {
  if (choice.search !== undefined) {
    const text = lower(choice.search);
    const found = choice.exactName
      ? lower(item.name).trim() === text
      : lower(item.name).includes(text) || lower(item.upc).includes(text);
    if (!found) return false;
  }
  if (choice.categories && !choice.categories.includes(item.category_name)) return false;
  if (choice.brands && !choice.brands.includes(item.brand)) return false;
  if (choice.tags && !tagsOf(item).some((t) => choice.tags.includes(t))) return false;
  return true;
}

// Whether a call the page made is the one for the whole `choice` - every
// keystroke and every tick makes its own call, so the earlier ones are
// skipped. Several values are sent comma-separated ("ABC,Quickadd").
function isCallFor(fields, choice) {
  const sameList = (sent, wanted) => Cypress._.isEqual(idsOf(sent).sort(), [...(wanted || [])].sort());
  return (
    (fields.search_by || "") === (choice.search || "") &&
    sameList(fields.cat_name, choice.categories) &&
    sameList(fields.search_by_brand, choice.brands) &&
    sameList(fields.search_by_tag, choice.tags)
  );
}

const noFilters = (fields) => !fields.search_by && !fields.cat_name && !fields.search_by_brand && !fields.search_by_tag;

// Every row of a call the page made (as yielded by callAfter), page by page.
function fetchEveryRow(call, overrides = {}, page = 1, rows = []) {
  return reportsApi.resend(ITEMS_API, call, { ...overrides, page: String(page), page_size: String(PAGE_SIZE) }).then((body) => {
    const all = rows.concat(body.item_sale_data || []);
    if (body.has_more && page < MAX_PAGES) return fetchEveryRow(call, overrides, page + 1, all);
    expect(all.length, `every row fetched (total_items ${body.total_items})`).to.equal(Number(body.total_items));
    return all;
  });
}

// Item names for a mismatch line: 'Yoga Mat 79067 (907774263766), nut ...'.
const namesOf = (items, max = 5) =>
  items
    .slice(0, max)
    .map((i) => `${(i.name || "").trim()} (${i.upc || "no UPC"})`)
    .join(", ") + (items.length > max ? `, +${items.length - max} more` : "");

describe("Item Sold Report Filters", () => {
  const rowsByTest = {};
  const range = () => getDateRanges().find((r) => r.label === RANGE_LABEL);

  before(() => {
    injectLogStyles();
  });

  beforeEach(function () {
    rowsByTest[this.currentTest.title] = [];
  });

  after(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
      `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const file = `cypress/reports-output/item-sold-filters-${stamp}.html`;

    cy.writeFile(file, buildHtml(Object.values(rowsByTest).flat(), now.toLocaleString(), "Item Sold Report Filters"));
    cy.task("log", `HTML report written to ${file}`);
  });

  // One check: `values` ({ label, amount }) must all be equal, in whole cents.
  function record(title, storeLabel, label, format, values) {
    const amounts = values.map((v) => (v.amount === null ? null : cents(v.amount)));
    const row = {
      kind: "group",
      store: storeLabel,
      range: range(),
      label,
      format,
      values: values.map((v) => ({ ...v, raw: v.amount })),
      match: amounts.every((a) => a !== null && a === amounts[0]),
    };
    row.line = `[${storeLabel}] ${formatLine(row)}`;
    logRow(row);
    cy.task("log", row.line, { log: false });
    rowsByTest[title].push(row);
  }

  function assertAllMatched(title) {
    cy.then(() => {
      const rows = rowsByTest[title];
      const mismatches = rows.filter((r) => !r.match);
      expect(rows, "checks run").to.not.be.empty;
      assertNoMismatches(mismatches);
    });
  }

  // Opens the report inside `store`, picks the stores and the dates, and
  // yields { call, items }: the page's own call (no filters yet) and every
  // row it covers.
  function openReport(store, storeLabel, chooseStores, isWantedStores) {
    const { startDate, endDate } = range();
    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), store);
    itemSoldReportPage.visit().then((available) => {
      expect(available, `Item Sold Report available in ${storeLabel}`).to.equal(true);
    });
    return reportsApi
      .callAfter(
        ITEMS_API,
        () => {
          chooseStores();
          itemSoldReportPage.selectDates(range());
        },
        (fields) => fields.start_date === startDate && fields.end_date === endDate && isWantedStores(fields) && noFilters(fields),
        `Item Sold Report for ${storeLabel}, ${RANGE_LABEL}`
      )
      .then((call) => fetchEveryRow(call).then((items) => ({ call, items })));
  }

  // The page's "All N items matching filters" and Total row, once it shows
  // `count` items.
  function pageTotals(count) {
    cy.contains(new RegExp(`All ${count} items? matching filters`), { timeout: 15000 });
    return itemSoldReportPage.totalRow();
  }

  // One store selected: the store's unfiltered list, then the filter from
  // `filterCase`, checked against that list.
  function checkFilter(test, title, store, filterCase) {
    let items;
    let choice;
    let shown;
    let totals;

    openReport(store, store, () => itemSoldReportPage.selectCurrentStoreOnly(), (f) => f.outlet_ids === f.merchant_id).then((report) => {
      items = report.items;
      choice = filterCase.choose(items);
      if (!choice) {
        cy.task("log", `[${store}] ${filterCase.name}: nothing to pick from in ${RANGE_LABEL} - skipped`, { log: false });
        test.skip();
      }
    });

    cy.then(() =>
      reportsApi.callAfter(
        ITEMS_API,
        () => {
          if (choice.search !== undefined) itemSoldReportPage.search(choice.search);
          if (choice.categories) itemSoldReportPage.selectFilterOptions("Category", choice.categories);
          if (choice.brands) itemSoldReportPage.selectFilterOptions("Brand", choice.brands);
          if (choice.tags) itemSoldReportPage.selectFilterOptions("Tag", choice.tags);
        },
        (fields) => isCallFor(fields, choice),
        `Item Sold Report filtered by ${describeChoice(choice)}`,
        40
      )
    )
      .then((call) => fetchEveryRow(call))
      .then((rows) => {
        shown = rows;
      });
    cy.then(() => pageTotals(shown.length)).then((t) => {
      totals = t;
    });

    cy.then(() => {
      const what = describeChoice(choice);
      const expected = items.filter((i) => matchesChoice(i, choice));
      const shownKeys = new Set(shown.map(keyOf));
      const expectedKeys = new Set(expected.map(keyOf));
      const wrong = shown.filter((r) => !matchesChoice(r, choice));
      const missing = expected.filter((i) => !shownKeys.has(keyOf(i)));
      const extra = shown.filter((r) => !expectedKeys.has(keyOf(r)) && matchesChoice(r, choice));

      cy.task("log", `[${store}] ${what}: ${shown.length} rows - ${namesOf(shown, 10)}`, { log: false });
      record(title, store, `${what} · Items`, "count", [
        { label: "Matching items in the unfiltered list", amount: expected.length },
        { label: "Rows shown", amount: shown.length },
        { label: 'Page "All N items"', amount: totals.items },
      ]);
      record(title, store, `${what} · Rows that don't match the filter${wrong.length ? `: ${namesOf(wrong)}` : ""}`, "count", [
        { label: "Rows shown", amount: wrong.length },
        { label: "Expected", amount: 0 },
      ]);
      record(title, store, `${what} · Matching items missing${missing.length ? `: ${namesOf(missing)}` : ""}`, "count", [
        { label: "Items", amount: missing.length },
        { label: "Expected", amount: 0 },
      ]);
      if (extra.length) {
        // Match the filter by their own fields but weren't in the
        // unfiltered list at all.
        record(title, store, `${what} · Rows not in the unfiltered list: ${namesOf(extra)}`, "count", [
          { label: "Rows", amount: extra.length },
          { label: "Expected", amount: 0 },
        ]);
      }
      record(title, store, `${what} · Sold`, "count", [
        { label: "Matching items added up", amount: Cypress._.sumBy(expected, (i) => Number(i.total_qty)) },
        { label: "Page Total row", amount: totals.Sold },
      ]);
      record(title, store, `${what} · Subtotal`, "money", [
        { label: "Matching items added up", amount: Cypress._.sumBy(expected, (i) => cents(i.total_price)) / 100 },
        { label: "Page Total row", amount: totals.Subtotal },
      ]);
    });

    assertAllMatched(title);
  }

  STORES.forEach((store) => {
    FILTER_CASES.forEach((filterCase) => {
      it(`Item Sold Report filter: ${filterCase.name} for store: ${store} (${RANGE_LABEL})`, function () {
        checkFilter(this, this.test.title, store, filterCase);
      });
    });
  });

  // Opens the report in `store` with every store selected and loads every
  // row, plus each store's own rows (the same call, one store at a time).
  // Yields { storeIds, allRows, perStore, totals, expected, rowsByKey }:
  // `expected` = the stores' items put together by UPC, as the page should
  // (key -> { upc, names, stores, qty, subtotal, net, cost } in cents);
  // `rowsByKey` = the all-stores rows by the same key.
  function loadAllStores(store, storeLabel) {
    const data = { perStore: {} };
    openReport(
      store,
      storeLabel,
      () => itemSoldReportPage.selectAllStores(),
      (f) => idsOf(f.outlet_ids).length > 1 && idsOf(f.outlet_ids).includes(f.merchant_id)
    ).then(({ call, items }) => {
      data.allRows = items;
      data.storeIds = idsOf(call.fields.outlet_ids);
      // Names the selected stores (see ReportsApi.storesLabel).
      reportsApi.storesLabel(data.storeIds).then((label) => (data.storeLabel = label));
      data.storeIds.forEach((id) =>
        fetchEveryRow(call, { outlet_ids: id }).then((rows) => {
          data.perStore[id] = rows;
        })
      );
    });
    cy.then(() => pageTotals(data.allRows.length)).then((t) => {
      data.totals = t;
    });
    cy.then(() => {
      data.expected = new Map();
      data.storeIds.forEach((id) =>
        data.perStore[id].forEach((item) => {
          const key = keyOf(item);
          const e = data.expected.get(key) || { key, upc: item.upc, names: new Set(), stores: new Set(), qty: 0, subtotal: 0, net: 0, cost: 0 };
          e.names.add((item.name || "").trim());
          e.stores.add(id);
          e.qty += Number(item.total_qty);
          e.subtotal += cents(item.total_price);
          e.net += cents(item.discount_price);
          e.cost += cents(item.cost);
          data.expected.set(key, e);
        })
      );
      data.rowsByKey = Cypress._.groupBy(data.allRows, keyOf);
      cy.task(
        "log",
        `[${data.storeLabel}] stores ${data.storeIds.join(", ")}: ${data.allRows.length} rows, ` +
          `${[...data.expected.values()].filter((e) => e.stores.size > 1).length} UPCs sold in more than one store`,
        { log: false }
      );
    });
    // Its own step: a cy.then that runs commands can't also yield a value.
    return cy.then(() => data);
  }

  const asItems = (groups) => groups.map((e) => ({ name: [...e.names].join(" / "), upc: e.upc }));
  const rowName = (row) => (row.name || "").trim();

  ALL_STORES_STORES.forEach((store) => {
    const storeLabel = `${store} + all stores`;

    // Every store selected: the rows must be each store's own items put
    // together by UPC.
    it(`Item Sold Report with all stores selected = each store's items grouped by UPC for: ${store} (${RANGE_LABEL})`, function () {
      const title = this.test.title;

      loadAllStores(store, storeLabel).then(({ allRows, totals, expected, rowsByKey, storeLabel }) => {
        const repeated = Object.keys(rowsByKey).filter((k) => rowsByKey[k].length > 1).map((k) => rowsByKey[k][0]);
        const missing = [...expected.values()].filter((e) => !rowsByKey[e.key]);
        const extra = allRows.filter((r) => !expected.has(keyOf(r)));
        const wrongTotals = [...expected.values()].filter((e) => {
          const row = (rowsByKey[e.key] || [])[0];
          return (
            row &&
            (Number(row.total_qty) !== e.qty || cents(row.total_price) !== e.subtotal || cents(row.discount_price) !== e.net || cents(row.cost) !== e.cost)
          );
        });
        const wrongName = allRows.filter((r) => expected.has(keyOf(r)) && !expected.get(keyOf(r)).names.has(rowName(r)));

        record(title, storeLabel, "Rows (one per UPC)", "count", [
          { label: "Stores' items grouped by UPC", amount: expected.size },
          { label: "All-stores rows", amount: allRows.length },
          { label: 'Page "All N items"', amount: totals.items },
        ]);
        record(title, storeLabel, `UPCs in more than one row${repeated.length ? `: ${namesOf(repeated)}` : ""}`, "count", [
          { label: "All-stores rows", amount: repeated.length },
          { label: "Expected", amount: 0 },
        ]);
        record(title, storeLabel, `Items missing / extra${missing.length || extra.length ? `: missing ${namesOf(asItems(missing))}; extra ${namesOf(extra)}` : ""}`, "count", [
          { label: "Missing + extra", amount: missing.length + extra.length },
          { label: "Expected", amount: 0 },
        ]);
        record(title, storeLabel, `UPCs whose figures ≠ the stores' added up (Sold, Subtotal, Subtotal w/ Discounts, Cost)${wrongTotals.length ? `: ${namesOf(asItems(wrongTotals))}` : ""}`, "count", [
          { label: "UPCs", amount: wrongTotals.length },
          { label: "Expected", amount: 0 },
        ]);
        record(title, storeLabel, `Rows named differently from every store${wrongName.length ? `: ${namesOf(wrongName)}` : ""}`, "count", [
          { label: "Rows", amount: wrongName.length },
          { label: "Expected", amount: 0 },
        ]);
        record(title, storeLabel, "Sold", "count", [
          { label: "Stores added up", amount: Cypress._.sumBy([...expected.values()], "qty") },
          { label: "Page Total row", amount: totals.Sold },
        ]);
        record(title, storeLabel, "Subtotal", "money", [
          { label: "Stores added up", amount: Cypress._.sumBy([...expected.values()], "subtotal") / 100 },
          { label: "Page Total row", amount: totals.Subtotal },
        ]);
      });

      assertAllMatched(title);
    });

    // The same item name with different UPCs (in one store or across
    // stores) must stay as separate rows - one per UPC, each with its own
    // figures. One check per such name, e.g. "test 1" (143168483234,
    // 970488829669). Skipped if no name has more than one UPC that month.
    it(`Item Sold Report with all stores selected: same item name with different UPCs = separate rows for: ${store} (${RANGE_LABEL})`, function () {
      const title = this.test.title;
      const test = this;

      loadAllStores(store, storeLabel).then(({ expected, rowsByKey, storeLabel }) => {
        const groupsByName = {};
        expected.forEach((e) =>
          e.names.forEach((name) => {
            const key = name.toLowerCase();
            groupsByName[key] = groupsByName[key] || { name, groups: new Map() };
            groupsByName[key].groups.set(e.key, e);
          })
        );
        const sameName = Object.values(groupsByName).filter((n) => n.groups.size > 1);
        if (!sameName.length) {
          cy.task("log", `[${storeLabel}] no item name with more than one UPC in ${RANGE_LABEL} - skipped`, { log: false });
          test.skip();
        }

        sameName.forEach(({ name, groups }) => {
          const list = [...groups.values()];
          const rows = list.flatMap((e) => rowsByKey[e.key] || []);
          const upcs = list.map((e) => e.upc || "no UPC").join(", ");
          record(title, storeLabel, `"${name}" (UPCs ${upcs}) → separate rows`, "count", [
            { label: "Different UPCs", amount: list.length },
            { label: "All-stores rows", amount: rows.length },
          ]);
          // Kept apart, not added together: each UPC's row has only its own
          // stores' figures.
          list.forEach((e) => {
            const row = (rowsByKey[e.key] || [])[0];
            record(title, storeLabel, `"${name}" (UPC ${e.upc || "no UPC"}) · Sold`, "count", [
              { label: "This UPC in its stores", amount: e.qty },
              { label: "Its all-stores row", amount: row ? Number(row.total_qty) : null },
            ]);
          });
        });
      });

      assertAllMatched(title);
    });

    // The same UPC under different names in different stores must be one
    // row, its figures added up, under one of those names.
    it(`Item Sold Report with all stores selected: same UPC with different item names = one row for: ${store} (${RANGE_LABEL})`, function () {
      const title = this.test.title;
      const test = this;

      loadAllStores(store, storeLabel).then(({ expected, rowsByKey, storeLabel }) => {
        const shared = [...expected.values()].filter((e) => e.upc && e.names.size > 1);
        if (!shared.length) {
          cy.task("log", `[${storeLabel}] no UPC under more than one name in ${RANGE_LABEL} - skipped`, { log: false });
          test.skip();
        }

        shared.forEach((e) => {
          const rows = rowsByKey[e.key] || [];
          const names = [...e.names].map((n) => `"${n}"`).join(" / ");
          record(title, storeLabel, `UPC ${e.upc}: ${names} → one row`, "count", [
            { label: "All-stores rows", amount: rows.length },
            { label: "Expected", amount: 1 },
          ]);
          record(title, storeLabel, `UPC ${e.upc}: row's name${rows[0] ? ` "${rowName(rows[0])}"` : ""} is one of the stores' names`, "count", [
            { label: "Row name from a store", amount: rows[0] && e.names.has(rowName(rows[0])) ? 1 : 0 },
            { label: "Expected", amount: 1 },
          ]);
          record(title, storeLabel, `UPC ${e.upc}: ${names} · Sold`, "count", [
            { label: `Stores added up (${e.stores.size})`, amount: e.qty },
            { label: "The one row", amount: rows[0] ? Number(rows[0].total_qty) : null },
          ]);
          record(title, storeLabel, `UPC ${e.upc}: ${names} · Subtotal`, "money", [
            { label: `Stores added up (${e.stores.size})`, amount: e.subtotal / 100 },
            { label: "The one row", amount: rows[0] ? Number(rows[0].total_price) : null },
          ]);
        });
      });

      assertAllMatched(title);
    });
  });
});
