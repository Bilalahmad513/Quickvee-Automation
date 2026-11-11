// Cypress opens a fresh tab per spec FILE and closes it once that file's
// tests finish (which is why separate spec files kept losing their results
// tab, even with a spare blank tab keeping the browser process alive).
// Requiring both spec files here merges their `describe` blocks into a
// single spec/tab, so nothing closes between them and `--no-exit` can keep
// the one real results tab open at the end.
//
// "readOnlyTests": true (cypress.env.json or --env) leaves out the specs that
// create data - products, a category and storefront orders - for stores
// that must only be read.
//
// purchase-order/purchase-order-creation.cy.js is a WRITE (CUD) suite that
// only runs on test.quickvee.us, so it is never required here (this file
// runs against quickvee.com) - run it on its own: npm run test:purchase-order.
const readOnly = String(Cypress.env("readOnlyTests")) === "true";

require("./Authentication/login.cy.js");
require("./Authentication/store-view.cy.js");
if (!readOnly) {
  require("./Products & Catalog/add-product.cy.js");
  require("./Products & Catalog/add-category.cy.js");
  require("./Orders/storefront-search.cy.js");
  require("./Orders/new-product-order.cy.js");
}
// Read-only reconciliation suites (safe on quickvee.com): restored to
// cypress/e2e/reports/ with their helpers in cypress/reports/.
require("./reports/report-reconciliation.cy.js");
require("./reports/category-reconciliation.cy.js");
