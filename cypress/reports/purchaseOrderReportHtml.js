// HTML report for the purchase-order creation (CUD) suite: one row per PO
// with its create / receive status and any failure, plus a run header and a
// pass/fail summary. summaryOf(pos) is reused by the spec's console line.

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const isCreated = (p) => /^created$/i.test(p.createStatus || "");
const isReceived = (p) => /^received$/i.test(p.receiveStatus || "");
const isAttempted = (p) => !/^not attempted$/i.test(p.createStatus || "");
const isFailed = (p) => !!p.error || /fail/i.test(p.createStatus || "") || /fail/i.test(p.receiveStatus || "");

function summaryOf(pos = []) {
  return {
    attempted: pos.filter(isAttempted).length,
    created: pos.filter(isCreated).length,
    received: pos.filter(isReceived).length,
    failed: pos.filter((p) => isFailed(p) && !isReceived(p)).length,
  };
}

function statusClass(status) {
  const s = String(status || "");
  if (/fail|not created|not attempted/i.test(s)) return "bad";
  if (/created|received|receive sent/i.test(s)) return "ok";
  return "inf";
}

function rowHtml(p) {
  const bad = isFailed(p) && !isReceived(p);
  return `<tr class="${bad ? "fail" : ""}">
    <td class="n">${esc(p.index)}</td>
    <td class="st ${statusClass(p.createStatus)}">${esc(p.createStatus || "—")}</td>
    <td class="st ${statusClass(p.receiveStatus)}">${esc(p.receiveStatus || "—")}</td>
    <td>${esc(p.failedStage || "")}</td>
    <td>${p.error ? `<div class="err">${esc(p.error)}</div>` : ""}${p.screenshot ? `<div class="shot">screenshot: ${esc(p.screenshot)}</div>` : ""}</td>
  </tr>`;
}

function buildPurchaseOrderHtml({ pos = [], info = {}, title = "Purchase Order Creation — QA" }) {
  const s = summaryOf(pos);
  const infoRows = Object.entries(info)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937;background:#f9fafb;line-height:1.45}
 h1{margin:0 0 4px;font-size:22px}h2{margin:24px 0 10px;font-size:17px;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;background:#fff}
 th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px}
 th{background:#f3f4f6}table.head{width:auto;margin-bottom:12px}
 td.n{width:40px;color:#6b7280}td.st{white-space:nowrap;font-weight:700}
 td.ok{color:#166534}td.bad{color:#991b1b}td.inf{color:#075985}
 tr.fail{background:#fef2f2}
 .err{color:#991b1b;white-space:pre-wrap}.shot{color:#6b7280;font-size:12px;margin-top:4px}
 .pill{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;margin:0 8px 10px 0}
 .pill.ok{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.pill.inf{background:#e0f2fe;color:#075985}
</style></head><body>
 <h1>${esc(title)}</h1>
 <table class="head">${infoRows}</table>
 <div class="pill inf">${s.attempted} attempted</div>
 <div class="pill ok">${s.created} created</div>
 <div class="pill ok">${s.received} received</div>
 <div class="pill ${s.failed ? "bad" : "inf"}">${s.failed} failed</div>
 <h2>Purchase orders (${pos.length})</h2>
 <table><thead><tr><th>#</th><th>Create</th><th>Receive</th><th>Failed stage</th><th>Error / notes</th></tr></thead>
 <tbody>${pos.map(rowHtml).join("")}</tbody></table>
</body></html>`;
}

module.exports = { buildPurchaseOrderHtml, summaryOf };
