// Stock Control > Purchase Order (/merchants/purchase-order), the "New
// Purchase Order" form (/purchase-order/add) and a PO's detail page
// (/purchase-order/<id>). Selectors taken from the live app on
// test.quickvee.us:
//   - Field labels are plain <span>s ("Order number*", "Supplier", ...);
//     the control sits in the label row's next sibling.
//   - Supplier: a custom picker (button.po-picker-filter-trigger showing
//     "No Vendor") whose menu (.po-vendor-picker-menu) has a "Search
//     vendors" box and button.po-dropdown-option rows (scrollable, loads
//     more on scroll).
//   - Stock Due: MUI date picker - "Choose date" button, today's cell is
//     role=gridcell with aria-current="date"; the input shows MM/DD/YYYY.
//   - Products: "Search or scan to add a product" opens a dialog titled "Add
//     items to PO" - or "Add items from <vendor>" once a supplier is picked,
//     so it is found by its search box (role=list of role=button rows,
//     "Add N to PO").
//     Each PO line then has input[data-po-field=quantity|cost] with
//     data-po-row=<index>; "Current inventory" is the cell before quantity
//     and "Total cost" the cell after cost.
//   - Detail page (/merchants/purchase-order/<po_id>, opened by the app
//     after Create PO): header "< Back", PO number, status pill; a "Receive"
//     button (aria-label) opens the "Receive units" dialog with "Receive
//     all remaining (N units)" and a "Receive N units" submit. The button
//     is gone once everything is received.
// Full notes: cypress/e2e/purchase-order/PO_FLOW_NOTES.md

const text = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STATUS = /\b(Received|Partial|Active|Draft|Cancelled)\b/;
const exactly = (s) => new RegExp(`^\\s*${escapeRegex(s)}\\s*$`, "i");

// "$1,234.50" -> 1234.5; "" -> null.
function moneyOf(value) {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return String(value).trim() === "" || Number.isNaN(n) ? null : n;
}

const pad = (n) => String(n).padStart(2, "0");
const mmddyyyy = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;

class PurchaseOrderPage {
  // The list page, then the "New Purchase Order" button.
  openAddForm() {
    cy.visit("/merchants/purchase-order");
    cy.contains("button", /New Purchase Order/i, { timeout: 30000 }).should("be.visible").click();
    cy.location("pathname", { timeout: 30000 }).should("include", "/purchase-order/add");
    // Every field stays disabled until the form has loaded.
    return cy.get('textarea[placeholder="Enter a note for this order"]', { timeout: 30000 }).should("be.enabled");
  }

  // The control area of the field labelled `label`.
  field(label) {
    return cy
      .contains("span", new RegExp(`^\\s*${escapeRegex(label)}\\s*\\*?\\s*$`), { timeout: 30000 })
      .parent()
      .next();
  }

  // The Location picker's text, e.g. "MONSTER01 · New York, MA".
  locationText() {
    return this.field("Location")
      .find("button.po-picker-filter-trigger")
      .should("not.contain.text", "Select a store")
      .invoke("text")
      .then((t) => t.replace(/\s+/g, " ").trim());
  }

  // Picks `name` in the Supplier picker: types it into "Search vendors"
  // (so a vendor far down the scrolling list is reachable) and clicks the
  // exact match.
  selectSupplier(name) {
    this.field("Supplier").find("button.po-picker-filter-trigger").click();
    cy.get(".po-vendor-picker-menu", { timeout: 15000 }).should("be.visible");
    cy.get('.po-vendor-picker-menu input[placeholder="Search vendors"]').clear().type(name);
    cy.contains(".po-vendor-picker-menu button.po-dropdown-option", exactly(name), { timeout: 30000 })
      .scrollIntoView()
      .click();
    return this.field("Supplier").find("button.po-picker-filter-trigger").should(($b) => {
      expect(text($b[0]).toLowerCase(), "Supplier picker shows the chosen vendor").to.equal(name.trim().toLowerCase());
    });
  }

  // Opens the date picker (it opens on the current month) and clicks the
  // cell the picker marks as today; checks that cell really is today and
  // that the input then shows today as MM/DD/YYYY. Yields that text.
  selectStockDueToday() {
    const today = new Date();
    const expected = mmddyyyy(today);
    this.field("Stock Due").find('button[aria-label="Choose date"]').click();
    cy.get('button[role="gridcell"][aria-current="date"]', { timeout: 15000 })
      .should("be.visible")
      .and(($day) => {
        const stamp = new Date(Number($day.attr("data-timestamp")));
        expect(mmddyyyy(stamp), "date picker's highlighted 'today' cell").to.equal(expected);
        expect(text($day[0]), "today's day number").to.equal(String(today.getDate()));
      })
      .click();
    return this.field("Stock Due")
      .find('input[placeholder="MM/DD/YYYY"]')
      .should("have.value", expected)
      .invoke("val");
  }

  orderNumberInput() {
    return this.field("Order number").find("input").first();
  }

  // Types `value` unless the app already filled one in. Yields the value.
  fillOrderNumber(value) {
    return this.orderNumberInput().then(($input) => {
      const current = String($input.val() || "").trim();
      if (current) return current;
      cy.wrap($input).clear().type(value).should("have.value", value);
      return cy.wrap(value, { log: false });
    });
  }

  fillSupplierInvoice(value) {
    return cy.get('input[placeholder="Enter a Supplier Invoice Number"]').clear().type(value).should("have.value", value);
  }

  fillNote(value) {
    return cy.get('textarea[placeholder="Enter a note for this order"]').clear().type(value).should("have.value", value);
  }

  openProductPicker() {
    cy.contains("button", "Search or scan to add a product").click();
    return cy.get('[role="dialog"]:has(input[placeholder^="Search product"])', { timeout: 15000 }).should("be.visible");
  }

  searchProduct(term) {
    return cy
      .get('[role="dialog"] input[placeholder^="Search product"]')
      .clear()
      .type(term)
      .should("have.value", term);
  }

  // Clicks the result row whose title is exactly `title` and whose UPC line
  // has `upc`, then "Add 1 to PO".
  addProductFromPicker(title, upc) {
    cy.get('[role="dialog"]:has(input[placeholder^="Search product"]) [role="list"] [role="button"]', { timeout: 30000 })
      .filter((_, row) => {
        // The row's first <span> is an empty spacer - the title is a later one.
        const titled = [...row.querySelectorAll("span")].some((span) => text(span).toLowerCase() === title.trim().toLowerCase());
        return titled && text(row).includes(upc);
      })
      .should("have.length", 1)
      .click();
    return cy.contains('[role="dialog"]:has(input[placeholder^="Search product"]) button', /^\s*Add 1 to PO\s*$/).should("be.enabled").click();
  }

  closeProductPicker() {
    return cy.get('[role="dialog"]:has(input[placeholder^="Search product"]) button[aria-label="Close"]').click();
  }

  quantityInput(row = 0) {
    return cy.get(`input[data-po-field="quantity"][data-po-row="${row}"]`, { timeout: 30000 });
  }

  costInput(row = 0) {
    return cy.get(`input[data-po-field="cost"][data-po-row="${row}"]`, { timeout: 30000 });
  }

  // The PO line's product key, e.g. "16380217-upc-794024625958".
  lineVariantKey(row = 0) {
    return this.quantityInput(row).invoke("attr", "data-po-variant-key");
  }

  // "Current inventory" cell of the line (stock before the PO), as a number.
  lineCurrentInventory(row = 0) {
    return this.quantityInput(row)
      .parent()
      .prev()
      .invoke("text")
      .then((t) => moneyOf(t));
  }

  setLine(quantity, unitPrice, row = 0) {
    this.quantityInput(row).clear().type(String(quantity)).should("have.value", String(quantity));
    this.costInput(row).clear().type(unitPrice).blur();
    return this.costInput(row).should(($input) => expect(moneyOf($input.val()), "cost price").to.equal(Number(unitPrice)));
  }

  // The line's "Total cost" cell, e.g. 100 for "$100.00".
  lineTotalCost(row = 0) {
    return this.costInput(row)
      .parent()
      .parent()
      .next()
      .invoke("text")
      .then((t) => moneyOf(t));
  }

  createButton() {
    return cy.get('button[aria-label="Create PO"]');
  }

  // --- Detail page / list: where the PO's status shows ---

  // The PO's status as the page shows it, read straight from the DOM so it
  // works on whichever page the app is on (it can go back to the list by
  // itself after a receive - see PO_FLOW_NOTES.md):
  //   - detail page: header "< Back", the PO number, then the status pill;
  //   - list page: the row holding the PO number and a status pill.
  // Yields { page: "detail" | "list" | null, status, receiveButton }.
  statusOnPage(doc, poNumber) {
    const wanted = String(poNumber).trim().toLowerCase();
    const back = [...doc.querySelectorAll("button")].find((b) => /^back$/i.test(text(b)));
    const header = back && back.nextElementSibling;
    if (header && text(header).toLowerCase() === wanted) {
      const pill = [...back.parentElement.children].find((el) => el.tagName === "SPAN" && STATUS.test(text(el)));
      return {
        page: "detail",
        status: pill ? text(pill).match(STATUS)[1] : null,
        receiveButton: Boolean(doc.querySelector('button[aria-label="Receive"]')),
      };
    }
    const number = [...doc.querySelectorAll("a,div,span")].find((el) => !el.children.length && text(el).toLowerCase() === wanted);
    if (number) {
      let row = number.parentElement;
      while (row && !STATUS.test(text(row))) row = row.parentElement;
      if (row) return { page: "list", status: text(row).match(STATUS)[1], receiveButton: false };
    }
    return { page: null, status: null, receiveButton: false };
  }

  // Texts the form shows when something is wrong: toasts, and short
  // messages such as "Could not generate order number. Please try again."
  formMessages(doc) {
    const toasts = [...doc.querySelectorAll(".Toastify__toast")].map(text);
    const messages = [...doc.querySelectorAll("div,span,p")]
      .filter((el) => !el.children.length && /required|could not|please|invalid|must|already|duplicate|failed/i.test(text(el)))
      .map(text)
      .filter((t) => t.length < 160);
    return Cypress._.uniq([...toasts, ...messages]);
  }

  receiveButton() {
    return cy.get('button[aria-label="Receive"]', { timeout: 30000 });
  }

  openReceiveDialog() {
    this.receiveButton().should("be.enabled").click();
    return cy.get('[aria-label="Receive units"]', { timeout: 15000 }).should("be.visible");
  }

  // "Receive all remaining (N units)" then "Receive N units".
  receiveAll(quantity) {
    cy.contains('[aria-label="Receive units"] button', /Receive all remaining/)
      .should("contain.text", `(${quantity} units)`)
      .should("be.enabled")
      .click();
    return cy
      .contains('[aria-label="Receive units"] button', new RegExp(`^\\s*Receive ${quantity} units\\s*$`))
      .should("be.enabled")
      .click();
  }
}

module.exports = new PurchaseOrderPage();
module.exports.mmddyyyy = mmddyyyy;
module.exports.moneyOf = moneyOf;
