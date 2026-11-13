// The tests that create data (products, categories, an order) in
// storeUnderTest, plus the login/store-view checks they build on - merged
// into one spec/tab, same as all-tests.cy.js. Each of them enters the store
// via cy.enterDataStore(), which refuses any store not in the dataStores
// list (cypress.env.json).
require("./login.cy.js");
require("./store-view.cy.js");
require("./add-product.cy.js");
require("./add-category.cy.js");
require("./edit-product.cy.js");
require("./storefront-search.cy.js");
require("./new-product-order.cy.js");
