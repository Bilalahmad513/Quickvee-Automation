// Makes sure a product name and UPC are not already used anywhere in the
// target store before the form is filled. Three store-scoped checks, all
// with the target's merchant_id:
//   - Product_api_react/check_productTitle  (the form's own title check)
//   - Product_api_react/check_upc_form      (the form's own UPC check -
//                                            UPCs are unique store-wide,
//                                            variants included)
//   - Product_api_react/Products_list       (the Products page search,
//                                            `name` = the search box text;
//                                            exact matches only)
const { TARGET, state, apiBase } = require("./storeGuard");
const { buildMultipart } = require("./multipart");
const { buildUpc } = require("./upc");

const MAX_ATTEMPTS = 5;

// One run id for the whole spec file; names and UPCs used in this run are
// remembered across `it` blocks.
const RUN_ID = Date.now().toString();
const usedNames = new Set();
const usedUpcs = new Set();

const randomSuffix = () => Math.random().toString(36).slice(2, 6);

// The form strips ~ / \ , - from titles as you type, so the run id and
// index are separated by spaces, not "-".
const buildName = (index) => `Auto Product ${RUN_ID} ${index} ${randomSuffix()}`;

const normalize = (s) => String(s || "").trim().toLowerCase();

function loginFields() {
  return Cypress._.pick(state.ctx.fields, ["token_id", "login_type", "session_id"]);
}

function postForm(url, fields, what) {
  const { boundary, body } = buildMultipart(fields);
  return cy
    .request({
      method: "POST",
      url,
      timeout: 60000,
      failOnStatusCode: false,
      headers: { Authorization: state.ctx.authorization, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      log: false,
    })
    .then((res) => {
      if (res.status !== 200) throw new Error(`${what} answered HTTP ${res.status} - cannot verify uniqueness.`);
      return typeof res.body === "string" ? JSON.parse(res.body || "null") : res.body;
    });
}

const isTrue = (value) => value === true || value === "true";

function titleTaken(name) {
  return apiBase().then((base) =>
    postForm(`${base}Product_api_react/check_productTitle`, { title: name, id: "", merchant_id: TARGET.id, ...loginFields() }, "check_productTitle").then(
      (body) => !isTrue(body && body.status)
    )
  );
}

function upcTaken(upc) {
  return apiBase().then((base) =>
    postForm(`${base}Product_api_react/check_upc_form`, { merchant_id: TARGET.id, upc, product_id: "", id: "", ...loginFields() }, "check_upc_form").then(
      (body) => !isTrue(body && body.status)
    )
  );
}

// Whether the store has a category titled `name` (case-insensitive) - the
// add-product form's own category search, Categoryapi/category_list.
function categoryExists(name) {
  return apiBase().then((base) =>
    postForm(
      `${base}Categoryapi/category_list`,
      { merchant_id: TARGET.id, ...loginFields(), limit: "30", offset: "0", search: name, no_sort: "1", no_count: "1" },
      "Categoryapi/category_list"
    ).then((body) => {
      // The rows' shape (result / data / nested, title / name) isn't fixed -
      // a first version that read body.result[].title missed an existing
      // category - so any string value equal to `name` counts.
      const values = [];
      const collect = (node) => {
        if (typeof node === "string") values.push(node);
        else if (node && typeof node === "object") Object.values(node).forEach(collect);
      };
      collect(body);
      const found = values.some((value) => normalize(value) === normalize(name));
      cy.task("log", `Categoryapi/category_list search "${name}" -> found: ${found}; answer: ${JSON.stringify(body).slice(0, 600)}`, { log: false });
      return cy.wrap(found, { log: false });
    })
  );
}

// The Products page's own search (all products of the store, not just the
// first loaded page), with `term` in the search box. Yields the products.
function searchProducts(term) {
  const fields = { ...state.ctx.fields, merchant_id: TARGET.id, name: term, offset: "0", limit: "50", page: "0", category_id: "all", show_status: "all" };
  return postForm(state.ctx.searchUrl, fields, "Products_list search").then((body) => (Array.isArray(body) ? body : []));
}

// The store's products as the Products page lists them (no search text),
// up to `limit`.
function listProducts(limit = 100) {
  const fields = { ...state.ctx.fields, merchant_id: TARGET.id, name: "", offset: "0", limit: String(limit), page: "0", category_id: "all", show_status: "all" };
  return postForm(state.ctx.searchUrl, fields, "Products_list").then((body) => (Array.isArray(body) ? body : []));
}

// Product titles can carry variant suffixes after "~".
const titleOf = (product) => String(product.title || "").split(/~~?/)[0];

function conflicts(name, upc) {
  const result = { name: usedNames.has(normalize(name)), upc: usedUpcs.has(upc) };
  titleTaken(name).then((taken) => (result.name = result.name || taken));
  upcTaken(upc).then((taken) => (result.upc = result.upc || taken));
  searchProducts(name).then((products) => {
    if (products.some((p) => normalize(titleOf(p)) === normalize(name))) result.name = true;
  });
  searchProducts(upc).then((products) => {
    if (products.some((p) => String(p.upc || "").trim() === upc)) result.upc = true;
  });
  return cy.then(() => result);
}

// Recursive: regenerates only the value that clashed, at most MAX_ATTEMPTS
// rounds. Yields { name, upc } and reserves both for this run.
function uniqueProductData(index, candidate = {}, attempt = 1, tried = []) {
  const name = candidate.name || buildName(index);
  const upc = candidate.upc || buildUpc(RUN_ID, index);
  tried.push(`${name} / ${upc}`);

  return conflicts(name, upc).then((clash) => {
    if (!clash.name && !clash.upc) {
      usedNames.add(normalize(name));
      usedUpcs.add(upc);
      return { name, upc };
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`No unique name/UPC for product ${index} in ${TARGET.name} after ${MAX_ATTEMPTS} attempts. Tried: ${tried.join(" | ")}`);
    }
    cy.log(`Product ${index}: ${clash.name ? `name "${name}" ` : ""}${clash.upc ? `UPC ${upc} ` : ""}already used - regenerating`);
    return uniqueProductData(index, { name: clash.name ? null : name, upc: clash.upc ? null : upc }, attempt + 1, tried);
  });
}

// A fresh unique value for one field, keeping the other (save-time
// duplicate errors).
function replaceValue(index, product, field) {
  usedNames.add(normalize(product.name));
  usedUpcs.add(product.upc);
  return uniqueProductData(index, { ...product, [field]: null });
}

// Polls the Products page search (its index can trail a save by a few
// seconds) for the product with this UPC; yields it, or null.
function findProductByUpc(upc, attemptsLeft = 12) {
  return searchProducts(upc).then((products) => {
    const found = products.find((p) => String(p.upc || "").trim() === upc);
    if (found || attemptsLeft <= 1) return found || null;
    cy.wait(5000, { log: false }); // search index catch-up; nothing to wait on
    return findProductByUpc(upc, attemptsLeft - 1);
  });
}

Cypress.Commands.add("getUniqueProductData", (index) => uniqueProductData(index));

// A category name for product `index` that this run hasn't used and the
// store doesn't have. The Create category modal keeps only letters, digits
// and spaces, so the parts are joined with spaces (a "-" would be dropped).
const usedCategories = new Set();

function uniqueCategoryName(index, attempt = 1) {
  const name = `AI Cat ${RUN_ID} ${index}${attempt > 1 ? ` ${randomSuffix()}` : ""}`;
  if (usedCategories.has(normalize(name))) return uniqueCategoryName(index, attempt + 1);
  return categoryExists(name).then((exists) => {
    if (!exists) {
      usedCategories.add(normalize(name));
      return name;
    }
    if (attempt >= MAX_ATTEMPTS) throw new Error(`No unused category name for product ${index} after ${MAX_ATTEMPTS} attempts (last: ${name}).`);
    return uniqueCategoryName(index, attempt + 1);
  });
}

module.exports = { RUN_ID, replaceValue, findProductByUpc, titleOf, titleTaken, upcTaken, categoryExists, uniqueCategoryName, listProducts };
