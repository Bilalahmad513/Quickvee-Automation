# Cypress Automation — Kya Bana Hai, Kaise Kaam Karta Hai

Yeh file is `cypress-automation` project ka poora walkthrough hai — har file kyun bani, kya karti hai, aur jo bugs raaste mein aaye unki asal wajah kya thi. Maqsad: aap khud is code ko dekh kar samajh sakein aur aage khud extend kar sakein.

Yeh guide project ke shuru (sirf login + store-view) se lekar ab tak (product creation, storefront order placement, admin order verification/pickup, aur reports ke numbers aapas mein match karne wala "report reconciliation" framework) ka poora safar cover karta hai.

---

## 1. Folder Structure

```
cypress-automation/
├── cypress.config.js            → Cypress ki settings (baseUrl, viewport, video, browser flags)
├── cypress.env.json              → Asal credentials + report stores (gitignored, kabhi commit nahi hoti)
├── cypress.env.json.example      → Credentials file ka sirf shape/placeholder (version-controlled)
├── package.json                  → npm scripts (kaunsa command kya chalata hai)
├── scripts/
│   └── run-cypress.js            → Cypress chalane se pehle ek zaroori environment fix
└── cypress/
    ├── e2e/                      → Asal test cases (spec files)
    │   ├── login.cy.js
    │   ├── store-view.cy.js
    │   ├── add-product.cy.js
    │   ├── add-category.cy.js
    │   ├── storefront-search.cy.js
    │   ├── new-product-order.cy.js
    │   ├── reports/
    │   │   └── report-reconciliation.cy.js  → Reports ke numbers aapas mein match karne wala test
    │   └── all-tests.cy.js
    ├── reports/                  → Report reconciliation framework (section 5)
    │   ├── reportDefinitions.js  → Har report API ka endpoint + extra params
    │   ├── reportMappings.js     → Kaunsi value kis value ke barabar honi chahiye
    │   ├── reconciliationConfig.js → Stores + date filters
    │   ├── ReportsApi.js         → Auth capture, API calls, comparison
    │   └── reconciliationReport.js → Colored command-log rows + HTML report
    ├── reports-output/           → Har run ki HTML report (gitignored)
    ├── pages/                    → Page Object Model classes
    │   ├── LoginPage.js
    │   ├── StoreDirectoryPage.js
    │   ├── CategoriesPage.js
    │   ├── ProductsPage.js
    │   ├── ProductFormPage.js
    │   ├── StorefrontPage.js
    │   ├── ProductDetailPage.js
    │   ├── CheckoutPage.js
    │   └── OrdersPage.js
    └── support/
        ├── e2e.js
        ├── commands.js            → `cy.loginAndEnterStore()` custom command (session caching)
        └── testData.js            → Random realistic product names + random price pairs
```

---

## 2. Page Object Model (POM) — concept

Aapne kaha tha "sab kuch POM ke through ho" — iska matlab: **test file (`*.cy.js`) khud kabhi directly `cy.get(...)` waghera nahi karti.** Uske bajaye, har page/screen ke liye ek alag class banti hai (`cypress/pages/` folder mein) jisme:

- Selectors (kaunsa element kahan hai) — ek jagah maujood hain
- Actions (click karna, type karna) — methods ke tor par

Test file sirf in methods ko **call** karti hai, jaise: `loginPage.login(...)`. Fayda yeh hai ke agar kal UI mein koi selector badal jaye (jaise input ka naam), to sirf Page class mein ek jagah fix karna parta hai — har test file mein dhoondh dhoondh kar badalna nahi parta. Yeh baat is guide ke Masla 6 mein ek baar khud sach saabit hui (StoreDirectoryPage ka selector).

### `cypress/pages/LoginPage.js`

```js
class LoginPage {
  visit() {
    cy.visit("/merchants/login");
    cy.get('input[name="storename"]', { timeout: 30000 }).should("be.visible");
    return this;
  }
  getStoreNameInput() { return cy.get('input[name="storename"]'); }
  getUsernameInput() { return cy.get('input[name="username"]'); }
  getPasswordInput() { return cy.get('input[name="password"]'); }
  getLoginButton() { return cy.contains("button", "Login"); }

  fillStoreName(storeName) { this.getStoreNameInput().clear().type(storeName); return this; }
  fillUsername(username) { this.getUsernameInput().clear().type(username); return this; }
  fillPassword(password) { this.getPasswordInput().clear().type(password, { log: false }); return this; }
  submit() { this.getLoginButton().click(); return this; }

  login(storeName, username, password) {
    this.visit();
    this.fillStoreName(storeName);
    this.fillUsername(username);
    this.fillPassword(password);
    this.submit();
    cy.url({ timeout: 30000 }).should("not.include", "/login");
    return this;
  }
}

module.exports = new LoginPage();
```

- `visit()` aur `login()` ke andar do **checkpoints** hain (Masla 16 dekhein): login page par form aane ka 30 second tak intezar, aur Login click ke baad tab tak rukna jab tak URL se `/login` hat na jaye. Inke baghair login ke baad wala har step apna 4-second timer Login click hote hi shuru kar deta tha.
- Har `get...()` method sirf ek selector return karta hai.
- `fillPassword` mein `{ log: false }` isliye hai taake password Cypress ke command-log/terminal output mein plain-text na dikhe (security ke liye).
- `login()` ek "combo" method hai jo poora flow (visit → teeno field bharna → submit) ek hi call mein kar deta hai.
- File ke aakhir mein `module.exports = new LoginPage()` — **ek hi instance export hoti hai** (class nahi), taake har jagah `require(...)` karne par same object mile. Yeh pattern har page class mein dohraya gaya hai.

### `cypress/pages/StoreDirectoryPage.js`

"Users → Live Stores / Inactive Stores" wale section ke liye hai, aur `enterStore(storeName)` naam ka ek combo method bhi rakhta hai jo poora "search → fallback → open" flow ek hi call mein kar deta hai (yeh `cy.loginAndEnterStore()` custom command ke andar istemaal hota hai — section 3 mein tafseel).

```js
ensureUsersMenuExpanded() {
  return cy.get('[title="Users"]', { timeout: 30000 }).then(($trigger) => {
    if ($trigger.attr("aria-expanded") !== "true") {
      return cy.wrap($trigger).click({ force: true });
    }
  });
}
```
Sidebar ka "Users" section ek collapsible accordion hai. Jab tak yeh khula (`aria-expanded="true"`) na ho, "Live Stores"/"Inactive Stores" jaisay links DOM mein hote hi nahi.

Is class ke saare steps ab lambe timeouts istemaal karte hain: Users menu 30s, Live/Inactive Stores link 15s, search box 20s, table mein store ka naam 15s, View icon 15s. Login ke baad ya "Back to Super Admin" ke baad sidebar aur table app ki apni API calls khatam hone par hi render hote hain. Slow load par ye default 4 second se zyada lete thay aur "create session" error dete thay (Masla 16).

```js
waitForResultsToSettle(term) {
  return cy.get("body", { timeout: 10000 }).should(($body) => {
    const text = $body.text().toLowerCase();
    const settled = text.includes("no data found") || text.includes(term.toLowerCase());
    expect(settled).to.equal(true);
  });
}
```
Search box mein type karne ke baad list turant filter nahi hoti (debounce/API call lagta hai). Yeh method wait karta hai jab tak ya to "No Data Found" dikhe ya search term wala result aa jaye.

```js
// The site used to render this as `<img class="view">`; it now renders as
// `<span class="qv-users-directory-icon" title="View">` wrapping an inline
// SVG - confirmed live via a DOM dump after `img.view` started reliably
// finding nothing.
clickViewIconForFirstResult() {
  return cy.get('span.qv-users-directory-icon[title="View"]').first().click();
}
```
**Yeh exactly wahi real selector-break tha jiska zikar upar hua** — site ka real markup badal gaya tha, code purana reh gaya tha. Fix sirf is ek jagah hua, baqi har test file jo isay istemaal karti hai (store-view.cy.js, aur `cy.loginAndEnterStore()` ke through har doosra test) khud-ba-khud theek ho gaya — POM ka asal fayda isi se samajh aata hai.

```js
enterStore(storeName) {
  this.goToInactiveStores();
  this.search(storeName);
  this.waitForResultsToSettle(storeName);

  this.isShowingNoResults().then((notFoundInInactive) => {
    if (notFoundInInactive) {
      this.goToLiveStores();
      this.search(storeName);
      return this.waitForResultsToSettle(storeName);
    }
  });

  cy.contains(storeName, { matchCase: false }).should("be.visible");
  this.clickViewIconForFirstResult();
  return cy.contains("Back to Super Admin", { timeout: 15000 }).should("be.visible");
}
```
Yeh `store-view.cy.js` wala poora flow hai, bas ek reusable method ki shakal mein — taake har naya spec jisay sirf "ek store ke andar hona" chahiye (login/store-view khud test nahi karna), yeh poora UI dobara na likhe.

```js
backToSuperAdmin() {
  cy.contains("Back to Super Admin", { timeout: 15000 }).click();
  return cy.get('[title="Users"]', { timeout: 30000 }).should("exist");
}
```
Ek store ke andar se wapas Super Admin mein le jata hai. Wahan se `enterStore()` dusra store khol sakta hai, aur dobara login nahi karna parta. Report reconciliation test isi se ek login mein kai stores check karta hai.

### `cypress/pages/CategoriesPage.js`

```js
recoverFromLoadFailure(attemptsLeft = 2) {
  return cy.get("body").then(($body) => {
    if ($body.text().includes("This page failed to load") && attemptsLeft > 0) {
      cy.contains("button", "Try again").click();
      cy.wait(2000);
      return this.recoverFromLoadFailure(attemptsLeft - 1);
    }
  });
}
```
Yeh page kabhi kabhi real "This page failed to load" error deta hai (saath mein productfruits.com widget ki requests bhi dikhti hain — environment/widget ka glitch, asal bug nahi). "Try again" click karke khud recover kar leta hai.

```js
// A category created here doesn't become searchable in the product form's
// category picker on its own - confirmed live that it can still be missing
// there after 2+ minutes and several page reloads. Clicking Sync pushes it
// through immediately instead.
clickSync() {
  return cy.contains("button", "Sync").click();
}
```
Isi pattern par baad mein products ke liye bhi ek `ProductsPage.clickSync()` try kiya gaya tha. Woh naye product ke search mein na aane ka masla hal nahi kar saka, is liye hata diya gaya. Poori kahani Masla 8 mein hai.

### `cypress/pages/ProductsPage.js`

```js
visit() { return cy.visit("/merchants/inventory/new-products"); }

clickAddProduct() {
  cy.contains("button", "Add product", { timeout: 15000 }).should("be.visible").click();
  return cy.contains("Choose product type", { timeout: 10000 }).should("be.visible");
}

// "Continue" is rendered as an <a>, not a <button>.
chooseSingleProductType() {
  cy.contains("Single product").click();
  return cy.contains("a", "Continue").click();
}

chooseVariantProductType() {
  cy.contains("Product with variants").click();
  return cy.contains("a", "Continue").click();
}
```
Product-creation flow do tarah ka hota hai: **Simple/Single** (ek hi price/stock) aur **Variant** (jaise Size: Small/Medium/Large, har value ki apni price/stock).

### `cypress/pages/ProductFormPage.js`

Yeh sabse bara page class hai, kyunke Simple aur Variant dono product forms isi ek class ke methods se bharti hain.

```js
fillName(name) {
  return cy.get('input[placeholder="Enter product name"]', { timeout: 30000 }).clear().type(name);
}
```
Ye form ka pehla field hai. Add-product page kabhi kaafi der spinner par rehta hai, is liye yahan 30 second tak intezar hota hai.

```js
// Category, Brand and Tags all render as the same custom combobox: an
// <input> whose very next sibling is the absolutely-positioned option
// panel, each option a <button>, and typing a name with no match turns the
// panel into a single `Create "<name>"` button.
selectRandomOption(placeholder, uniqueNamePrefix, { verifySelected = false } = {}) {
  // ...
  const isRealOption = (el) => {
    const text = el.textContent.trim();
    return text !== "" && !/^load more$/i.test(text) && !text.startsWith('Create "');
  };
  // panel ke buttons -> sirf isRealOption wale -> unme se random click
  // verifySelected ho to chosen option ki chip ka intezar (assertChipSelected)
}

selectRandomCategory() {
  return this.selectRandomOption("Add a category", "Auto Category ", { verifySelected: true });
}
selectRandomBrand() { return this.selectRandomOption("Choose a brand", "Auto Brand "); }
selectRandomTag() { return this.selectRandomOption("Add a tag", "Auto Tag "); }
```
Category/Brand/Tag teeno ek hi custom combobox pattern share karte hain. Agar store mein pehle se options maujood hain to randomly ek pick ho jati hai; agar koi option hi nahi to usi dropdown se ek naya unique-naam wala option create ho jata hai — test kabhi "koi option nahi mili" ki wajah se fail nahi hota.

**Do zaroori baatein (Masla 17):**
- Dropdown ke saare buttons option nahi hote. Lambi list ke aakhir mein ek **"Load more"** button hota hai, aur type kiya hua naam na mile to `Create "..."` button aata hai. `isRealOption` in dono ko random chunne se pehle hata deta hai. Pehle kabhi kabhi "Load more" chun liya jata tha, jisse category khaali reh jati thi.
- Category ke liye `verifySelected: true` hai. Chuna hua option field ke upar ek chip (`span.qv-inv-chip`) ki shakal mein aata hai, aur woh chip form ki apni state se banti hai. `assertChipSelected()` usi chip ka 10 second tak intezar karta hai, phir aage barhta hai. Brand par ye check nahi hai, kyunke Brand ki chip alag tarah dikhti hai.

```js
assertChipSelected(placeholder, optionText) {
  return cy
    .get(`input[placeholder="${placeholder}"]`)
    .parent()
    .parent()
    .find(".qv-inv-chip", { timeout: 10000 })
    .should(($chips) => {
      const selected = Cypress._.map($chips, (chip) => chip.innerText.trim());
      expect(selected, `selected chips in "${placeholder}"`).to.include(optionText);
    });
}
```

**Known behaviour:** select karne ke baad `{esc}` dropdown band nahi karta (`aria-expanded` `true` hi rehta hai). Dropdown tab band hota hai jab test agle field par click karta hai. Abhi isse koi test fail nahi hota, is liye ise nahi chheda gaya.

```js
// An option created moments earlier (e.g. by a just-run "add category"
// step) can take several seconds to become searchable here - confirmed
// live that the panel shows only a `Create "<name>"` button for a while
// before the real, exact-match option appears.
selectOptionByName(placeholder, name, { timeout = 20000, verifySelected = false } = {}) { /* ... */ }
selectCategoryByName(name) {
  return this.selectOptionByName("Add a category", name, { verifySelected: true });
}
```
Yeh `selectRandomOption` se farq hai: yahan **exact** naam wala option chuna jata hai (random nahi), aur agar abhi-abhi banaya gaya naam turant searchable na ho to retry karta rehta hai jab tak asal option na aa jaye (nahi to `Create "<name>"` wala button galti se dobara click ho jata, jo substring-match se bhi match ho jata hai).

```js
fillSimplePricing(cost, price) {
  cy.get('input[placeholder="0.00"]').eq(0).clear().type(cost);
  return cy.get('input[placeholder="0.00"]').eq(1).clear().type(price);
}
```
Simple product ki pricing row left-to-right "Cost, Price, Compare-at price" hai, teeno ka placeholder "0.00" hi hai — isliye index (`eq(0)`, `eq(1)`) se pehchana jata hai.

```js
// A simple product saved with no stock quantity set defaults to 0 -
// confirmed live that such a product never becomes searchable on the
// storefront [...]
fillAvailableToSell(min = 10, max = 100) {
  const quantity = String(Cypress._.random(min, max));
  return cy.contains("Available to sell").parent().find('input[placeholder="0"]').clear().type(quantity);
}
```
Yeh method baad mein add hua (Masla 8 ki investigation ke dauran). "Available to sell" ka apna input bhi bare "0" placeholder share karta hai paas-waale Reorder fields ke saath, isliye label ke apne container tak scope kiya gaya hai.

```js
selectAttribute(attributeName) { /* "Choose attribute" -> search -> click button */ }
addVariantValue(value) { /* "Add value" field -> type + Enter */ }

fillAllVariantPrices(cost, price) {
  return cy.get('input[placeholder="0.00"]').then(($inputs) => {
    Cypress._.forEach($inputs, (el, index) => {
      cy.wrap(el).clear().type(index % 2 === 0 ? cost : price);
    });
  });
}
```
Variant flow mein pehle attribute (jaise "Size") choose hota hai, phir values add hoti hain (jaise "Small", "Large"), phir har variant-row ka Cost/Price ek saath bhara jata hai.

```js
// Each row is collapsed by default [...] Interacting with one row re-renders
// and reorders the list in ways that can detach or shuffle *other* rows'
// nodes [...] Each row carries a stable `data-npf-vcard="N"` identity
// attribute though [...]
fillAllVariantAvailableToSell(min = 10, max = 100) { /* ... */ }
```
Yeh method ka comment khud is project ka sabse "non-obvious" gotcha samjhata hai: variant rows ko by-position (Nth row) dhoondhna khatarnak hai, kyunke ek row ke saath interact karne se doosri rows re-render ho kar apni jagah badal sakti hain. Is liye har row ka apna stable `data-npf-vcard="N"` attribute istemaal hota hai.

```js
const SAVE_VALIDATION_MESSAGES = ["Select Category"];

function saveOutcome($body) {
  if ($body.find('button:contains("Generate & save")').length > 0) return { type: "upcModal" };
  const text = $body[0].innerText;
  if (text.includes("Added Successfully")) return { type: "success" };
  if (text.includes("You're offline")) return { type: "offline" };
  const message = SAVE_VALIDATION_MESSAGES.find((m) => text.includes(m));
  if (message) return { type: "validation", message };
  return null;
}

save(attemptsLeft = 2) {
  cy.contains("button", "Save product").click();
  // body par 15s tak intezar jab tak saveOutcome() koi outcome na de, phir:
  //   validation -> foran fail: 'Save was blocked by the form's own validation ("Select Category")'
  //   offline    -> retrySaveAfterOffline(): toast band, 2s ruko, dobara save
  //   upcModal   -> "Generate & save" click, phir offline toast ka check
  //   success    -> kuch nahi, aage chalo
}

assertAddedSuccessfully() {
  return cy.contains("Added Successfully", { timeout: 10000 }).should("be.visible");
}
```
"Save product" click karne ke baad `save()` ab **chaar** outcomes pehchanta hai:
- **UPC modal**: "Generate & save" click karta hai.
- **Success**: aage chalta hai.
- **Form validation message**: recon mein confirm hua ke category khaali ho to app "Select Category" dikhati hai aur koi request nahi bhejti. Test 15 second rukne ke bajaye foran saaf error ke saath fail hota hai.
- **"You're offline" toast**: save dobara try hota hai (zyada se zyada 2 dafa).

Pehle sirf UPC modal aur success ka intezar hota tha. Validation ya offline par test 15 second ruk kar `either the UPC modal or a success message` wala error deta tha, jo asal wajah chhupa deta tha. Naye validation messages mile to `SAVE_VALIDATION_MESSAGES` mein add kar dein.

### `cypress/pages/StorefrontPage.js`

Yeh class **customer-facing storefront** (`quickvee.com/merchant/<id>`) ke liye hai, admin panel ke liye nahi.

```js
// The admin header's "View Online Store" link is a `target="_blank"` anchor
// - Cypress can only drive one tab, so rather than clicking it [...] this
// grabs its href and visits it directly in the current tab.
visitViaOnlineStoreLink() { /* cy.contains("View Online Store", { timeout: 15000 }) ... */ }

// A customer session from an earlier run can still be logged in here [...]
// Clearing cookies/storage and reloading guarantees a guest session.
ensureCustomerLoggedOut() { /* ... */ }

// An "Age Verification" modal covers the whole page [...] Only appears
// sometimes.
dismissAgeVerification() { /* ... */ }
```

```js
// The storefront's own product search/listing is backed by this
// elasticsearch-fronted API [...] requires multipart/form-data [...] built
// by hand here to match exactly what the real page sends.
fetchNewestProducts(merchantId) { /* POST elasticsearch.quickvee.us/.../merchant-products */ }

fetchRandomProductName(merchantId) {
  return this.fetchNewestProducts(merchantId).then((allProducts) => Cypress._.sample(allProducts).title);
}
```
Yeh `storefront-search.cy.js` ke liye hai: ek **already-existing** product ka naam random uthata hai.

```js
searchProduct(name) {
  return cy.get('input[placeholder="Search Product"]').clear().type(name);
}

selectSearchResult(productName) {
  return cy.contains(".home-search-items", productName).click();
}
```

```js
// A product just created in admin doesn't show up in the search
// autocomplete instantly [...] this drives the actual search box instead,
// which is what a real customer depends on [...]
waitForProductSearchable(productName, { timeoutMs = 300000, pollIntervalMs = 5000 } = {}, _startedAt) {
  const startedAt = _startedAt || Date.now();
  this.searchProduct(productName);
  return cy.wait(1500).then(() =>
    cy.get("body").then(($body) => {
      const found = $body.find(".home-search-items").toArray().some((el) => el.innerText.includes(productName));
      if (found) return true;
      if (Date.now() - startedAt >= timeoutMs) return false;
      return cy.wait(pollIntervalMs).then(() =>
        this.waitForProductSearchable(productName, { timeoutMs, pollIntervalMs }, startedAt)
      );
    })
  );
}
```
Yeh method `new-product-order.cy.js` ke liye hai: ek **abhi-abhi admin se banaya hua naya** product kitni der mein storefront par searchable hota hai, uska poll-and-wait. Is method ki apni kahani Masla 8 mein hai — pehle isay ghalat tareeqe se banaya gaya tha (seedha `fetchNewestProducts`'s API poll kar ke), jo kaam nahi karta tha; asal UI search box khud poll karna hi sahi tareeqa nikla.

### `cypress/pages/ProductDetailPage.js`

```js
// A variant product's detail page renders one button per attribute value
// (e.g. Size: Small/Medium/Large) [...] The class is CSS-modules-hashed
// (`_flavorButton_<hash>`), so matched by a stable substring instead of the
// full class name.
selectRandomVariant() {
  return cy.get('button[class*="flavorButton"]', { timeout: 15000 }).then(($buttons) => {
    const button = Cypress._.sample($buttons.toArray());
    return cy.wrap(button).click();
  });
}

quantitySection() { return cy.contains("span", "Quantity").parent(); }
increaseQuantity() { return this.quantitySection().find('button[aria-label="Increase quantity"]').click(); }
getQuantity() { return this.quantitySection().find("output").invoke("text"); }

selectRandomQuantity(min = 2, max = 5) {
  const target = Cypress._.random(min, max);
  for (let i = 1; i < target; i++) {
    this.increaseQuantity();
    cy.wait(400);
  }
  return this.getQuantity();
}

addToCart() {
  return this.quantitySection().contains("button", "Add to cart").click();
}
```
`selectRandomVariant()` sabse naya method hai — sirf **variant** products ke detail page par ek value (jaise "Large") select karne ke liye. Quantity "+" button par baar-baar bina ruke click karna confirmed live clicks "lose" kar deta tha, isliye har click ke beech chota `cy.wait(400)` rakha gaya.

### `cypress/pages/CheckoutPage.js`

Customer-side checkout (Cart → Details → Payment → Receipt) ka poora POM.

```js
goToPaymentCart(merchantId) {
  return cy.visit(`/payment-cart/${merchantId}?orderMethod=pickup`, { failOnStatusCode: false });
}
```
Cart drawer se click-through confirmed flaky tha (drawer visible dikha kar agle hi command mein `display:none` ho jata tha) — seedha us URL par navigate karna reliable hai.

```js
// The pre-filled ID document itself loads separately and later [...]
// Confirmed live that clicking "Proceed to checkout" before that swap
// happens trips a real, persistent client-side validation error.
confirmOnDetailsPage() {
  cy.contains("ID Verification", { timeout: 15000 }).should("be.visible");
  return cy.contains("Upload Document Here", { timeout: 10000 }).should("not.exist");
}
```

```js
// The available slots are fetched fresh each time the dropdown opens [...]
// a plain cy.get('[role="option"]') can resolve as soon as just "None" has
// mounted, before the real time slots follow [...] Waiting for more than
// one option gives the rest of the list time to actually land first.
selectPickupTime() {
  cy.get("#pickup-time-select").click();
  return cy
    .get('[role="option"]', { timeout: 8000 })
    .should("have.length.greaterThan", 1)
    .then(($options) => {
      const slots = Cypress._.reject($options.toArray(), (el) => el.textContent.trim() === "None");
      return cy.wrap(Cypress._.sample(slots)).click();
    });
}
```
Yeh method pehle hamesha "09:30 AM" select karta tha (ya crash ho jata tha) — iski poori kahani Masla 7 mein hai.

```js
getOrderId() {
  return cy.url().then((url) => new URL(url).searchParams.get("orderId"));
}
```
Order ID receipt-page ke apne URL (`?orderId=...`) se nikala jata hai — receipt text parse karne se zyada reliable.

### `cypress/pages/OrdersPage.js`

Admin ke "Orders Management" module ka POM.

```js
visit() {
  cy.visit("/merchants/order-new");
  return cy.contains("Orders Management", { timeout: 15000 }).should("be.visible");
}

selectOnlineOrders() {
  return cy.get(".order-tabs", { timeout: 10000 }).contains("Online").click();
}

// .clear() first so searching a second order ID in the same test (after an
// earlier search) replaces the field instead of appending to it.
searchOrderId(orderId) {
  return cy.get('input[placeholder*="Search by Order ID" i]').clear().type(orderId);
}

confirmOrderVisible(orderId) {
  cy.contains("Showing 1 order", { timeout: 10000 }).should("be.visible");
  return cy.contains(orderId).should("be.visible");
}

markAsPickedUp(orderId) { /* clicks the order's "Picked Up" stepper step + confirms dialog */ }
clearStatusFilter() { return cy.contains("Clear").first().click(); }
confirmPickedUp(orderId) { /* asserts the stepper's earlier steps show completed/green */ }
```
`searchOrderId()` mein `.clear()` baad mein add hua — tafseel Masla 11 mein.

---

## 3. Support Files

### `cypress/support/commands.js`

```js
const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");

Cypress.Commands.add("loginAndEnterStore", (storeName, username, password, storeUnderTest) => {
  cy.session(
    ["loginAndEnterStore", storeName, username, storeUnderTest],
    () => {
      loginPage.login(storeName, username, password);
      storeDirectoryPage.enterStore(storeUnderTest);
    },
    { cacheAcrossSpecs: true }
  );
});
```
Yeh custom command har naye spec mein poora "login + store dhoondo + open karo" flow dobara chalane se bachata hai. Pehli dafa chalta hai to Cypress us session (cookies/localStorage) ko cache kar leta hai (`cacheAcrossSpecs: true` — poore test-run mein, alag spec files ke beech bhi); agli baar bas wahi cookies restore ho jati hain.

**Zaroori gotcha:** session **restore** hone par browser `about:blank` par reh jata hai — jahan `enterStore()` last baar navigate hua tha wahan nahi. Isi liye har spec jo yeh command istemaal karta hai, uske foran baad khud se `cy.visit("/merchants/dashboard")` (ya jahan bhi zaroorat ho) karta hai.

### `cypress/support/testData.js`

```js
const PRODUCT_NAME_POOL = [
  "Wireless Mouse", "Bluetooth Speaker", "Stainless Steel Bottle", "Leather Wallet",
  "Ceramic Coffee Mug", "Yoga Mat", "Desk Lamp", "Canvas Backpack",
  "Polarized Sunglasses", "Phone Case", "Running Shoes", "Notebook Set",
  "Travel Mug", "Scented Candle", "Reusable Water Flask", "Charging Cable",
  "Laptop Stand", "Wireless Earbuds Case", "Fleece Blanket", "Insulated Lunch Box",
];

function randomProductName() {
  const base = Cypress._.sample(PRODUCT_NAME_POOL);
  return `${base} ${Date.now().toString().slice(-5)}`;
}

function randomPricePair({ minCost = 10, maxCost = 50, minMargin = 5, maxMargin = 20 } = {}) {
  const cost = Cypress._.random(minCost, maxCost);
  const price = cost + Cypress._.random(minMargin, maxMargin);
  return { cost: cost.toFixed(2), price: price.toFixed(2) };
}

module.exports = { randomProductName, randomPricePair };
```
Pehle har test case mein product ka naam seedha `"Simple Product " + Date.now()...` ya `"Variant Product " + Date.now()...` hota tha, aur price hamesha hardcoded (`"15.00"`, `"25.00"`, `"20.00"`, `"30.00"`) — dono hi obviously "test data" lagte the. Ab yeh shared file teeno jagah (`add-product.cy.js`, `add-category.cy.js`, `new-product-order.cy.js`) se istemaal hoti hai: naam ek realistic product-names pool se random uthaya jata hai (end mein chand digits abhi bhi lagte hain, kyunke kai spec us exact naam se storefront par search karte hain — agar digits na hon to purane runs ke isi naam wale products se collision ho sakta hai), aur price ek random cost + random margin se banti hai.

---

## 4. Test Specs (`cypress/e2e/*.cy.js`)

### `login.cy.js`
```js
const loginPage = require("../pages/LoginPage");

describe("Merchant Login", () => {
  it("logs in successfully with valid super admin credentials", () => {
    loginPage.login(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"));
    cy.url({ timeout: 15000 }).should("not.include", "/login");
  });
});
```
Sabse simple test: login ke baad URL mein `/login` na ho.

### `store-view.cy.js`
`StoreDirectoryPage.enterStore()` ka hi UI flow, lekin step-by-step likha hua hai (yeh khud test karta hai ke search + Inactive→Live fallback + view-icon click sahi kaam karte hain — isliye `cy.loginAndEnterStore()` istemaal nahi karta, apna fresh login karta hai).

### `add-product.cy.js`
```js
describe("Add Product", () => {
  beforeEach(() => {
    cy.loginAndEnterStore(...);
    productsPage.visit();
  });

  it("creates a simple (single) product", () => { /* ... */ });
  it("creates a product with variants", () => { /* ... */ });
});
```
Do test cases, ek `beforeEach` mein shared login + Products-page navigation. Dono ab `randomProductName()`/`randomPricePair()` istemaal karte hain.

### `add-category.cy.js`
```js
describe("Add Category", () => {
  it("creates a new category and uses it on a new simple product", () => {
    categoriesPage.visit();
    categoriesPage.clickAddCategory();
    const categoryName = "Auto Category " + Date.now().toString().slice(-5);
    categoriesPage.fillName(categoryName);
    categoriesPage.save();
    categoriesPage.assertCategoryExists(categoryName);
    categoriesPage.clickSync();

    productsPage.visit();
    /* ... creates a simple product using that new category ... */
  });
});
```
Ek naya category banata hai, "Sync" click karta hai (taake category product-form ke picker mein turant searchable ho jaye — yeh case Masla 8 wale product-indexing masle se alag hai, yahan Sync waqai kaam karta hai), phir usi category ko ek naye product par istemaal karta hai.

### `storefront-search.cy.js`
Pehla end-to-end customer-flow test: ek **already-existing** random product dhoondo (`fetchRandomProductName`), cart mein daalo, customer-login ke saath checkout karo, order place karo, phir admin session restore kar ke order ko Orders module mein dhoondo aur "Picked Up" mark karo.

### `new-product-order.cy.js`
Sabse naya aur sabse bara test — iski poori design-history Masla 14 mein hai. Current shape:

```js
it("creates a simple and a variant product, and places one order containing both", () => {
  cy.loginAndEnterStore(...);           // 1 admin login

  // Simple product banaya
  productsPage.visit();
  /* fillName(randomProductName()), fillSimplePricing(randomPricePair()), fillAvailableToSell(), save() */

  // Variant product banaya (same admin session, re-login nahi)
  productsPage.visit();
  /* fillName(randomProductName()), selectAttribute("Size"), addVariantValue x2, fillAllVariantPrices(randomPricePair()), save() */

  cy.visit("/merchants/dashboard");
  storefrontPage.visitViaOnlineStoreLink().then((merchantId) => {
    // Simple product: search -> wait searchable -> add to cart
    storefrontPage.waitForProductSearchable(simpleProductName).then((found) => {
      storefrontPage.selectSearchResult(simpleProductName);
      productDetailPage.selectRandomQuantity();
      productDetailPage.addToCart();

      // Variant product: SAME cart mein add (search box header mein hai, same page se reachable)
      storefrontPage.waitForProductSearchable(variantProductName).then((foundVariant) => {
        storefrontPage.selectSearchResult(variantProductName);
        productDetailPage.selectRandomVariant();
        productDetailPage.selectRandomQuantity();
        productDetailPage.addToCart();

        // EK hi checkout, dono items ke liye
        checkoutPage.goToPaymentCart(merchantId);
        /* ... login, details, payment, pickup date/time, place order ... */

        checkoutPage.getOrderId().then((orderId) => {
          cy.loginAndEnterStore(...);   // sirf 1 session restore
          ordersPage.visit();
          ordersPage.searchOrderId(orderId);
          ordersPage.confirmOrderVisible(orderId);
          ordersPage.markAsPickedUp(orderId);
          ordersPage.confirmPickedUp(orderId);
        });
      });
    });
  });
});
```

Yeh ek hi test case **do products banata hai, dono ko ek hi cart mein daal kar ek hi order place karta hai, aur sirf 2 login/session operations istemaal karta hai** (1 shuru mein, 1 order verify karne ke liye). Is final design tak pohanchne mein kai iterations lagi — tafseel Masla 8, 9, 10, 12, 14 mein.

### `reports/report-reconciliation.cy.js`
Reports ke numbers aapas mein match karta hai, jaise Dashboard ka "Total Sales Revenue" aur Sales Summary ka "Net Sales". Poora framework section 5 mein hai. Short mein:

```js
it(`report values match across reports for stores: ${stores.join(", ")}`, () => {
  stores.forEach((store, index) => {
    if (index === 0) {
      cy.loginAndEnterStore(..., store);          // sirf ek dafa login
    } else {
      storeDirectoryPage.backToSuperAdmin();      // agla store bina login ke
      storeDirectoryPage.enterStore(store);
    }
    reportsApi.captureContext().then((context) => {
      getDateRanges().forEach((range) => {
        reportsApi.reconcile(context, range, reportMappings).then((results) => {
          /* har result: logRow() (green/red) + allRows mein add */
        });
      });
    });
  });
  /* aakhir mein: koi MISMATCH ho to saari mismatches ek sath fail message mein */
});
```

- Saare stores ek hi `it()` mein hain taake login form sirf ek dafa bhara jaye. Pehla store cached session se aata hai, baqi "Back to Super Admin" se.
- `beforeEach` har attempt ke shuru mein `allRows` khaali karta hai. Isse retry ke baad HTML report mein purani, fail hui attempt ki rows nahi aati.
- `after()` har run ke aakhir mein HTML report likhta hai, chahe test fail ho.

### `all-tests.cy.js`
```js
require("./login.cy.js");
require("./store-view.cy.js");
require("./add-product.cy.js");
require("./add-category.cy.js");
require("./storefront-search.cy.js");
require("./new-product-order.cy.js");
require("./reports/report-reconciliation.cy.js");
```
Sab specs ko ek hi "file/tab" mein merge karta hai — wajah Masla 5 mein (Chrome apni last tab band hote hi khud exit ho jata hai). Report test sabse aakhir mein hai, is liye uski "Today" value mein isi run ke order tests ke naye orders bhi shamil hote hain.

---

## 5. Report Reconciliation Framework (`cypress/reports/`)

**Maqsad:** alag alag reports mein jo numbers dikhte hain, woh aapas mein match karne chahiye. Pehli comparison: **Dashboard ka "Total Sales Revenue" = Reporting → Sales Summary ka "Net Sales"**, same store aur same date range par.

### UI nahi, API seedha
Dono screens kholkar `$303.00` jaisa text parse karna slow aur flaky hota. Is liye test seedha un APIs ko call karta hai jo in screens ke peeche hain:

| Report | API | Value |
|---|---|---|
| Dashboard | `POST https://reports-api.quickvee.us/api/reports/dashboard` | `kpis.revenue.value` (number, jaise `303`) |
| Sales Summary | `POST https://reports-api.quickvee.us/api/reports/sales_report_api_fact` | `result.gross_sales.net_sales` (string, jaise `"303.00"`) |

Recon mein ye cheezein confirm hui:
- Dono APIs `multipart/form-data` maangti hain. Saath mein `Authorization: Bearer ...` header aur login-context fields (`token_id`, `session_id`, `login_type`, `login_user_type`, `login_merchant_id`, `login_user_email`) jate hain.
- Store `merchant_id`/`outlet_ids` se, aur dates `start_date`/`end_date` (`YYYY-MM-DD`) se jaati hain.
- Dashboard API UI ke Day/Week/Month ke bawajood **koi bhi custom range** accept karti hai. `kpis.*` hamesha `start_date`/`end_date` follow karta hai, aur response ka `headline` batata hai ke kaunsi range use hui.
- Discount aur refund wale dinon par bhi dashboard revenue net sales ke barabar aaya. Yani dashboard "revenue" waqai net sales hai.

### Files

**`reportDefinitions.js`**: har report ka endpoint aur extra params. Naya report = yahan ek entry.
```js
dashboard: {
  endpoint: "dashboard",
  extraFields: ({ startDate, endDate, isCurrentPeriod }) => ({
    date_range: `${startDate}_${endDate}`, activeType: "Day", date_type: "Day",
    isViewingCurrentPeriod: String(isCurrentPeriod), top_limit: "10",
  }),
  reportedRange: (body) => ({ startDate: body.headline.start, endDate: body.headline.end }),
},
salesSummary: { endpoint: "sales_report_api_fact", extraFields: () => ({}) },
```
`reportedRange` API ki apni batayi hui range padhta hai. Test check karta hai ke API ne wahi range use ki jo maangi gayi thi, taake galat date range par match chupke se pass na ho.

**`reportMappings.js`**: kaunsi value kis value ke barabar honi chahiye. Nayi comparison = yahan ek entry.
```js
{
  left: { label: "Dashboard Total Sales Revenue", report: "dashboard", path: "kpis.revenue.value" },
  right: { label: "Sales Summary Net Sales", report: "salesSummary", path: "result.gross_sales.net_sales" },
}
```

**`reconciliationConfig.js`**: stores aur date filters.
- Stores: `cypress.env.json` ka `"reportStores": ["storeb", "monster01"]`. Na ho to `storeUnderTest`.
- Date filters (har run par aaj ki date se khud calculate hote hain): Today, Yesterday, Last 7 days, This month (1 tareekh se aaj tak), Last month, Month before last, This year (1 January se aaj tak). January mein "Last month" sahi tareeqe se pichle saal ka December banta hai.
- Custom range: `cypress.env.json` mein `"reportStartDate"` aur `"reportEndDate"` dein. Phir sirf wahi ek range chalegi.

**`ReportsApi.js`**:
- `captureContext()`: Dashboard page kholta hai aur app ki apni dashboard API call ko intercept karke bearer token, login fields aur `merchant_id` utha leta hai. Token app ke runtime state mein rehta hai, kahin stable jagah nahi jahan se seedha padha ja sake.
- `fetch(reportName, context, range)`: report API ko same store aur same range ke saath call karta hai, `status: true` aur reported range check karta hai.
- `reconcile(context, range, mappings)`: jitni reports mappings ko chahiye, har ek ko ek hi dafa fetch karta hai. Phir har mapping ki dono values ko 2 decimals tak barabar karke compare karta hai (`303` aur `"303.00"` barabar). Har mapping ki ek row return karta hai, assert nahi karta, taake saari mismatches ek sath report hon.

**`reconciliationReport.js`**:
- `logRow()` command log mein har comparison ki ek row banata hai. MATCH green aur MISMATCH red hoti hai, amounts bold:
  `✔ MATCH [storeb] Today (2026-10-23) → Dashboard Total Sales Revenue: $303.00 | Sales Summary Net Sales: $303.00`
  Cypress har log entry ko `command-name-<name>` class deta hai. Hum `match`/`mismatch` naam se log karte hain aur runner ke document (`window.top`) mein CSS daal kar unhe rang dete hain.
- `buildHtml()` har run ke aakhir mein `cypress/reports-output/reconciliation-<date>_<time>.html` banata hai: Store, Date filter, Date range, dono values, Result. Mismatch row red hoti hai. Ye folder gitignored hai.

### Ek security observation
Recon ke dauran ek **galat token** (`Bearer invalid`) ke saath bhi Dashboard API ne status 200 diya. Sirf status dekha gaya tha, ye nahi ke response mein data bhi aaya ya nahi. Agar data aata hai to API token check nahi kar rahi; backend team se confirm karwana chahiye.

---

## 6. `cypress.config.js` aur Credentials

```js
module.exports = defineConfig({
  e2e: {
    baseUrl: "https://quickvee.com",
    viewportWidth: 1920,
    viewportHeight: 1080,
    video: true,
    retries: { runMode: 2, openMode: 0 },
    setupNodeEvents(on, config) {
      on("task", { log(message) { console.log(message); return null; } });
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.family === "chromium") {
          launchOptions.args.push("--simulate-outdated-no-au='...'");
        }
        return launchOptions;
      });
      return config;
    },
  },
  // Real credentials ab yahan nahi — cypress.env.json (gitignored) mein hain.
});
```

- `baseUrl` ab `quickvee.com` hai (pehle `admin-panel-test.quickvee.us` tha) — jaise-jaise tests storefront (customer-facing side) tak phaile, dono admin aur storefront isi ek domain par hain.
- `viewportWidth/Height` fix kiya gaya (1920x1080) taake har run consistent layout par chale (MUI ke responsive breakpoints — Masla 10 dekhein — iss par depend karte hain).
- `video: true` — `cypress run` passed test ka step-by-step log UI mein nahi rakhta (memory bachane ke liye), lekin video record hoti hai taake pass hone wale test ko bhi dobara dekh sakein. (`--no-exit` wala run jab tak khula ho, video file adhoori rehti hai aur khulti nahi.)
- `retries: { runMode: 2 }` — `cypress run` mein fail hone wala test 2 dafa aur chalta hai, uske baad hi fail maana jata hai (Masla 16). Data banane wale tests (`add-product`, `new-product-order`) ka retry naya product/order dobara banata hai, is liye store mein thoda extra test data aa sakta hai.
- **Credentials ab `cypress.config.js` mein hardcoded nahi hain** — `cypress.env.json` (gitignored) mein hain:
  ```json
  {
    "storeName": "superadmin",
    "username": "...",
    "password": "...",
    "storeUnderTest": "storeb",
    "customerEmail": "...",
    "customerPassword": "...",
    "reportStores": ["storeb", "monster01"]
  }
  ```
  Cypress yeh file khud-ba-khud load kar ke `Cypress.env(...)` mein merge kar deta hai — config file mein kuch badalna nahi parta. `cypress.env.json.example` sirf shape dikhane ke liye version-controlled hai (placeholder values ke saath).
  `customerEmail`/`customerPassword` baad mein add hue jab storefront-side checkout tests banay (customer apna alag login hai, admin se). `reportStores` report reconciliation ke stores ki list hai (section 5); store add ya remove karne ke liye sirf ye list badlein, code nahi.

---

## 7. Bade Masle Jo Aaye Aur Unki Asal Wajah

Yeh section sabse zyada seekhne wala hissa hai.

### Masla 1 — Cypress bilkul chalta hi nahi tha ("bad option: --smoke-test")
**Wajah:** is machine ke environment mein `ELECTRON_RUN_AS_NODE=1` globally set tha.
**Fix:** `scripts/run-cypress.js` — Cypress chalane se **pehle** yeh variable delete kar deta hai (`delete process.env.ELECTRON_RUN_AS_NODE`).

### Masla 2 — `cypress open` (interactive GUI) crash ho jata tha
**Wajah:** is machine ka Chromium/Electron stack ek deeper compatibility bug rakhta hai (`bad_message.cc reason 114`).
**Fix:** `cypress open` chorr diya; `cypress run --headed --browser chrome` istemaal karte hain — real Chrome se chalta hai, Cypress ka apna broken GUI shell use hi nahi hota.

### Masla 3 — Background task khud band ho jata tha
**Fix:** Jab aap khud apne terminal se `npm run ...` chalate hain yeh masla nahi aata. Jab Claude khud background mein headed Chrome chalata hai (is conversation mein jaisa "run on chrome" requests par hota hai), to uska apna "ek waqt mein sirf ek background window, nayi shuru karne se pehle purani band karo" wala tareeqa follow hota hai — taake ek se zyada Chrome instance ek sath na chal rahein.

### Masla 4 — Fake "keep browser open" spec
Pehle ek dummy spec thi jo sirf wait karti thi — ghalat approach, hata di gayi.

### Masla 5 (asal masla) — Browser test khatam hone ke baad khud band ho jata tha
**Asal wajah:** Chrome ka default behavior — jab uski **aakhri tab** band ho, poora Chrome band ho jata hai. Har spec file apna alag automation-tab khulta/band hota hai.
**Fix:** Sab specs ko `all-tests.cy.js` mein `require(...)` se **ek hi spec** bana diya + `--no-exit` flag — ab sirf aakhir mein, jab sab specs khatam ho chuke hon, Cypress khud rukta hai.

### Masla 6 — `StoreDirectoryPage` ka view-icon selector achanak kaam karna band ho gaya
**Wajah:** Asal site ka markup khud badal gaya tha — `<img class="view">` se `<span class="qv-users-directory-icon" title="View">` (SVG wrapped). Koi test-code bug nahi tha, site hi badal gayi thi.
**Fix:** Selector update kiya POM ki is ek jagah — har spec jo `enterStore()`/`clickViewIconForFirstResult()` istemaal karta hai khud theek ho gaya.

### Masla 7 — Pickup time hamesha "09:30 AM" select hoti thi (ya crash)
**Wajah:** Dropdown ke options asynchronously render hote hain. Pehli query sirf "None" placeholder ko pakar leti thi (asal time-slots abhi mount nahi huay thay), isliye "None" hata kar jo list bachti wo khaali hoti thi, aur `Cypress._.sample([])` → `undefined` → `cy.wrap(undefined).click()` crash.
**Fix:** `.should("have.length.greaterThan", 1)` lagaya — jab tak sirf "None" se zyada options render na ho jayein, Cypress khud retry karta rehta hai. Isi dauran time **random** select hone laga (pehle hardcoded "09:30 AM" tha).

### Masla 8 (sabse lambi investigation) — Naya product storefront search mein turant nahi aata tha
Jab `new-product-order.cy.js` pehli baar banaya gaya, naya banaya hua product storefront ke search mein 100+ seconds tak bhi nahi aa raha tha. Teen galat-sahi theories try hui:

1. **Theory:** Products page ka "Sync" button (CategoriesPage ke pattern par) chahiye. `ProductsPage.clickSync()` bana kar try kiya — ~108 seconds tak bhi product search mein nahi aaya. **Yeh akela/sufficient fix nahi tha**, aur baad mein ye method hata diya gaya kyunke kisi test mein istemaal nahi hota tha aur uska comment galat dawa karta tha.
2. **Theory:** Simple product default `0` stock quantity par save hota hai, aur zero-stock products search mein exclude ho rahe hain. `ProductFormPage.fillAvailableToSell()` bana kar `add-product.cy.js` mein wire kiya — yeh khud ek **real aur valid fix** nikla (ab bhi mojood hai), lekin **akele yeh bhi** masla hal nahi kar saka (~115s tak bhi product nahi mila).
3. **Asal wajah (user ne khud confirm ki):** us din sirf **network/indexing slow** tha — koi missing admin step nahi tha.

Lekin ek doosra, zyada bunyadi masla bhi saath mein nikla: jo API (`merchant-products` listing, jo `fetchRandomProductName` istemaal karta hai) poll ki ja rahi thi, **wahi ghalat jagah thi**. Live check karne par pata chala ke yeh listing API "newest" sort karne ke bawajood mahino purane products ko bhi dikhati hai aur sirf ek fixed/capped set return karti hai — ek bilkul nayay product ko reliably top par nahi laati. Jabke **asal storefront search box** (jo customer khud istemaal karta hai) usi product ko sirf ~1 minute mein dhoond leta tha.

**Sahi Fix:** `waitForProductIndexed` (API-based poll) hata kar `waitForProductSearchable` banaya — jo seedha UI search box ko hi baar-baar retype/retry karta hai (5 minute tak, 5 second ke waqfay se), jab tak search dropdown mein asal product na dikh jaye. Yeh "ground truth" khud customer jo dekhta hai wahi hai.

### Masla 9 — `selectRandomVariant()` kabhi kabhi element na milta
**Wajah:** Variant product ki detail page par jab yeh method chalta tha, screenshot se pata chala ke page abhi bhi skeleton/loading state mein tha (size buttons render hi nahi huay thay) — default 4-second timeout kaafi nahi tha.
**Fix:** Explicit `{ timeout: 15000 }` laga diya, jaisa project ke doosre slow-loading steps mein pehle se hai.

### Masla 10 — Cart page par product-name assertion fail ho rahi thi (jabke screenshot mein product saaf dikh raha tha)
**Wajah:** MUI responsive layout ek hi item ke liye **do copies** render karta hai (mobile card layout + desktop table layout), aur ek copy ko CSS se `display:none` kar deta hai. `cy.contains()` DOM mein jo match pehle milta hai wahi uthata hai — chahe woh hidden copy ho.
**Fix:** `.should("be.visible")` ki jagah `.should("exist")` — asal maqsad "item cart mein hai" confirm karna tha, "yeh exact DOM node visible hai" nahi.

### Masla 11 — Do order-IDs search karne par doosri search pehli ke saath mil (append ho) jati thi
**Wajah:** `OrdersPage.searchOrderId()` field ko `.clear()` nahi karta tha, sirf `.type()` karta tha — ek hi test mein do baar order-ID search karna (jaisa combined order test mein zaroorat pari) tootay hue text mein likh deta.
**Fix:** `.clear().type(orderId)` — pehli search par koi farak nahi parta (field pehle se khaali hoti hai), doosri search ab sahi se replace karti hai.

### Masla 12 — File manually edit hone se bracket/syntax toot gaya
Ek baar `new-product-order.cy.js` mein ek comment line aur uske neeche wali asal `storefrontPage.waitForProductSearchable(...).then((found) => {` wali line aapas mein mil (merge ho) gayi — jis se poori call hi comment ke andar chali gayi, aur uska opening `{` bhi saath hi gayab ho gaya. Is se file ka bracket count match nahi kar raha tha.
**Pehchaan:** Aapne khud file ko dekh kar "bracket missing lagta hai" kaha, jo bilkul sahi nishandehi thi.
**Fix:** Us poore hisse ko dobara sahi tareeqe se likha gaya, aur `node --check` (syntax-only validation, bina browser khole) se confirm kiya gaya ke ab file valid hai.

### Masla 13 (chronic, har jagah asar-andaz) — Is machine par free RAM bohot kam rehta hai
Poori is session mein free memory kayi dafa **0.3 GB se 2 GB** ke darmiyan dekhi gayi (normal kaafi zyada hoti hai). Isi ki wajah se bohot se **alag-alag, zahiri taur par unrelated** failures aaye:
- Login/session setup mein `[title="Users"]` kabhi na milna
- Session **restore** ka `cy.then()` 4 second mein hi timeout ho jana
- Koi bhi page ka "load hi na hona" (jabke screenshot mein sirf skeleton dikh raha ho)
- Product `save()` ka "na UPC modal, na success message" wala stall

In sab ka asal code se koi talluq nahi — yeh sab isi low-memory environment ki nishani hain. Jo tareeqa apnaya gaya:
1. Har headed/headless run se pehle PowerShell se free memory check karna.
2. Agar leftover Cypress-controlled Chrome process mil jaye (user ke apne Chrome tabs nahi) to usay band karna.
3. Fail hone par 2-4 dafa retry karna. Ab ye kaam `cypress.config.js` ke `retries` khud karte hain (Masla 16).
4. Agar baar baar wahi fail ho raha ho, ek **alag, bilkul na-chheda hua** spec (jaise `login.cy.js`) chala kar confirm karna ke masla poore environment ka hai, kisi khaas test ka nahi.

Is list ke pehle teen failures ke liye baad mein pakke fixes lage: Masla 16 (login/session timeouts) aur Masla 17 (product save).

### Masla 14 (design decision, bug nahi) — Alag-alag orders se ek combined order tak
Shuru mein socha gaya tha: do alag test cases — ek Simple product banaye aur uspar order kare, doosra Variant product banaye aur uspar order kare. Lekin har `cy.loginAndEnterStore()` call (chahe fresh setup ho ya session restore) hi Masla 13 ki chronic flakiness ka "exposure point" tha. Isliye step-by-step design badla gaya:

1. Pehle: 2 alag test cases, har ek apna login + apna checkout = 4 login/session operations.
2. Phir: 1 test case, dono products same admin-login ke andar banaye jayein, phir dono ka order alag-alag (phir bhi 1 hi order-verify session restore) = kam hua, lekin abhi bhi 2 alag checkouts.
3. **Aakhri (current) design:** dono products ek hi login mein banao, dono ko **ek hi cart** mein daalo, **ek hi checkout** se **ek hi order** place karo jisme dono products shamil hon, aur sirf ek hi baar admin session restore kar ke us ek order ko verify + pickup karo = sirf **2 login/session operations**.

Har step user ke apne feedback/suggestion se aaya — yeh is baat ki misaal hai ke flaky environment ke sath kaam karte waqt "kam steps = kam exposure" socha jaye.

### Masla 15 — Product names aur prices "obviously fake" lagte thay
**Masla:** Har naya product `"Simple Product 48213"` ya `"Variant Product 48213"` naam se banta tha, aur price hamesha hardcoded (`15.00`/`25.00` ya `20.00`/`30.00`) hoti thi — dono hi "test data" hone ka saaf izhaar karte thay.
**Fix:** `cypress/support/testData.js` bana kar ek realistic-names pool (`"Bluetooth Speaker"`, `"Leather Wallet"`, waghera) aur ek random cost/margin price-generator banaya. Har jagah (`add-product.cy.js`, `add-category.cy.js`, `new-product-order.cy.js`) ab yehi shared helper istemaal karti hai. Naam ke aakhir mein ab bhi chand digits lagte hain — yeh zaroori hai kyunke kai specs us **exact** naam se storefront par search karte hain, aur bina kisi unique hisse ke purane runs ke chore huay products se naam takra sakta hai.

### Masla 16 — "This error occurred while creating the session" baar baar aata tha
Ye error kabhi `input[name="storename"]`, kabhi `[title="Users"]`, kabhi search box na milne par aata tha.

**Asal wajah:**
1. **Naam misleading hai.** `cy.session()` ke andar hamare login ke UI steps chalte hain (login page → form → Login → store directory). In mein koi bhi step fail ho to Cypress use "creating the session" kehta hai. Masla session ka nahi, andar wale steps ka tha.
2. **Har step ke paas sirf 4 second thay.** Site React app hai: page load ke baad bhi form aur sidebar JavaScript chalne aur API calls ke baad bante hain. Is machine par ye aksar 4 second se zyada leta hai.
3. **Login ke baad koi "ruko" checkpoint nahi tha. Ye sabse bari wajah thi.** `login()` Login click karte hi khatam ho jata tha, aur agla step (`Users` menu dhoondna) usi waqt apna 4-second timer shuru kar deta tha. Login API, redirect aur sidebar render, teeno ko usi 4 second mein hona hota tha.
4. **Kam memory** aur **retries band hona**: ek dafa ki slowness poora test fail kar deti thi.

Is ka ek variant `cy.then() timed out after 4000ms ... restoreSession` hai: Cypress ka apna session-restore step bhi 4-second limit mein hota hai.

**Fix:**
- `LoginPage`: form ka 30s intezar, aur Login ke baad URL se `/login` hatne ka 30s intezar.
- `StoreDirectoryPage`: har step par 15–30s timeouts.
- `cypress.config.js` mein `retries: { runMode: 2 }`.

Verification run mein `login.cy.js` ko 53 second lage aur phir bhi pass hua. Purane 4-second timeout ke saath ye pakka fail hota.

**Abhi baqi:** `defaultCommandTimeout` (4s) nahi badhaya gaya, is liye session-restore wala variant ab bhi kabhi aa sakta hai. Retries is mein madad karti hain.

### Masla 17 — Product save 15 second baad fail: "either the UPC modal or a success message"
Ye error intermittent tha aur retry par pass ho jata tha. Aapne live dekh kar bataya ke **category select nahi hui thi**, aur asal wajah yahi nikli.

**Investigation:**
- Recon mein bina category Save dabaya to app ne **"Select Category"** dikhaya aur **koi request nahi bheji**. Hamara test sirf UPC modal ya success ka intezar karta tha, is liye 15 second ruk kar general error deta tha.
- Category ke liye chip check (`assertChipSelected`) lagaya. Agle run mein usne pakra ke test ne random "option" ke tor par **"Load more"** button chun liya tha: `expected [] to include Load more`. Category list pages mein aati hai aur dropdown ke neeche "Load more" bhi ek `<button>` hai. `selectRandomOption()` saare buttons mein se random chunta tha.

**Fix (`ProductFormPage.js`):**
- `isRealOption`: random chunne se pehle "Load more" aur `Create "..."` buttons hata diye. Ye Category, Brand aur Tag teeno par lagta hai; Brand/Tag mein bhi yahi bug chupke se field khaali chhor deta tha.
- Category select ke baad chip ka check.
- `save()` ab validation par foran saaf error se fail hota hai, aur offline toast par retry karta hai. Purana offline-retry logic sirf modal ya success aane ke *baad* chalta tha, is liye jis soorat ke liye bana tha usme kabhi chalta hi nahi tha.

Fix ke baad poora suite (8 tests) pehli hi koshish mein bina kisi retry ke pass hua.

### Masla 18 — `new-product-order` ka "View Online Store" link nahi mila
**Wajah:** `visitViaOnlineStoreLink()` ka `cy.contains("View Online Store")` default 4 second par tha. `all-tests` mein ye spec chhatay number par chalta hai, aur us waqt tak dashboard 4 second se zyada le raha tha.
**Fix:** `{ timeout: 15000 }`, jaisa project ke baqi "page load hone do" wale steps mein hai.

---

## 8. `package.json` Scripts

| Command | Kya karta hai |
|---|---|
| `npm run test:login` | Sirf login test, real Chrome mein, result dikhne ke baad khula rehta hai |
| `npm run test:store-view` | Sirf store-view test |
| `npm run test:add-product` | Sirf add-product test (simple + variant product creation) |
| `npm run test:add-category` | Sirf add-category test |
| `npm run test:all` (ya `npm run cypress:headed`) | **`all-tests.cy.js` (sab specs) ek hi window mein**, aakhir mein khula rehta hai |
| `npm run cypress:run` | Headless (bina browser dikhaye) — `all-tests.cy.js` |
| `npm run cypress:open` | Interactive GUI (is machine par crash karta hai — Masla 2 dekhein, istemaal na karein) |
| `npm run watch` | File save karte hi khud dobara chala deta hai |

**Note:** `storefront-search.cy.js`, `new-product-order.cy.js` aur `reports/report-reconciliation.cy.js` ke apne alag `npm run test:...` scripts abhi tak nahi banay. Ye `all-tests.cy.js` ke through chalte hain (`npm run test:all`), ya akele is tarah:
```
node scripts/run-cypress.js run --headed --browser chrome --no-exit --spec "cypress/e2e/reports/report-reconciliation.cy.js"
```
Agar inke apne shortcuts chahiye hon to `package.json` mein add kiye ja sakte hain, waisay hi jaise `test:add-product`/`test:add-category` bane huay hain.

Sab commands apne terminal se seedha chala sakte hain:
```
cd C:\Users\Bilal\Desktop\Quickvee\cypress-automation
npm run test:all
```

---

## 9. Aage Naya Test Kaise Likhein

1. Agar naye page/screen ka test hai, `cypress/pages/` mein ek nayi Page class banayein (`LoginPage.js` ki tarah) — selectors + actions ek jagah, `module.exports = new ClassName()` ke saath.
2. Agar product-jaisa koi naya entity banana hai jiska naam/price realistic hona chahiye, `cypress/support/testData.js` ke `randomProductName()`/`randomPricePair()` dobara istemaal karein (ya wahan nayi helper add karein) — naya hardcoded naam/price na likhein.
3. `cypress/e2e/` mein nayi `*.cy.js` file banayein, zaroori Page classes ko `require` karke use karein. Agar test ko sirf "kisi store ke andar hona" chahiye (login/store-view khud test nahi karna), `cy.loginAndEnterStore(...)` istemaal karein — apna fresh login code na likhein.
4. `all-tests.cy.js` mein naye spec ka `require(...)` add kar dein taake woh bhi "ek hi window" wale run mein shamil ho jaye.
5. Agar koi UI interaction "non-obvious" nikle (jaise async-loading dropdown, hidden duplicate DOM, ya server-side delay), Page class ke method ke upar hi ek chota comment likhein jo **wajah** bataye — jaisa is poori file mein har jagah kiya gaya hai. Agle kisi ko (ya khud aapko 2 mahine baad) wahi masla dobara discover nahi karna parega.

### Nayi report comparison kaise add karein
Test ka code chhedne ki zaroorat nahi:

1. **Agar dono values pehle se maujood reports (dashboard, salesSummary) mein hain:** `cypress/reports/reportMappings.js` mein ek entry add karein:
   ```js
   {
     left: { label: "Dashboard Total Transactions", report: "dashboard", path: "kpis.transactions.value" },
     right: { label: "Sales Summary Total Transactions", report: "salesSummary", path: "result.total_transactions" },
   }
   ```
   Field ka `path` API ke JSON response se aata hai (browser DevTools → Network tab mein response dekh lein).
2. **Agar naya report chahiye:** pehle DevTools mein us report ki API request dekhein: endpoint aur jo extra form fields jati hain. Phir `cypress/reports/reportDefinitions.js` mein ek entry banayein (`endpoint`, `extraFields`, aur agar API apni range batati hai to `reportedRange`). Uske baad step 1 ki tarah mapping add karein.
3. **Naya store:** `cypress.env.json` ki `reportStores` list mein naam add karein (store directory mein jis naam se search hota hai).
4. **Naya date filter:** `cypress/reports/reconciliationConfig.js` ke `getDateRanges()` mein ek `range(label, start, end)` add karein. Ek baar ki custom range ke liye `reportStartDate`/`reportEndDate` env kaafi hai.
5. Pehle ek **galat mapping** jaan-boojh kar daal kar chalayein aur dekhein ke test MISMATCH dikha kar fail hota hai. Phir sahi mapping rakhein. Isse confirm hota hai ke comparison waqai kuch check kar rahi hai.
