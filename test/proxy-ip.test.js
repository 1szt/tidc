const test = require("node:test");
const assert = require("node:assert/strict");
const { createClientIpResolver, normalizeIp } = require("../proxy-ip");

function request(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

test("normalizes IPv4-mapped and bracketed addresses", () => {
  assert.equal(normalizeIp("::ffff:203.0.113.10"), "203.0.113.10");
  assert.equal(normalizeIp("[2001:db8::10]:443"), "2001:db8::10");
});

test("auto mode reads X-Forwarded-For from a Docker private proxy", () => {
  const resolve = createClientIpResolver("auto");
  assert.equal(resolve(request("172.18.0.2", { "x-forwarded-for": "203.0.113.25" })), "203.0.113.25");
});

test("auto mode ignores forwarded headers from an untrusted public peer", () => {
  const resolve = createClientIpResolver("auto");
  assert.equal(resolve(request("198.51.100.8", { "x-forwarded-for": "1.2.3.4" })), "198.51.100.8");
});

test("auto mode rejects a spoofed leftmost address", () => {
  const resolve = createClientIpResolver("auto");
  assert.equal(resolve(request("172.18.0.2", { "x-forwarded-for": "1.2.3.4, 203.0.113.25" })), "203.0.113.25");
});

test("numeric mode supports a known number of reverse proxies", () => {
  const resolve = createClientIpResolver("2");
  assert.equal(resolve(request("172.18.0.2", { "x-forwarded-for": "203.0.113.25, 198.51.100.4" })), "203.0.113.25");
});

test("custom CIDRs only trust matching direct proxies", () => {
  const resolve = createClientIpResolver("10.20.0.0/16,loopback");
  assert.equal(resolve(request("10.20.1.7", { "x-forwarded-for": "203.0.113.25" })), "203.0.113.25");
  assert.equal(resolve(request("10.21.1.7", { "x-forwarded-for": "203.0.113.25" })), "10.21.1.7");
});

test("X-Real-IP and CF-Connecting-IP are supported as fallbacks", () => {
  const resolve = createClientIpResolver("1");
  assert.equal(resolve(request("172.18.0.2", { "x-real-ip": "203.0.113.30" })), "203.0.113.30");
  assert.equal(resolve(request("172.18.0.2", { "cf-connecting-ip": "203.0.113.31" })), "203.0.113.31");
});

test("disabled mode always uses the socket address", () => {
  const resolve = createClientIpResolver("0");
  assert.equal(resolve(request("::ffff:172.18.0.2", { "x-forwarded-for": "203.0.113.25" })), "172.18.0.2");
});
