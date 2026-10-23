class StorefrontPage {
  // The admin header's "View Online Store" link is a `target="_blank"`
  // anchor - Cypress can only drive one tab, so rather than clicking it (and
  // losing control of the new tab), this grabs its href and visits it
  // directly in the current tab. The merchant id embedded in that URL
  // (.../merchant/<id>?orderMethod=...) is handed back so later steps (like
  // querying the product API) don't need it hardcoded per store.
  visitViaOnlineStoreLink() {
    return cy
      .contains("View Online Store", { timeout: 15000 })
      .invoke("attr", "href")
      .then((href) => {
        const merchantId = new URL(href).pathname.split("/").filter(Boolean).pop();
        return cy
          .visit(href, { failOnStatusCode: false })
          .then(() => this.ensureCustomerLoggedOut())
          .then(() => this.dismissAgeVerification())
          .then(() => merchantId);
      });
  }

  // A customer session from an earlier run can still be logged in here
  // (cookies persist in this browser profile across separate runs), which
  // skips the "Checkout with Login" step entirely further down the flow -
  // confirmed live. Clearing cookies/storage and reloading guarantees a
  // guest session, so checkout always actually exercises the login step.
  ensureCustomerLoggedOut() {
    cy.clearCookies();
    cy.clearLocalStorage();
    return cy.reload();
  }

  // An "Age Verification" modal covers the whole page (including the search
  // box) on first landing - confirmed live it blocks any interaction until
  // dismissed. Only appears sometimes (presumably once per
  // session/cookie), so this is a no-op when it's not there.
  dismissAgeVerification() {
    cy.wait(1500);
    return cy.get("body").then(($body) => {
      if ($body.find(".age_popup_black_btn").length > 0) {
        return cy.get(".age_popup_black_btn").click();
      }
    });
  }

  // The storefront's own product search/listing is backed by this
  // elasticsearch-fronted API - confirmed live by intercepting the real
  // request the page itself makes. It strictly requires multipart/form-data
  // (a plain `cy.request({form: true})`, which sends urlencoded, gets a 400
  // "Invalid Content-Type"), so the multipart body is built by hand here to
  // match exactly what the real page sends.
  fetchNewestProducts(merchantId) {
    const boundary = "----CypressBoundary" + Date.now() + Cypress._.random(0, 99999);
    const fields = {
      merchant_id: merchantId,
      orderMethod: "pickup",
      offset: "0",
      limit: "20",
      filter_by: "newest",
      sort_by: "DESC",
      sort_type: "newest",
    };
    const body =
      Object.entries(fields)
        .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
        .join("") + `--${boundary}--\r\n`;

    return cy
      .request({
        method: "POST",
        url: "https://elasticsearch.quickvee.us/Product_api_react/merchant-products",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
      })
      .then((res) => Object.values(res.body.result.all_product).flat());
  }

  fetchRandomProductName(merchantId) {
    return this.fetchNewestProducts(merchantId).then((allProducts) => Cypress._.sample(allProducts).title);
  }

  searchProduct(name) {
    return cy.get('input[placeholder="Search Product"]').clear().type(name);
  }

  // A product just created in admin doesn't show up in the search
  // autocomplete instantly - confirmed live this is real network/indexing
  // latency, not a missing admin-side step (Sync, stock, etc. were all ruled
  // out first). Polling the merchant-products listing API (what
  // fetchNewestProducts/fetchRandomProductName use) turned out to be the
  // wrong ground truth here - confirmed live that listing's "newest" sort
  // doesn't reliably surface a brand-new product at all, while the real
  // search box found the same product within under a minute. So this drives
  // the actual search box instead, which is what a real customer depends on -
  // retyping the name each attempt since the dropdown only refetches on
  // input change, not on its own. Recurses via cy.then() since Cypress
  // commands can't be awaited in a real loop.
  waitForProductSearchable(productName, { timeoutMs = 300000, pollIntervalMs = 5000 } = {}, _startedAt) {
    const startedAt = _startedAt || Date.now();
    this.searchProduct(productName);
    return cy.wait(1500).then(() =>
      cy.get("body").then(($body) => {
        const found = $body
          .find(".home-search-items")
          .toArray()
          .some((el) => el.innerText.includes(productName));
        if (found) return true;
        if (Date.now() - startedAt >= timeoutMs) return false;
        return cy
          .wait(pollIntervalMs)
          .then(() => this.waitForProductSearchable(productName, { timeoutMs, pollIntervalMs }, startedAt));
      })
    );
  }

  // Typing into the search box surfaces a live autocomplete dropdown whose
  // matched text is wrapped in a bare <strong> with no link of its own -
  // clicking that text directly was confirmed live to be unreliable (lands on
  // the right product only sometimes). The dropdown row's own wrapping
  // container (.home-search-items) is the actual clickable element and
  // navigates correctly every time.
  selectSearchResult(productName) {
    return cy.contains(".home-search-items", productName).click();
  }
}

module.exports = new StorefrontPage();
