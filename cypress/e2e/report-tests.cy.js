// The report checks - they only read data, never create any - merged into
// one spec/tab, same as all-tests.cy.js. Stores come from reportStores and
// reportAllStoresStores (cypress.env.json).
require("./reports/report-reconciliation.cy.js");
require("./reports/category-reconciliation.cy.js");
require("./reports/order-count-reconciliation.cy.js");
require("./reports/item-sold-export.cy.js");
