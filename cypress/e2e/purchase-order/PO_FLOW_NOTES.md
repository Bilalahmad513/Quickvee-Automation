# Purchase Order flow - observed on test.quickvee.us (Monster01, BIL1813474MA)

Recorded 2026-10-29 from the live app: exploration specs that blocked every
write request, the app's JS bundle (main.js and the lazy chunks of the PO
screens), and the network log and screenshots of 13 POs created and received
by `purchase-order-creation.cy.js`. The suite's selectors and waits come from
this file.

All PO calls are `POST https://api-node.quickvee.us/new_purchase_orders_api/<name>`,
sent as `multipart/form-data`. Every one of them carries `merchant_id` and
`login_merchant_id` (`BIL1813474MA`), plus `token_id` / `session_id` / `login_type`.

## 1. PO list - `/merchants/purchase-order`
- Heading "Purchase Orders". Button **"+ New Purchase Order"** (`cy.contains("button", /New Purchase Order/i)`) opens the add page.
- The list is a div grid, not a `<table>`. Each row shows the PO number, "Ref: <invoice>", vendor, a status pill (`Active`, `Partial`, `Received`, `Draft`, `Cancelled`), items, expected date and total.
- On load: `new_purchase_orders_list_count`, `new_purchase_orders_count`, `new_purchase_orders_list` (`page`, `per_page=100`, `sort_col=po_id`, `sort_ord=desc`) → `data[]` with `id`, `po_number`, `reference`, `received_status`, `is_draft`, `is_void`, `merchant_id`.
- Header store name: `.qv-app-header__store-name` → `MONSTER01`.
- Opening a row goes to `/merchants/purchase-order/<id>` (`id` = the PO's backend id).

## 2. Add page - `/merchants/purchase-order/add` ("New Purchase Order")
Every field stays disabled until the form has loaded. The suite waits until the Note textarea is enabled.
Field labels are plain `<span>`s ("Order number" + a red `*`), and the control sits in the label row's next sibling.

| Field | Selector | Notes |
|---|---|---|
| Location * | `button.po-picker-filter-trigger` under "Location" | Shows `MONSTER01 · New York, MA` |
| Supplier | `button.po-picker-filter-trigger` showing `No Vendor` | Menu `.po-vendor-picker-menu` holds `input[placeholder="Search vendors"]` and rows `button.po-dropdown-option` ("No Vendor" first). The list scrolls and loads more pages. Vendors come from `new_purchase_orders_vendor_list` (`page=1`, `per_page=50`, `search_by_vendor`) → `data[]` with `id`, `vendor_name`. |
| Stock Due | `button[aria-label="Choose date"]`, input `placeholder="MM/DD/YYYY"` (read-only) | MUI calendar. It opens on the current month, past days are disabled, and today is `button[role="gridcell"][aria-current="date"]`. Its `data-timestamp` is local midnight. |
| Order number * | `input` under "Order number" | 20 characters max. The app calls `generate_po_number` on load, but on test that call **always answers HTTP 500** "Unable to generate unique PO number" and shows "Could not generate order number. Please try again." The suite therefore types its own unique number. Before saving, the app checks the number isn't a duplicate. |
| Supplier Invoice Number | `input[placeholder="Enter a Supplier Invoice Number"]` | optional |
| Note | `textarea[placeholder="Enter a note for this order"]` | optional, 200 characters max |

**Required fields / empty form:** with no product line, **"Create PO" (`button[aria-label="Create PO"]`) stays disabled**. Clicking it does nothing: no request is sent and no validation message appears.

### Products
- `button` "Search or scan to add a product" opens a `role="dialog"` titled "Add items to PO", or **"Add items from <vendor>" once a supplier is picked**. The suite finds the dialog by its search box `input[placeholder^="Search product"]`, not by its title.
- When the dialog opens it calls `new_purchase_orders_product_list_v2` (`search_by_product=""`, `page=1`, `per_page=100`, `kit_scope=stocked`, `vendor_id`, `category_id`), which returns `pagination.total` and `data[]`:
  `product_id`, `product_title`, `is_variant` ("0"/"1"), `variants[]`, `upc`, `quantity` (current stock), `track_quantity`, `continue_selling`, `is_lottery`, `price`, `cost_price`.
- Typing in the search box calls it again with `search_by_product=<text>`. A broad search (e.g. "a") answers `status:false` "Search matched too many products (2429). Please refine your search.", so the suite searches by the full UPC.
- Results: `[role="list"] [role="button"]` rows, each showing the title in a `<span>` (the row's *first* span is an empty spacer) and `<upc> · Qty: <stock>`. Clicking a row selects it, and the footer button changes to **"Add 1 to PO"**.
- The PO line then has `input[data-po-field="quantity"][data-po-row="0"]` (with `data-po-variant-key="<product_id>-upc-<upc>"`) and `input[data-po-field="cost"][data-po-row="0"]`. The cell before quantity is "Current inventory MONSTER01", and the cell after the cost is **Total cost** (`$100.00` for 10 × 10.00).

## 3. Create PO
- `add_new_purchase_order`: fields include `merchant_id`, `admin_id`, `login_merchant_id`, `po_number`, `vendor_id`, `vendor_name`, `order_items` (JSON) and `is_draft`.
  Answer: `{"status":true,"message":"Purchase order created successfully","po_id":"25836","po_number":"AP7350089301"}`.
- **After a successful create**, the app shows a toast "Purchase order created successfully." and **navigates to `/merchants/purchase-order/<po_id>`**. This happened for all 13 POs.
- **Detail page:** the header reads `< Back` (button), then the PO number, then a status pill (`Active` right after creation). There is a "Line items" summary card, a "Line items" `<span>` section header with "1 variant", and a **`button[aria-label="Receive"]`**.
- On load it calls `new_purchase_order_details` (`po_id`, `store_ids`) → `po_data` with `po_id`, `merchant_id`, `po_number`, `po_received_status`, `total_required_qty`, `total_received_qty`, `total_pending_qty`, `vendor_name`; plus `po_items_data[]` and `po_receive_history[]`.

## 4. Receive
- `button[aria-label="Receive"]` opens a dialog with `aria-label="Receive units"` ("Mark units as received from <vendor> for <location>").
- "Receive all remaining (10 units)" fills every line. The submit button then reads **"Receive 10 units"**, and "Receiving…" while saving.
- `receive_new_purchase_order`: fields include `merchant_id`, `login_merchant_id`, `po_id`, `received_status`, `total_units`, `received_at` and `order_items` (JSON). Answer: `{"status":true,"message":"Purchase Order received successfully."}`.
- **After a receive** the dialog closes. **In 3 of 13 POs the app then went back to the PO list (`/merchants/purchase-order`) by itself.** Opening the PO again by URL right away can also land on the list. The old code reloaded the page and waited 60s for "Line items", which never appears on the list. That was the actual failure; the create step never failed.
  In the final 10-PO run, all 10 stayed on `/merchants/purchase-order/<po_id>` after create and after receive. For POs 1 and 10 the suite's fresh visit to the PO page right after the receive bounced to the list, and the second visit loaded fine. The suite therefore opens the PO by id up to 3 times.
- **Store check:** once, the PO list itself spun without ever answering `new_purchase_orders_list` (no answer in 30s). The store guard counts that as a failed check and logs in again once before it stops the run.
- **Received status:** the details API gives `po_received_status` `"0"` for active and `"2"` for fully received, with `total_received_qty` 10 and `total_pending_qty` 0. On screen, the detail header pill and the list row pill read **`Received`**, and the Receive button is gone.

## 5. Stock
- The most reliable source is the `quantity` field in `new_purchase_orders_product_list_v2`, from the add page's product search by UPC (the same request the UI makes). The "Current inventory" cell on a PO line shows the same value.
- Observed: stock rose by exactly 10 after each receive (e.g. 10 → 20, -199 → -189). Negative stock exists when "continue selling" is on.
