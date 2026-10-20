const categoriesPage = require("../pages/CategoriesPage");
const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");
const { randomProductName, randomPricePair } = require("../support/testData");

describe("Add Category", () => {
  it("creates a new category and uses it on a new simple product", () => {
    cy.loginAndEnterStore(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password"),
      Cypress.env("storeUnderTest")
    );

    categoriesPage.visit();
    categoriesPage.clickAddCategory();

    const categoryName = "Auto Category " + Date.now().toString().slice(-5);
    categoriesPage.fillName(categoryName);
    categoriesPage.save();

    categoriesPage.assertCategoryExists(categoryName);
    categoriesPage.clickSync();

    productsPage.visit();
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();

    const { cost, price } = randomPricePair();

    productFormPage.fillName(randomProductName());
    productFormPage.selectCategoryByName(categoryName);
    productFormPage.fillSimplePricing(cost, price);
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });
});
