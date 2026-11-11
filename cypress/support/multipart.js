// The admin panel's PHP / search APIs take multipart/form-data only.

function parseMultipart(body, contentType) {
  const boundary = String(contentType || "").split("boundary=")[1];
  const fields = {};
  if (!boundary) return fields;
  bodyText(body)
    .split(`--${boundary}`)
    .forEach((part) => {
      const match = part.match(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$/);
      if (match) fields[match[1]] = match[2];
    });
  return fields;
}

function buildMultipart(fields) {
  const boundary = "----CypressBoundary" + Date.now() + Cypress._.random(0, 99999);
  const body =
    Object.entries(fields)
      .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      .join("") + `--${boundary}--\r\n`;
  return { boundary, body };
}

// An intercepted body is a string for text-only forms, but binary (a photo
// in the form) can arrive as an ArrayBuffer/Buffer.
function bodyText(body) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  return Cypress.Buffer.from(body).toString("latin1");
}

// One text field of a multipart body, or null when the body has no such field.
function multipartField(body, name) {
  const match = bodyText(body).match(new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`));
  return match ? match[1] : null;
}

module.exports = { parseMultipart, buildMultipart, bodyText, multipartField };
