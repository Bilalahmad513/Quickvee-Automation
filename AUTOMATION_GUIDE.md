# Cypress Automation — Kya Bana Hai, Kaise Kaam Karta Hai

Yeh file is `cypress-automation` project ka poora walkthrough hai — har file kyun bani, kya karti hai, aur jo bugs raaste mein aaye unki asal wajah kya thi. Maqsad: aap khud is code ko dekh kar samajh sakein aur aage khud extend kar sakein.

---

## 1. Folder Structure

```
cypress-automation/
├── cypress.config.js          → Cypress ki settings (URL, login credentials, browser flags)
├── package.json                → npm scripts (kaunsa command kya chalata hai)
├── scripts/
│   └── run-cypress.js          → Cypress chalane se pehle ek zaroori environment fix
└── cypress/
    ├── e2e/                    → Asal test cases (spec files)
    │   ├── login.cy.js
    │   ├── store-view.cy.js
    │   └── all-tests.cy.js
    ├── pages/                  → Page Object Model classes
    │   ├── LoginPage.js
    │   └── StoreDirectoryPage.js
    └── support/
        ├── e2e.js
        └── commands.js
```

---

## 2. Page Object Model (POM) — concept

Aapne kaha tha "sab kuch POM ke through ho" — iska matlab: **test file (`*.cy.js`) khud kabhi directly `cy.get(...)` waghera nahi karti.** Uske bajaye, har page/screen ke liye ek alag class banti hai (`cypress/pages/` folder mein) jisme:

- Selectors (kaunsa element kahan hai) — ek jagah maujood hain
- Actions (click karna, type karna) — methods ke tor par

Test file sirf in methods ko **call** karti hai, jaise: `loginPage.login(...)`. Fayda yeh hai ke agar kal UI mein koi selector badal jaye (jaise input ka naam), to sirf Page class mein ek jagah fix karna parta hai — har test file mein dhoondh dhoondh kar badalna nahi parta.

### `cypress/pages/LoginPage.js`

```js
class LoginPage {
  visit() { cy.visit("/merchants/login"); return this; }
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
    return this;
  }
}

module.exports = new LoginPage();
```

- Har `get...()` method sirf ek selector return karta hai.
- `fillPassword` mein `{ log: false }` isliye hai taake password Cypress ke command-log/terminal output mein plain-text na dikhe (security ke liye).
- `login()` ek "combo" method hai jo poora flow (visit → teeno field bharna → submit) ek hi call mein kar deta hai — test file sirf itna likhti hai: `loginPage.login(storeName, username, password)`.
- File ke aakhir mein `module.exports = new LoginPage()` — **ek hi instance export hoti hai** (class nahi), taake har jagah `require(...)` karne par same object mile.

### `cypress/pages/StoreDirectoryPage.js`

Yeh "Users → Live Stores / Inactive Stores" wale section ke liye hai. Iske andar 2 non-obvious fixes hain jo asal app ke UI behavior ki wajah se zaroori pare (neeche section 5 mein tafseel hai):

```js
ensureUsersMenuExpanded() {
  return cy.get('[title="Users"]').then(($trigger) => {
    if ($trigger.attr("aria-expanded") !== "true") {
      return cy.wrap($trigger).click({ force: true });
    }
  });
}
```
Sidebar ka "Users" section ek collapsible accordion hai. Jab tak yeh khula (`aria-expanded="true"`) na ho, "Live Stores"/"Inactive Stores" jaisay links DOM mein hote hi nahi. Yeh method har navigation se pehle check karta hai aur zaroorat pare to khud expand kar deta hai.

```js
waitForResultsToSettle(term) {
  return cy.get("body", { timeout: 10000 }).should(($body) => {
    const text = $body.text().toLowerCase();
    const settled = text.includes("no data found") || text.includes(term.toLowerCase());
    expect(settled).to.equal(true);
  });
}
```
Search box mein type karne ke baad list turant filter nahi hoti (debounce/API call lagta hai). Yeh method wait karta hai jab tak ya to "No Data Found" dikhe ya search term wala result aa jaye — jab tak dono mein se koi na ho, yeh assertion retry karta rehta hai (Cypress ka `.should()` yehi karta hai: pass hone tak dobara-dobara check karta hai).

```js
clickViewIconForFirstResult() {
  return cy.get("img.view").first().click();
}
```
Table mein har row ke "Action" column mein eye/view icon hota hai (`<img class="... view ...">`). Yeh usay click karta hai.

---

## 3. Test Specs (`cypress/e2e/*.cy.js`)

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
- `Cypress.env(...)` `cypress.config.js` ke `env` block se credentials uthata hai (neeche section 4).
- Test ka pass/fail criteria simple hai: login ke baad URL mein `/login` na ho (matlab redirect ho gaya, login successful).
- `{ timeout: 15000 }` isliye zyada rakha hai kyunke kabhi kabhi server thoda slow response deta hai — default 4 second kaafi nahi tha.

### `store-view.cy.js`
```js
const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");

describe("Store View", () => {
  it("finds a store under Users > Live/Inactive Stores and opens its store view", () => {
    const storeName = Cypress.env("storeUnderTest");

    loginPage.login(...);

    storeDirectoryPage.goToInactiveStores();
    storeDirectoryPage.search(storeName);
    storeDirectoryPage.waitForResultsToSettle(storeName);

    storeDirectoryPage.isShowingNoResults().then((notFoundInInactive) => {
      if (notFoundInInactive) {
        storeDirectoryPage.goToLiveStores();
        storeDirectoryPage.search(storeName);
        return storeDirectoryPage.waitForResultsToSettle(storeName);
      }
    });

    cy.contains(storeName, { matchCase: false }).should("be.visible");
    storeDirectoryPage.clickViewIconForFirstResult();
    cy.contains("Back to Super Admin", { timeout: 15000 }).should("be.visible");
  });
});
```
Flow bilkul waisa hai jaisa aapne bataya tha: login → Inactive Stores mein search → agar na mile to Live Stores mein search → mil jaye to view icon click → "Back to Super Admin" button ka nazar aana confirm karta hai ke store khul chuka hai.

**Important note (`return` ka istemaal):** `.then((notFoundInInactive) => { if (...) { ...; return storeDirectoryPage.waitForResultsToSettle(...); } })` mein `return` zaroori hai. Agar `.then()` ke andar naye `cy` commands chalayein aur unhe `return` na karein, to Cypress unhe sahi tarteeb (order) mein guarantee se nahi chalata — yeh ek maroof Cypress "gotcha" hai (isi wajah se pehle yeh test kai baar galat tareeqe se fail hua tha).

### `all-tests.cy.js`
```js
require("./login.cy.js");
require("./store-view.cy.js");
```
Yeh sirf 2 lines ki file hai lekin iski wajah bohot ahem hai — section 5 (aakhri masla) mein tafseel hai.

---

## 4. `cypress.config.js`

```js
module.exports = defineConfig({
  e2e: {
    baseUrl: "https://admin-panel-test.quickvee.us",
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
  env: {
    storeName: "superadmin",
    username: "bilalahmad@gmail.com",
    password: "bilaL@2026",
    storeUnderTest: "monster04",
  },
});
```
- `baseUrl` — is se test files mein `cy.visit("/merchants/login")` likhna kaafi hai, poora URL nahi likhna parta.
- `env` — yahan credentials aur test-data rakhte hain (tests mein `Cypress.env("username")` se uthaya jata hai) — is se agar credentials badlein to sirf ek jagah update karna hota hai.
- `on("task", {...})` — `cy.task("log", "...")` se browser ke andar se seedha terminal par print karne ka tareeqa (debugging ke waqt bohot kaam aaya).
- `on("before:browser:launch", ...)` — Chrome launch hone se pehle extra command-line flag lagata hai (Chrome ke apne "update available, restart karo" wale nag ko rokta hai).

---

## 5. Bade Masle Jo Aaye Aur Unki Asal Wajah

Yeh section sabse zyada seekhne wala hissa hai — kyunke saari cheezein pehli baar mein sahi nahi chali thi.

### Masla 1 — Cypress bilkul chalta hi nahi tha ("bad option: --smoke-test")
**Wajah:** is machine ke environment mein `ELECTRON_RUN_AS_NODE=1` globally set tha. Yeh variable har Electron-based app (Cypress bhi Electron par bana hai) ko force karta hai ke woh apni GUI/browser na khole, sirf plain Node.js ki tarah chale.
**Fix:** `scripts/run-cypress.js` — ek chota wrapper jo Cypress chalane se **pehle** yeh variable delete kar deta hai:
```js
delete process.env.ELECTRON_RUN_AS_NODE;
```
Isi liye har script `npx cypress ...` seedha nahi, balke `node scripts/run-cypress.js ...` se chalta hai.

### Masla 2 — `cypress open` (interactive GUI) crash ho jata tha
**Wajah:** is specific machine ka Chromium/Electron stack ek deeper compatibility bug rakhta hai (`bad_message.cc reason 114` — ek Chromium IPC validation crash) jo Cypress ke apne GUI shell ko load hote hi crash kar deta tha. GPU disable karna, alag process se launch karna — kuch kaam nahi aaya.
**Fix:** `cypress open` chorr diya. Uske bajaye `cypress run --headed --browser chrome` use karte hain — yeh real Chrome browser se test chalata hai (Cypress ka apna broken GUI shell istemaal hi nahi hota), aur sab kuch visibly dikhta hai.

### Masla 3 — Browser (background) task ~2 minute mein khud band ho jata tha
**Wajah:** jab main (Claude) apne tool se koi command "background" mein chalata hun, wahan koi lifetime limit lag rahi thi.
**Fix:** jab AAP khud apne terminal se `npm run ...` chalate hain, yeh masla sirey se nahi aata — is liye ab sab scripts npm ke through hain, seedha aapke apne terminal mein chalane ke liye.

### Masla 4 — Ek fake "test" (`zzz-keep-browser-open.cy.js`) bana kar browser khula rakhne ki koshish
Pehle maine ek dummy spec file banayi thi jo sirf 24 ghante wait karti thi, taake browser band na ho. Aapne sahi nishandehi ki ke yeh **asal test case nahi hai** aur results table mein ghalat tareeqe se dikhta hai. Yeh file hata di gayi.

### Masla 5 (asal masla) — Browser test khatam hone ke baad khud band ho jata tha
Yeh sabse tricky masla tha, teen alag-alag glat theories try karne ke baad asal wajah samajh aayi:

1. Pehle laga Chrome khud background mein **auto-update** ho kar (version 153 → 154) window band kar raha hai. Fix try kiya (`--simulate-outdated-no-au` flag) — is se koi nuqsan nahi, isliye rakh liya, lekin yeh asal wajah nahi thi.
2. Phir socha shayad Cypress ka koi crash hai — Cypress ke `after:run` lifecycle hook se browser ko "kabhi close na ho" wala promise dے diya. Isse pata chala ke Cypress ka apna process to zinda reh raha tha, lekin **Chrome khud** exit kar raha tha (`chrome exited: { code: 0 }` — matlab crash nahi, Chrome ne khud "quit" kiya).
3. **Asal wajah:** Chrome ka default behavior hai — jab uski **aakhri (last) tab band ho, to poora Chrome application hi band ho jata hai.** Cypress har ek spec (test file) ke liye ek automation tab kholta hai aur usay **us spec ke khatam hote hi band kar deta hai** taake agle spec ke liye taaza tab khol sake. Jab sirf ek hi spec ho aur woh khatam ho, to woh tab hi Chrome ki **akeli/last tab hoti hai** — us ke band hote hi Chrome khud "last window closed" samajh kar poora application band kar deta hai.

**Sahi Fix:** do alag cheezein milaani pariñ:
- **`login.cy.js` aur `store-view.cy.js` ko ek hi spec (`all-tests.cy.js`) ke tor par chalana** (`require(...)` ke zariye) — is se Cypress dono test cases ko EK hi file/tab samajhta hai, beech mein tab band-open nahi hoti.
- **`--no-exit` flag** — yeh Cypress ka apna official flag hai jo kehta hai "aakhri spec khatam hone ke baad bhi browser band mat karo". Pehle jab humaray paas 2 alag spec files thin, to `--no-exit` sirf PEHLI spec ke baad hi ruk jata tha (dusri spec kabhi chalti hi nahi thi) — lekin ab jab dono ek hi spec hain, `--no-exit` sahi se aakhir mein ruk jata hai, aur woh REAL results wali tab hi khuli rehti hai (koi khaali/blank tab nahi).

Yehi wajah hai ke `package.json` mein `cypress:headed`/`test:all` ab `all-tests.cy.js` ko `--no-exit` ke sath target karte hain, jab ke `test:login`/`test:store-view` individual specs ko unke apne `--no-exit` ke sath (chote/quick checks ke liye).

---

## 6. `package.json` Scripts — Kya Chalayein

| Command | Kya karta hai |
|---|---|
| `npm run test:login` | Sirf login test, real Chrome mein, result dikhne ke baad khula rehta hai |
| `npm run test:store-view` | Sirf store-view test, waisay hi |
| `npm run test:all` (ya `npm run cypress:headed`) | **Dono test cases ek hi window mein**, aakhir mein khula rehta hai (recommended) |
| `npm run cypress:run` | Headless (bina browser dikhaye) — CI/automation ke liye |
| `npm run watch` | File save karte hi khud dobara chala deta hai (development ke waqt) |

Sab commands aap apne terminal se seedha chala sakte hain:
```
cd C:\Users\Bilal\Desktop\Quickvee\cypress-automation
npm run test:all
```

---

## 7. Aage Naya Test Kaise Likhein

1. Agar naye page/screen ka test hai, `cypress/pages/` mein ek nayi Page class banayein (LoginPage.js ki tarah).
2. `cypress/e2e/` mein nayi `*.cy.js` file banayein, us Page class ko `require` karke use karein.
3. `all-tests.cy.js` mein naye spec ka `require(...)` add kar dein taake woh bhi "ek hi window" wale run mein shamil ho jaye.
