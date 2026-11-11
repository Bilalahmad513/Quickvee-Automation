// The tests that create data (products, categories, an order) in
// storeUnderTest, plus the login/store-view checks they build on - merged
// into one spec/tab, same as all-tests.cy.js. Each of them enters the store
// via cy.enterDataStore(), which refuses any store not in the dataStores
// list (cypress.env.json).
require("./Authentication/login.cy.js");
require("./Authentication/store-view.cy.js");
require("./Products & Catalog/add-product.cy.js");
require("./Products & Catalog/add-category.cy.js");
require("./Orders/storefront-search.cy.js");
require("./Orders/new-product-order.cy.js");
