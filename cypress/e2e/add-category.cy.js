const categoriesPage = require("../pages/CategoriesPage");
const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");

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

    productFormPage.fillName("Simple Product " + Date.now().toString().slice(-5));
    productFormPage.selectCategoryByName(categoryName);
    productFormPage.fillSimplePricing("15.00", "25.00");
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });
});
