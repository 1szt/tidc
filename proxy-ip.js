const net = require("net");

const NAMED_RANGES = {
  loopback: ["127.0.0.0/8", "::1/128"],
  linklocal: ["169.254.0.0/16", "fe80::/10"],
  uniquelocal: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"]
};

const AUTO_RANGES = ["loopback", "linklocal", "uniquelocal"];

function normalizeIp(value) {
  let address = String(value || "").trim().replace(/^"|"$/g, "");
  if (!address || address.toLowerCase() === "unknown") return "";

  if (address.startsWith("[")) {
    const closingBracket = address.indexOf("]");
    if (closingBracket !== -1) address = address.slice(1, closingBracket);
  } else {
    const ipv4WithPort = address.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) address = ipv4WithPort[1];
  }

  address = address.split("%")[0];
  if (address.toLowerCase().startsWith("::ffff:")) address = address.slice(7);
  return net.isIP(address) ? address.toLowerCase() : "";
}

function ipv4ToBigInt(address) {
  return address.split(".").reduce((result, part) => (result << 8n) + BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(address) {
  let input = address.toLowerCase();
  const ipv4Tail = input.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Tail) {
    const ipv4 = Number(ipv4ToBigInt(ipv4Tail[1]));
    input = `${input.slice(0, ipv4Tail.index)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(parseInt(group || "0", 16)), 0n);
}

function ipValue(address) {
  const version = net.isIP(address);
  if (version === 4) return { version, bits: 32, value: ipv4ToBigInt(address) };
  if (version === 6) return { version, bits: 128, value: ipv6ToBigInt(address) };
  return null;
}

function compileRange(value) {
  const [rawAddress, rawPrefix] = String(value).trim().split("/");
  const address = normalizeIp(rawAddress);
  const parsed = ipValue(address);
  if (!parsed) return null;
  const prefix = rawPrefix === undefined ? parsed.bits : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) return null;
  const shift = BigInt(parsed.bits - prefix);
  const network = shift ? (parsed.value >> shift) << shift : parsed.value;
  return { ...parsed, prefix, network };
}

function matchesRange(address, range) {
  const parsed = ipValue(address);
  if (!parsed || parsed.version !== range.version) return false;
  const shift = BigInt(parsed.bits - range.prefix);
  return (shift ? (parsed.value >> shift) << shift : parsed.value) === range.network;
}

function expandRanges(tokens) {
  return tokens.flatMap((token) => NAMED_RANGES[token.toLowerCase()] || [token]);
}

function parseTrustProxy(value) {
  const raw = value === undefined || value === null || String(value).trim() === ""
    ? "auto"
    : String(value).trim().toLowerCase();

  if (["0", "false", "off", "none"].includes(raw)) return { mode: "disabled", label: "disabled" };
  if (["*", "all"].includes(raw)) return { mode: "all", label: "all proxies" };
  if (["auto", "true", "on"].includes(raw)) {
    const ranges = expandRanges(AUTO_RANGES).map(compileRange).filter(Boolean);
    return { mode: "ranges", ranges, label: "auto (private/loopback proxies)" };
  }
  if (/^\d+$/.test(raw) && Number(raw) > 0) {
    const hops = Number(raw);
    return { mode: "hops", hops, label: `${hops} proxy hop${hops === 1 ? "" : "s"}` };
  }

  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const ranges = expandRanges(tokens).map(compileRange).filter(Boolean);
  if (!ranges.length) return { mode: "disabled", label: "disabled (invalid TRUST_PROXY)" };
  return { mode: "ranges", ranges, label: `${ranges.length} trusted proxy range${ranges.length === 1 ? "" : "s"}` };
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function forwardedAddresses(req) {
  const forwardedFor = headerValue(req.headers, "x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",").map(normalizeIp).filter(Boolean);

  for (const name of ["cf-connecting-ip", "x-real-ip"]) {
    const address = normalizeIp(headerValue(req.headers, name));
    if (address) return [address];
  }
  return [];
}

function createClientIpResolver(value = process.env.TRUST_PROXY) {
  const config = parseTrustProxy(value);

  const resolveClientIp = (req) => {
    const directAddress = normalizeIp(req.socket?.remoteAddress) || "unknown";
    const forwarded = forwardedAddresses(req);
    if (!forwarded.length || config.mode === "disabled") return directAddress;

    const chain = [...forwarded, directAddress];
    let index = chain.length - 1;
    let trustedHops = 0;
    while (index > 0) {
      const trusted = config.mode === "all"
        || (config.mode === "hops" && trustedHops < config.hops)
        || (config.mode === "ranges" && config.ranges.some((range) => matchesRange(chain[index], range)));
      if (!trusted) break;
      index -= 1;
      trustedHops += 1;
    }
    return chain[index] || directAddress;
  };

  resolveClientIp.config = config;
  return resolveClientIp;
}

module.exports = { createClientIpResolver, normalizeIp, parseTrustProxy };
