// Cypress opens a fresh tab per spec FILE and closes it once that file's
// tests finish (which is why separate spec files kept losing their results
// tab, even with a spare blank tab keeping the browser process alive).
// Requiring both spec files here merges their `describe` blocks into a
// single spec/tab, so nothing closes between them and `--no-exit` can keep
// the one real results tab open at the end.
require("./login.cy.js");
require("./store-view.cy.js");
require("./add-product.cy.js");
require("./add-category.cy.js");
