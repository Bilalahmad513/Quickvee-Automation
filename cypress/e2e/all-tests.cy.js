// Cypress opens a fresh tab per spec FILE and closes it once that file's
// tests finish (which is why separate spec files kept losing their results
// tab, even with a spare blank tab keeping the browser process alive).
// Requiring both spec files here merges their `describe` blocks into a
// single spec/tab, so nothing closes between them and `--no-exit` can keep
// the one real results tab open at the end.
//
// Data-creating tests first, report checks after - so the reports' "Today"
// also covers the orders this run just placed.
require("./data-tests.cy.js");
require("./report-tests.cy.js");
