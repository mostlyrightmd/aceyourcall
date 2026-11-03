import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { sendStatic } from "../src/static-assets.js";

test("public assets compress, revalidate, and refresh after deployment without caching HTML", () => {
  const previous = process.cwd(),
    dir = mkdtempSync(join(tmpdir(), "mp-assets-"));
  mkdirSync(join(dir, "public"));
  process.chdir(dir);
  const text = "/* sample stylesheet */\n".repeat(200);
  writeFileSync("public/test.css", text);
  writeFileSync(
    "public/test.html",
    "<html><head></head><body>Test</body></html>",
  );
  const request = (file, headers = {}, nonce) => {
    const result = {
      headers: { "cache-control": "no-store" },
      statusCode: 200,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(body) {
        this.body = body;
      },
    };
    sendStatic({ headers }, result, file, nonce);
    return result;
  };
  try {
    const compressed = request("test.css", { "accept-encoding": "br, gzip" });
    assert.equal(gunzipSync(compressed.body).toString(), text);
    assert.ok(compressed.body.length < text.length / 5);
    assert.equal(compressed.headers["cache-control"], "public, no-cache");
    const fresh = request("test.css", {
      "accept-encoding": "gzip",
      "if-none-match": compressed.headers.etag,
    });
    assert.equal(fresh.statusCode, 304);
    assert.equal(fresh.body, undefined);
    const raw = request("test.css", {
      "accept-encoding": "gzip;q=0",
      "if-none-match": compressed.headers.etag,
    });
    assert.equal(raw.statusCode, 200);
    assert.equal(raw.headers["content-encoding"], undefined);
    assert.equal(raw.body.toString(), text);
    writeFileSync("public/test.css", text + "/* updated */");
    const updated = request("test.css", {
      "accept-encoding": "gzip",
      "if-none-match": compressed.headers.etag,
    });
    assert.equal(updated.statusCode, 200);
    assert.notEqual(updated.headers.etag, compressed.headers.etag);
    const html = request("test.html", {
      "accept-encoding": "gzip",
      "if-none-match": "*",
    });
    assert.equal(html.statusCode, 200);
    assert.equal(html.headers["cache-control"], "no-store");
    assert.equal(html.headers.etag, undefined);
    const nonceHtml = request(
      "test.html",
      { "accept-encoding": "gzip" },
      "test-nonce",
    );
    assert.match(
      gunzipSync(nonceHtml.body).toString(),
      /name="csp-nonce" content="test-nonce"/,
    );
    assert.equal(nonceHtml.headers["cache-control"], "no-store");
    mkdirSync("public/app/assets", { recursive: true });
    writeFileSync("public/app/assets/index-12345678.js", text);
    assert.equal(
      request("app/assets/index-12345678.js").headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

 test("HTML canonical URLs use deployment origin without caching transformed bytes", () => {
  const response = () => ({setHeader(){}, end(body){this.body=body;}});
  const a=response(), b=response();
  sendStatic({headers:{}}, a, "landing.html", "nonce", "https://aceyourcall.com");
  sendStatic({headers:{}}, b, "landing.html", "nonce", "https://practice.mostlyright.md");
  assert.match(a.body.toString(), /https:\/\/aceyourcall.com\/og-light-minimal.png/);
  assert.doesNotMatch(a.body.toString(), /https:\/\/practice.mostlyright.md/);
  assert.match(b.body.toString(), /https:\/\/practice.mostlyright.md/);
});
