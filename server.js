const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");
const nodemailer = require("nodemailer");
const { mailTemplate } = require("./mail-template");

const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PVE_FILE = path.join(DATA_DIR, "pve-config.json");
const MAIL_FILE = path.join(DATA_DIR, "mail-config.json");
const REGISTRATION_FILE = path.join(DATA_DIR, "email-verifications.json");
const PASSWORD_RESET_FILE = path.join(DATA_DIR, "password-resets.json");
const MAIL_LOG_FILE = path.join(DATA_DIR, "mail-notifications.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const sessions = new Map();
const consoleTickets = new Map();
let purchaseInProgress = false;
let cachedMailTransport = null;
let cachedMailTransportKey = "";
const BUSINESS_TIME_ZONE = "Asia/Shanghai";
const LEGACY_EXPIRY_TAG = "clouddesk-expired";
const EXPIRY_TAG_PATTERN = /^expired-\d+-days$/;
const DEFAULT_NAT_MAPPINGS = [
  { portStart: 2200, portEnd: 2249, internalIp: "10.10.10.130", pveType: "lxc", pveVmid: "130", resourceName: "CT130" },
  { portStart: 2250, portEnd: 2299, internalIp: "10.10.10.131", pveType: "lxc", pveVmid: "131", resourceName: "CT131" },
  { portStart: 2300, portEnd: 2349, internalIp: "10.10.10.132", pveType: "lxc", pveVmid: "132", resourceName: "CT132" },
  { portStart: 2350, portEnd: 2399, internalIp: "10.10.10.133", pveType: "lxc", pveVmid: "133", resourceName: "CT133" },
  { portStart: 2400, portEnd: 2449, internalIp: "10.10.10.150", pveType: "qemu", pveVmid: "150", resourceName: "VM150" },
  { portStart: 2450, portEnd: 2499, internalIp: "10.10.10.151", pveType: "qemu", pveVmid: "151", resourceName: "VM151" },
  { portStart: 2500, portEnd: 2549, internalIp: "10.10.10.152", pveType: "qemu", pveVmid: "152", resourceName: "VM152" },
  { portStart: 2550, portEnd: 2599, internalIp: "10.10.10.153", pveType: "qemu", pveVmid: "153", resourceName: "VM153" },
  { portStart: 2600, portEnd: 2649, internalIp: "10.10.10.154", pveType: "qemu", pveVmid: "154", resourceName: "VM154" },
  { portStart: 2650, portEnd: 2699, internalIp: "10.10.10.155", pveType: "qemu", pveVmid: "155", resourceName: "VM155" },
  { portStart: 2700, portEnd: 2749, internalIp: "10.10.10.156", pveType: "qemu", pveVmid: "156", resourceName: "VM156" },
  { portStart: 2750, portEnd: 2799, internalIp: "10.10.10.157", pveType: "qemu", pveVmid: "157", resourceName: "VM157" },
  { portStart: 2800, portEnd: 2849, internalIp: "10.10.10.158", pveType: "qemu", pveVmid: "158", resourceName: "VM158" },
  { portStart: 2850, portEnd: 2899, internalIp: "10.10.10.159", pveType: "qemu", pveVmid: "159", resourceName: "VM159" },
  { portStart: 2900, portEnd: 2949, internalIp: "10.10.10.160", pveType: "qemu", pveVmid: "160", resourceName: "VM160" }
];

const defaultState = {
  users: [
    account("u-admin", "admin", "admin123", "admin", ""),
    account("u-demo", "demo", "123456", "client", "c-demo")
  ],
  clients: [
    { id: "c-demo", name: "演示客户", contact: "demo@example.com", balance: 500, status: "active", createdAt: "2026-08-01" }
  ],
  products: [
    { id: "p-hk2", name: "香港基础型", region: "香港", type: "KVM", cpu: 2, memory: 4, disk: 60, price: 99, cost: 55 },
    { id: "p-jp4", name: "日本性能型", region: "日本", type: "KVM", cpu: 4, memory: 8, disk: 120, price: 199, cost: 110 }
  ],
  services: [
    { id: "svc-1001", clientId: "c-demo", productId: "p-hk2", name: "HongKong-Web-01", status: "active", startDate: "2026-08-01", expiresAt: "2026-09-01", pveNode: "pve01", pveType: "qemu", pveVmid: "101", ipv4: "203.0.113.10", os: "Debian 12", allowedImageIds: ["debian12", "ubuntu2404"] },
    { id: "svc-1002", clientId: "c-demo", productId: "p-jp4", name: "Tokyo-API-01", status: "active", startDate: "2026-08-05", expiresAt: "2026-11-05", pveNode: "pve01", pveType: "qemu", pveVmid: "102", ipv4: "203.0.113.11", os: "Ubuntu 24.04", allowedImageIds: ["debian12", "ubuntu2404"] }
  ],
  natMappings: DEFAULT_NAT_MAPPINGS,
  osTemplates: [
    { id: "debian12", name: "Debian 12", pveType: "qemu", iso: "local:iso/debian-12.iso", enabled: true },
    { id: "ubuntu2404", name: "Ubuntu 24.04 LTS", pveType: "qemu", iso: "local:iso/ubuntu-24.04-live-server.iso", enabled: true }
  ],
  invoices: [
    { id: "INV-202608-001", clientId: "c-demo", serviceId: "svc-1001", title: "香港基础型 1 个月", amount: 99, paid: 99, status: "paid", createdAt: "2026-08-01", paidAt: "2026-08-01" }
  ],
  payments: [
    { id: "pay-demo", invoiceId: "INV-202608-001", serviceId: "svc-1001", clientId: "c-demo", amount: 99, method: "余额", date: "2026-08-01", note: "客户自助续费" }
  ],
  expenses: [],
  operationLogs: []
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon"
};

const publicFiles = new Set(["/index.html", "/styles.css", "/app.js", "/console.html", "/console.css", "/console.js", "/vendor/novnc.js", "/assets/fonts/GoogleSansCode-Variable.ttf"]);

function account(id, username, password, role, clientId) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { id, username, passwordHash: hashPassword(password, salt), salt, role, clientId, enabled: true, loginCount: 0, loginHistory: [], passwordChangedAt: new Date().toISOString() };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeJson(DB_FILE, defaultState);
  if (!fs.existsSync(PVE_FILE)) {
    writeJson(PVE_FILE, { host: "", port: 8006, tokenId: "", tokenSecret: "", rejectUnauthorized: false });
  }
  if (!fs.existsSync(MAIL_FILE)) {
    writeJson(MAIL_FILE, { host: "", port: 465, secure: true, user: "", password: "", fromEmail: "", senderName: "tidc", adminEmail: "", rejectUnauthorized: true });
  }
  if (!fs.existsSync(REGISTRATION_FILE)) writeJson(REGISTRATION_FILE, []);
  if (!fs.existsSync(PASSWORD_RESET_FILE)) writeJson(PASSWORD_RESET_FILE, []);
  if (!fs.existsSync(MAIL_LOG_FILE)) writeJson(MAIL_LOG_FILE, { sent: [], lastRunAt: null });
  const storedMail = readJson(MAIL_FILE, {});
  if (storedMail.senderName === "CloudDesk") {
    storedMail.senderName = "tidc";
    writeJson(MAIL_FILE, storedMail);
  }
  const stored = readJson(DB_FILE, {});
  writeJson(DB_FILE, normalizeState(stored));
}

function normalizeState(input) {
  const incoming = input || {};
  const state = {
    users: [], clients: [], products: [], services: [], osTemplates: [],
    invoices: [], payments: [], expenses: [], operationLogs: [], natMappings: [], purchaseOrders: [],
    ...incoming
  };

  for (const key of ["users", "clients", "products", "services", "osTemplates", "invoices", "payments", "expenses", "operationLogs", "natMappings", "purchaseOrders"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }

  if (!state.users.some((user) => user.role === "admin")) state.users.push(clone(defaultState.users[0]));
  if (state.users.length === 1 && state.clients.length) {
    state.users.push(account("u-migrated-demo", "demo", "123456", "client", state.clients[0].id));
  }
  if (!state.osTemplates.length) state.osTemplates = clone(defaultState.osTemplates);
  if (!state.natMappings.length) state.natMappings = clone(DEFAULT_NAT_MAPPINGS);
  state.users = state.users.map((user) => ({ loginCount: 0, loginHistory: [], ...user, loginHistory: Array.isArray(user.loginHistory) ? user.loginHistory.slice(0, 50) : [] }));

  if (!state.services.length && Array.isArray(incoming.orders)) {
    state.services = incoming.orders.map((order) => ({
      id: order.id,
      clientId: order.clientId,
      productId: order.productId,
      name: order.id,
      status: order.status || "active",
      startDate: order.startDate || today(),
      expiresAt: addMonths(order.startDate || today(), order.months || 1),
      pveNode: order.pveNode || "",
      pveType: order.pveType || "qemu",
      pveVmid: order.pveVmid || "",
      ipv4: "",
      os: "",
      allowedImageIds: []
    }));
  }

  state.clients = state.clients.map((client) => ({ balance: 0, status: "active", ...client }));
  state.products = state.products.map((product) => {
    const name = String(product.name || "");
    const cpu = Number(product.cpu || name.match(/(\d+)C/i)?.[1] || 0);
    const memory = Number(product.memory || name.match(/C\s*(\d+)G/i)?.[1] || 0);
    const diskMatches = [...name.matchAll(/(\d+)G/gi)];
    const disk = Number(product.disk || diskMatches.at(-1)?.[1] || 0);
    return { type: "KVM", region: "", publicIp: "", cost: 0, price: 0, ...product, cpu, memory, disk };
  });
  state.services = state.services.map((service) => {
    const normalized = { status: "active", pveNode: "", pveType: "qemu", pveVmid: "", ipv4: "", internalIp: "", portStart: 0, portEnd: 0, remotePort: 0, remoteUsername: "Administrator", remotePassword: "QwQ2026!", os: "", allowedImageIds: [], ...service };
    const mapping = state.natMappings.find((item) => String(item.pveVmid) === String(normalized.pveVmid) && item.pveType === (normalized.pveType === "lxc" ? "lxc" : "qemu"));
    if (mapping) {
      normalized.internalIp = normalized.internalIp || mapping.internalIp;
      normalized.portStart = Number(normalized.portStart || mapping.portStart);
      normalized.portEnd = Number(normalized.portEnd || mapping.portEnd);
      normalized.remotePort = Number(normalized.remotePort || mapping.portStart);
    }
    if (!normalized.allowedImageIds.length) {
      normalized.allowedImageIds = state.osTemplates.filter((image) => image.pveType === (normalized.pveType === "lxc" ? "lxc" : "qemu") && image.enabled !== false).map((image) => image.id);
    }
    return normalized;
  });
  return state;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return clone(fallback); }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, statusCode, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message });
}

function sendDownload(res, contentType, filename, content) {
  const body = Buffer.from(content, "utf8");
  const encodedFilename = encodeURIComponent(filename);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Content-Disposition": `attachment; filename="tidc-finance.xls"; filename*=UTF-8''${encodedFilename}`,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error("JSON 格式不正确")); }
    });
  });
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function sequence(prefix, rows) {
  const ym = today().slice(0, 7).replace("-", "");
  const count = rows.filter((row) => String(row.id).startsWith(`${prefix}-${ym}`)).length + 1;
  return `${prefix}-${ym}-${String(count).padStart(3, "0")}`;
}

function today() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + Number(months));
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function cookieMap(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((item) => item.length === 2));
}

function clientIp(req) {
  let value = String(req.socket.remoteAddress || "unknown");
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) value = String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return value.replace(/^::ffff:/, "") || "unknown";
}

function currentUser(req, state) {
  const sessionId = cookieMap(req).sid;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.expiresAt < Date.now()) return null;
  return state.users.find((user) => user.id === session.userId && user.enabled !== false) || null;
}

function requireUser(req, res, state, role) {
  const user = currentUser(req, state);
  if (!user) { sendError(res, 401, "请先登录"); return null; }
  if (role && user.role !== role) { sendError(res, 403, "没有操作权限"); return null; }
  return user;
}

function safeUser(user, state) {
  const client = user.clientId ? state.clients.find((item) => item.id === user.clientId) : null;
  return { id: user.id, username: user.username, role: user.role, clientId: user.clientId || "", name: client?.name || "管理员" };
}

function publicState(state) {
  return { ...state, users: state.users.map(({ passwordHash, salt, ...user }) => user) };
}

const FINANCIAL_LOG_ACTIONS = new Set([
  "manual-topup", "adjust-client-balance", "approve-purchase", "reject-purchase",
  "purchase-request", "purchase", "renew", "topup", "recharge", "payment",
  "invoice", "expense", "clear-finance"
]);

function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function excelCell(value, type = "String", style = "") {
  const safeType = type === "Number" && Number.isFinite(Number(value)) ? "Number" : "String";
  const safeValue = safeType === "Number" ? Number(value) : value ?? "";
  return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${safeType}">${xmlEscape(safeValue)}</Data></Cell>`;
}

function excelSheet(name, headers, rows, numericColumns = []) {
  const numeric = new Set(numericColumns);
  const headerRow = `<Row>${headers.map((header) => excelCell(header, "String", "Header")).join("")}</Row>`;
  const dataRows = rows.map((row) => `<Row>${row.map((value, index) => excelCell(value, numeric.has(index) ? "Number" : "String")).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${xmlEscape(name.slice(0, 31))}"><Table>${headerRow}${dataRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
}

function financeWorkbook(state) {
  const clients = new Map(state.clients.map((client) => [client.id, client]));
  const services = new Map(state.services.map((service) => [service.id, service]));
  const payments = Array.isArray(state.payments) ? state.payments : [];
  const invoices = Array.isArray(state.invoices) ? state.invoices : [];
  const expenses = Array.isArray(state.expenses) ? state.expenses : [];
  const orders = Array.isArray(state.purchaseOrders) ? state.purchaseOrders : [];
  const income = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const spending = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const balance = state.clients.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const sheets = [
    excelSheet("财务汇总", ["项目", "数值"], [
      ["导出时间", new Date().toLocaleString("zh-CN", { timeZone: BUSINESS_TIME_ZONE, hour12: false })],
      ["累计收付款", income], ["累计支出", spending], ["账面差额", income - spending], ["客户余额合计", balance],
      ["收付款笔数", payments.length], ["账单数量", invoices.length], ["支出笔数", expenses.length], ["购买订单数", orders.length]
    ], [1]),
    excelSheet("收付款流水", ["流水号", "日期", "客户", "关联服务", "订单号", "方式", "金额", "备注", "调整前余额", "调整后余额"], payments.map((item) => [
      item.id, item.date, clients.get(item.clientId)?.name || item.clientId || "", services.get(item.serviceId)?.name || item.serviceId || "", item.orderId || "", item.method || "", Number(item.amount || 0), item.note || "", item.balanceBefore ?? "", item.balanceAfter ?? ""
    ]), [6, 8, 9]),
    excelSheet("账单", ["账单号", "日期", "客户", "关联服务", "订单号", "标题", "金额", "已付", "状态", "支付日期"], invoices.map((item) => [
      item.id, item.createdAt, clients.get(item.clientId)?.name || item.clientId || "", services.get(item.serviceId)?.name || item.serviceId || "", item.orderId || "", item.title || "", Number(item.amount || 0), Number(item.paid || 0), item.status || "", item.paidAt || ""
    ]), [6, 7]),
    excelSheet("支出", ["支出号", "日期", "分类", "金额", "备注"], expenses.map((item) => [item.id, item.date, item.category || item.type || "", Number(item.amount || 0), item.note || ""]), [3]),
    excelSheet("客户余额", ["客户编号", "客户名称", "联系邮箱", "余额", "状态"], state.clients.map((client) => [client.id, client.name, client.contact || "", Number(client.balance || 0), client.status || ""]), [3]),
    excelSheet("购买订单", ["订单号", "创建时间", "客户", "套餐编号", "周期（月）", "金额", "状态", "节点", "VMID", "服务编号", "备注"], orders.map((order) => [
      order.id, order.createdAt, clients.get(order.clientId)?.name || order.clientId || "", order.productId || "", Number(order.months || 0), Number(order.amount || 0), order.status || "", order.pveNode || "", order.pveVmid || "", order.serviceId || "", order.note || ""
    ]), [4, 5])
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="10"/></Style><Style ss:ID="Header"><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#DFF3EE" ss:Pattern="Solid"/></Style></Styles>${sheets.join("")}</Workbook>`;
}

function clearFinancialData(state, user) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilename = `db-before-finance-clear-${stamp}.json`;
  fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, backupFilename));
  const cleared = {
    invoices: state.invoices.length,
    payments: state.payments.length,
    expenses: state.expenses.length,
    purchaseOrders: state.purchaseOrders.length,
    legacyOrders: Array.isArray(state.orders) ? state.orders.length : 0,
    financialLogs: state.operationLogs.filter((log) => FINANCIAL_LOG_ACTIONS.has(log.action)).length,
    balanceTotal: state.clients.reduce((sum, client) => sum + Number(client.balance || 0), 0)
  };
  state.invoices = [];
  state.payments = [];
  state.expenses = [];
  state.purchaseOrders = [];
  delete state.orders;
  state.clients = state.clients.map((client) => ({ ...client, balance: 0 }));
  state.operationLogs = state.operationLogs.filter((log) => !FINANCIAL_LOG_ACTIONS.has(log.action));
  addLog(state, user, null, "clear-finance", `备份 ${backupFilename}`);
  writeJson(DB_FILE, state);
  return { cleared, backupFilename };
}

function publicPveConfig(config) {
  return { host: config.host || "", port: Number(config.port || 8006), tokenId: config.tokenId || "", rejectUnauthorized: Boolean(config.rejectUnauthorized), hasTokenSecret: Boolean(config.tokenSecret) };
}

function publicMailConfig(config) {
  return {
    host: config.host || "",
    port: Number(config.port || 465),
    secure: config.secure !== false,
    user: config.user || "",
    fromEmail: config.fromEmail || "",
    senderName: config.senderName || "tidc",
    portalUrl: config.portalUrl || "",
    adminEmail: config.adminEmail || "",
    rejectUnauthorized: config.rejectUnauthorized !== false,
    hasPassword: Boolean(config.password),
    configured: Boolean(config.host && config.fromEmail && (!config.user || config.password)),
    notificationsEnabled: Boolean(config.notificationsEnabled),
    expiry5Enabled: config.expiry5Enabled !== false,
    expiry3Enabled: config.expiry3Enabled !== false,
    deletionWarningEnabled: config.deletionWarningEnabled !== false,
    purchaseEnabled: config.purchaseEnabled !== false,
    renewalEnabled: config.renewalEnabled !== false,
    topupEnabled: config.topupEnabled !== false,
    unbindEnabled: config.unbindEnabled !== false,
    adminPurchaseEnabled: config.adminPurchaseEnabled !== false,
    adminExpiryEnabled: config.adminExpiryEnabled !== false,
    lastReminderRunAt: readJson(MAIL_LOG_FILE, { lastRunAt: null }).lastRunAt || null
  };
}

function mailTransport(config) {
  if (!config.host || !config.fromEmail || (config.user && !config.password)) throw Object.assign(new Error("管理员尚未完成 SMTP 邮件配置"), { statusCode: 503 });
  const transportKey = crypto.createHash("sha256").update(JSON.stringify({ host: config.host, port: config.port, secure: config.secure, user: config.user, password: config.password, rejectUnauthorized: config.rejectUnauthorized })).digest("hex");
  if (cachedMailTransport && cachedMailTransportKey === transportKey) return cachedMailTransport;
  if (cachedMailTransport?.close) cachedMailTransport.close();
  cachedMailTransportKey = transportKey;
  cachedMailTransport = nodemailer.createTransport({
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    host: config.host,
    port: Number(config.port || (config.secure === false ? 587 : 465)),
    secure: config.secure !== false,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    tls: { rejectUnauthorized: config.rejectUnauthorized !== false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
  return cachedMailTransport;
}

function resetMailTransport() {
  if (cachedMailTransport?.close) cachedMailTransport.close();
  cachedMailTransport = null;
  cachedMailTransportKey = "";
}

function emailAddress(config) {
  const name = String(config.senderName || "tidc").replace(/[\r\n"]/g, "").trim();
  return name ? `"${name}" <${config.fromEmail}>` : config.fromEmail;
}

function portalActionUrl(config, nextView = "") {
  try {
    const portalUrl = new URL(String(config.portalUrl || ""));
    if (!["http:", "https:"].includes(portalUrl.protocol)) return "";
    if (nextView) portalUrl.searchParams.set("next", nextView);
    return portalUrl.toString();
  } catch { return ""; }
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function verificationHash(id, code) {
  return crypto.createHash("sha256").update(`${id}:${code}`).digest("hex");
}

function pendingRegistrations() {
  const now = Date.now();
  const records = readJson(REGISTRATION_FILE, []);
  return (Array.isArray(records) ? records : []).filter((item) => Number(item.expiresAt || 0) > now);
}

async function sendVerificationEmail(email, code) {
  const config = readJson(MAIL_FILE, {});
  const transport = mailTransport(config);
  await transport.sendMail({
    from: emailAddress(config),
    to: email,
    subject: "tidc 邮箱验证码",
    text: `您的 tidc 注册验证码是：${code}\n\n验证码 10 分钟内有效。如非本人操作，请忽略本邮件。`,
    html: mailTemplate({ label: "EMAIL VERIFICATION", title: "验证您的邮箱", intro: "您正在注册 tidc 客户账户，请使用下方验证码完成邮箱验证。", code, note: "验证码 10 分钟内有效。如非本人操作，请忽略本邮件。", actionUrl: config.portalUrl })
  });
}

function passwordResetRecords() {
  const now = Date.now();
  const records = readJson(PASSWORD_RESET_FILE, []);
  return (Array.isArray(records) ? records : []).filter((item) => Number(item.expiresAt || 0) > now);
}

function notificationRecipient(state, clientId) {
  const client = state.clients.find((item) => item.id === clientId);
  const user = state.users.find((item) => item.clientId === clientId && item.role === "client");
  const contact = normalizedEmail(client?.contact);
  if (validEmail(contact)) return { email: contact, name: client?.name || user?.username || "客户" };
  const username = normalizedEmail(user?.username);
  if (validEmail(username)) return { email: username, name: client?.name || username };
  return null;
}

async function sendConfiguredMail(to, subject, text, html) {
  const config = readJson(MAIL_FILE, {});
  return mailTransport(config).sendMail({ from: emailAddress(config), to, subject, text, ...(html ? { html } : {}) });
}

function serviceMailEnabled(config, kind) {
  if (!config.notificationsEnabled) return false;
  const flags = { purchase: "purchaseEnabled", renewal: "renewalEnabled", unbind: "unbindEnabled" };
  return config[flags[kind]] !== false;
}

async function sendServiceNotification(state, service, kind, details = {}) {
  const config = readJson(MAIL_FILE, {});
  if (!serviceMailEnabled(config, kind)) return false;
  const recipient = notificationRecipient(state, service.clientId);
  if (!recipient) return false;
  const product = state.products.find((item) => item.id === service.productId);
  const spec = product ? `${Number(product.cpu || 0)}H${Number(product.memory || 0)}G · ${Number(product.disk || 0)}G` : "-";
  const publicHost = product?.publicIp || service.ipv4 || "";
  const remoteAddress = publicHost && service.remotePort ? `${publicHost}:${service.remotePort}` : publicHost || "未配置";
  let subject;
  let text;
  let html;
  if (kind === "purchase") {
    const customerLoginUrl = portalActionUrl(config, "my-services");
    subject = `实例已开通：${service.name}`;
    text = `${recipient.name}，您好：\n\n您的实例 ${service.name} 已审核通过并成功开通。\nVMID：${service.pveVmid || "-"}\n配置：${spec}\n远程地址：${remoteAddress}\n远程用户名：${service.remoteUsername || "Administrator"}\n到期时间：${service.expiresAt || "-"}${customerLoginUrl ? `\n客户后台：${customerLoginUrl}` : ""}\n\n请登录 tidc 客户后台查看完整凭据并管理实例。`;
    html = mailTemplate({ label: "VPS ACTIVATED", title: "您的 VPS 已成功开通", intro: `${recipient.name}，您的购买订单已经审核通过，实例现已可以使用。`, details: [["实例名称", service.name], ["VMID", service.pveVmid || "-"], ["套餐配置", spec], ["远程地址", remoteAddress], ["远程用户名", service.remoteUsername || "Administrator"], ["开通周期", details.months ? `${details.months} 个月` : "-"], ["到期时间", service.expiresAt || "-"]], note: "远程密码请登录客户后台查看。首次登录后建议及时修改系统密码并妥善保存。", actionUrl: customerLoginUrl });
  } else if (kind === "renewal") {
    subject = `续费成功：${service.name}`;
    text = `${recipient.name}，您好：\n\n您的实例 ${service.name} 已续费 ${details.months || "-"} 个月。\n支付金额：¥${Number(details.amount || 0).toFixed(2)}\n最新到期时间：${service.expiresAt || "-"}`;
    html = mailTemplate({ label: "RENEWAL COMPLETE", title: "续费已经完成", intro: `${recipient.name}，您的 VPS 续费已成功入账，服务时间已经更新。`, details: [["实例名称", service.name], ["续费周期", `${details.months || "-"} 个月`], ["支付金额", `¥${Number(details.amount || 0).toFixed(2)}`], ["最新到期时间", service.expiresAt || "-"]], actionUrl: config.portalUrl });
  } else {
    subject = `实例绑定已移除：${service.name}`;
    text = `${recipient.name}，您好：\n\n实例 ${service.name} 已从客户服务中心解除绑定。\n节点：${service.pveNode || "-"}\nVMID：${service.pveVmid || "-"}`;
    html = mailTemplate({ label: "SERVICE UPDATE", title: "实例绑定已移除", intro: `${recipient.name}，以下实例已从您的 tidc 客户账户中解除绑定。`, details: [["实例名称", service.name], ["VMID", service.pveVmid || "-"]], accent: "#d76b5d", actionUrl: config.portalUrl });
  }
  await sendConfiguredMail(recipient.email, subject, text, html);
  return true;
}

async function sendTopupNotification(state, client, adjustment) {
  const config = readJson(MAIL_FILE, {});
  if (!config.notificationsEnabled || config.topupEnabled === false) return false;
  const recipient = notificationRecipient(state, client.id);
  if (!recipient) return false;
  const amount = Math.abs(Number(adjustment.delta || adjustment.amount || 0));
  const subject = `充值到账：¥${amount.toFixed(2)}`;
  const text = `${recipient.name}，您好：\n\n管理员已为您的 tidc 账户充值 ¥${amount.toFixed(2)}。\n入账方式：${adjustment.method || "人工充值"}\n充值备注：${adjustment.note || "账户充值"}\n当前余额：¥${Number(adjustment.newBalance || 0).toFixed(2)}\n\n您现在可以登录客户后台购买或续费 VPS。`;
  const html = mailTemplate({ label: "BALANCE CREDITED", title: "充值已到账", intro: `${recipient.name}，管理员人工充值已处理完成，款项已经计入您的 tidc 账户。`, details: [["充值金额", `¥${amount.toFixed(2)}`], ["入账方式", adjustment.method || "人工充值"], ["充值备注", adjustment.note || "账户充值"], ["当前余额", `¥${Number(adjustment.newBalance || 0).toFixed(2)}`], ["入账时间", new Date().toLocaleString("zh-CN", { timeZone: BUSINESS_TIME_ZONE, hour12: false })]], actionUrl: config.portalUrl, accent: "#16866f" });
  await sendConfiguredMail(recipient.email, subject, text, html);
  return true;
}

async function sendAdminPurchaseNotification(state, order, product, client) {
  const config = readJson(MAIL_FILE, {});
  const adminEmail = normalizedEmail(config.adminEmail);
  if (!config.notificationsEnabled || config.adminPurchaseEnabled === false || !validEmail(adminEmail)) return false;
  const contact = notificationRecipient(state, client.id)?.email || client.contact || "未绑定邮箱";
  const spec = `${Number(product.cpu || 0)}H${Number(product.memory || 0)}G · ${Number(product.disk || 0)}G`;
  const subject = `[tidc] 新购买订单：${order.id}`;
  const text = `有客户提交了新的服务器购买订单。\n\n订单：${order.id}\n客户：${client.name}\n联系邮箱：${contact}\n套餐：${product.name}\n配置：${spec}\n周期：${order.months} 个月\n金额：¥${Number(order.amount || 0).toFixed(2)}\n\n请登录 tidc 管理后台审核并分配 PVE 实例。`;
  const html = mailTemplate({ label: "NEW PURCHASE ORDER", title: "有新的 VPS 订单待审核", intro: "客户已经完成余额支付，请进入管理后台审核订单并手动分配 PVE 实例。", details: [["订单编号", order.id], ["客户", client.name], ["联系邮箱", contact], ["套餐", product.name], ["配置", spec], ["购买周期", `${order.months} 个月`], ["订单金额", `¥${Number(order.amount || 0).toFixed(2)}`]], actionUrl: config.portalUrl, actionLabel: "打开 tidc 管理后台", accent: "#c58425" });
  await sendConfiguredMail(adminEmail, subject, text, html);
  return true;
}

function daysUntil(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) return null;
  const target = Date.parse(`${dateString}T00:00:00Z`);
  const current = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((target - current) / 86400000);
}

async function runExpiryNotifications() {
  const config = readJson(MAIL_FILE, {});
  const state = normalizeState(readJson(DB_FILE, defaultState));
  const log = readJson(MAIL_LOG_FILE, { sent: [], lastRunAt: null });
  const sentKeys = new Set(Array.isArray(log.sent) ? log.sent.map((item) => item.key) : []);
  const result = { enabled: Boolean(config.notificationsEnabled), checked: 0, sent: 0, skipped: 0, noEmail: 0, adminSent: 0, adminSkipped: 0, adminNoEmail: 0 };
  if (!config.notificationsEnabled) {
    writeJson(MAIL_LOG_FILE, { sent: Array.isArray(log.sent) ? log.sent : [], lastRunAt: new Date().toISOString() });
    return result;
  }
  for (const service of state.services) {
    const days = daysUntil(service.expiresAt);
    let type = "";
    if (days === 5 && config.expiry5Enabled !== false) type = "expiry-5";
    if (days === 3 && config.expiry3Enabled !== false) type = "expiry-3";
    if (days === 0 && config.deletionWarningEnabled !== false) type = "deletion-warning";
    const shouldNotifyAdmin = days !== null && days <= 0 && config.adminExpiryEnabled !== false;
    if (!type && !shouldNotifyAdmin) continue;
    result.checked += 1;
    if (type) {
      const key = `${type}:${service.id}:${service.expiresAt}`;
      if (sentKeys.has(key)) result.skipped += 1;
      else {
        const recipient = notificationRecipient(state, service.clientId);
        if (!recipient) result.noEmail += 1;
        else {
          const subject = type === "deletion-warning" ? `实例已到期，请避免删除：${service.name}` : `实例将在 ${days} 天后到期：${service.name}`;
          const text = type === "deletion-warning"
            ? `${recipient.name}，您好：\n\n您的实例 ${service.name} 已于 ${service.expiresAt} 到期，可能被暂停或删除。请尽快登录 tidc 续费并备份重要数据。`
            : `${recipient.name}，您好：\n\n您的实例 ${service.name} 将在 ${days} 天后到期。\n到期时间：${service.expiresAt}\n请及时登录 tidc 续费。`;
          const html = type === "deletion-warning"
            ? mailTemplate({ label: "SERVICE EXPIRED", title: "您的 VPS 已到期", intro: `${recipient.name}，您的实例服务期已经结束，请尽快处理续费并确认重要数据已经备份。`, details: [["实例名称", service.name], ["VMID", service.pveVmid || "-"], ["到期时间", service.expiresAt]], note: "到期实例可能被暂停或删除。为避免数据丢失，请尽快登录客户后台续费。", actionUrl: config.portalUrl, accent: "#d76b5d" })
            : mailTemplate({ label: "EXPIRY REMINDER", title: `您的 VPS 将在 ${days} 天后到期`, intro: `${recipient.name}，请在到期日前完成续费，以免服务中断。`, details: [["实例名称", service.name], ["VMID", service.pveVmid || "-"], ["剩余时间", `${days} 天`], ["到期时间", service.expiresAt]], actionUrl: config.portalUrl, accent: "#c58425" });
          try {
            await sendConfiguredMail(recipient.email, subject, text, html);
            log.sent = [...(Array.isArray(log.sent) ? log.sent : []), { key, serviceId: service.id, type, email: recipient.email, sentAt: new Date().toISOString() }].slice(-5000);
            sentKeys.add(key);
            result.sent += 1;
          } catch (error) { console.error(`到期提醒发送失败 (${service.id})：${error.message}`); }
        }
      }
    }
    if (shouldNotifyAdmin) {
      const adminEmail = normalizedEmail(config.adminEmail);
      const key = `admin-expiry:${service.id}:${service.expiresAt}`;
      if (sentKeys.has(key)) result.adminSkipped += 1;
      else if (!validEmail(adminEmail)) result.adminNoEmail += 1;
      else {
        const client = state.clients.find((item) => item.id === service.clientId);
        const recipient = notificationRecipient(state, service.clientId);
        const subject = `[tidc] 客户实例已到期：${service.name}`;
        const text = `客户实例已经到期。\n\n客户：${client?.name || "未知客户"}\n联系邮箱：${recipient?.email || client?.contact || "未绑定邮箱"}\n实例：${service.name}\n节点：${service.pveNode || "-"}\nVMID：${service.pveVmid || "-"}\n到期时间：${service.expiresAt}\n已到期天数：${Math.abs(days)} 天`;
        const html = mailTemplate({ label: "ADMIN EXPIRY ALERT", title: "客户 VPS 已到期", intro: "以下客户实例已经到期，请登录管理后台确认续费、暂停或数据处理安排。", details: [["客户", client?.name || "未知客户"], ["联系邮箱", recipient?.email || client?.contact || "未绑定邮箱"], ["实例名称", service.name], ["VMID", service.pveVmid || "-"], ["到期时间", service.expiresAt], ["已到期", `${Math.abs(days)} 天`]], actionUrl: config.portalUrl, actionLabel: "打开 tidc 管理后台", accent: "#d76b5d" });
        try {
          await sendConfiguredMail(adminEmail, subject, text, html);
          log.sent = [...(Array.isArray(log.sent) ? log.sent : []), { key, serviceId: service.id, type: "admin-expiry", email: adminEmail, sentAt: new Date().toISOString() }].slice(-5000);
          sentKeys.add(key);
          result.sent += 1;
          result.adminSent += 1;
        } catch (error) { console.error(`管理员到期通知发送失败 (${service.id})：${error.message}`); }
      }
    }
  }
  log.lastRunAt = new Date().toISOString();
  writeJson(MAIL_LOG_FILE, log);
  return result;
}

function pveRequest(apiPath, method = "GET", payload = null) {
  const config = readJson(PVE_FILE, {});
  const host = String(config.host || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const port = Number(config.port || 8006);
  if (!host || !config.tokenId || !config.tokenSecret) return Promise.reject(Object.assign(new Error("请先在管理端配置 PVE API"), { statusCode: 409 }));

  const body = payload ? new URLSearchParams(Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")).toString() : "";
  const options = {
    hostname: host, port, path: `/api2/json${apiPath}`, method,
    rejectUnauthorized: Boolean(config.rejectUnauthorized),
    headers: { Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}` },
    timeout: 15000
  };
  if (body) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let responseBody = "";
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(responseBody || "{}"); } catch { return reject(new Error(`PVE 返回格式异常，HTTP ${response.statusCode}`)); }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let message = parsed.message || parsed.error || `PVE 请求失败，HTTP ${response.statusCode}`;
          if (response.statusCode === 401) message = "PVE 身份验证失败（HTTP 401），请重新核对 Token ID 和 Token Secret";
          if (response.statusCode === 403) message = "PVE Token 权限不足（HTTP 403），请为 Token 单独分配所需 ACL";
          return reject(Object.assign(new Error(message), { statusCode: 502 }));
        }
        resolve(parsed.data ?? parsed);
      });
    });
    request.on("timeout", () => request.destroy(new Error("连接 PVE 超时")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function parsePveTags(value) {
  return String(value || "").split(";").map((tag) => tag.trim()).filter(Boolean);
}

function isManagedExpiryTag(tag) {
  return tag === LEGACY_EXPIRY_TAG || EXPIRY_TAG_PATTERN.test(tag);
}

async function syncServiceExpiryTag(service) {
  if (!service.pveNode || !service.pveVmid) return { status: "skipped", reason: "未绑定 PVE" };
  const remainingDays = daysUntil(service.expiresAt);
  if (remainingDays === null) return { status: "skipped", reason: "到期时间无效" };
  const apiPath = `${serviceApiPath(service)}/config`;
  const config = await pveRequest(apiPath);
  const tags = parsePveTags(config.tags);
  const tagSet = new Set(tags);
  const expired = remainingDays < 0;
  const managedTags = tags.filter(isManagedExpiryTag);
  const desiredTag = expired ? `expired-${Math.abs(remainingDays)}-days` : "";
  if ((!expired && !managedTags.length) || (expired && managedTags.length === 1 && managedTags[0] === desiredTag)) return { status: "unchanged", expired, tags, desiredTag };

  managedTags.forEach((tag) => tagSet.delete(tag));
  if (desiredTag) tagSet.add(desiredTag);
  const nextTags = [...tagSet];
  await pveRequest(apiPath, "PUT", nextTags.length ? { tags: nextTags.join(";") } : { delete: "tags" });
  const status = !expired ? "untagged" : managedTags.length ? "updated" : "tagged";
  return { status, expired, tags: nextTags, desiredTag };
}

async function syncExpiryTags(state) {
  const result = { checked: 0, tagged: 0, updated: 0, untagged: 0, unchanged: 0, skipped: 0, errors: [], tagPattern: "expired-N-days", checkedAt: new Date().toISOString() };
  for (const service of state.services) {
    try {
      const item = await syncServiceExpiryTag(service);
      result[item.status] = Number(result[item.status] || 0) + 1;
      if (item.status !== "skipped") result.checked += 1;
    } catch (error) {
      result.errors.push({ serviceId: service.id, name: service.name, node: service.pveNode || "", vmid: service.pveVmid || "", error: error.message });
    }
  }
  return result;
}

function ownedService(state, user, serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) throw Object.assign(new Error("服务不存在"), { statusCode: 404 });
  if (user.role !== "admin" && service.clientId !== user.clientId) throw Object.assign(new Error("无权操作这台虚拟机"), { statusCode: 403 });
  return service;
}

function serviceType(service) {
  return service.pveType === "lxc" ? "lxc" : "qemu";
}

function productType(product) {
  return String(product?.type || "KVM").toUpperCase().includes("LXC") ? "lxc" : "qemu";
}

function serviceApiPath(service) {
  if (!service.pveNode || !service.pveVmid) throw Object.assign(new Error("服务尚未绑定 PVE 虚拟机"), { statusCode: 409 });
  return `/nodes/${encodeURIComponent(service.pveNode)}/${serviceType(service)}/${encodeURIComponent(service.pveVmid)}`;
}

const RESOURCE_TIMEFRAMES = new Set(["hour", "day", "week", "month", "year"]);

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function resourceStatsPayload(req, service) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestedTimeframe = String(requestUrl.searchParams.get("timeframe") || "day");
  const timeframe = RESOURCE_TIMEFRAMES.has(requestedTimeframe) ? requestedTimeframe : "day";
  const rows = await pveRequest(`${serviceApiPath(service)}/rrddata?timeframe=${encodeURIComponent(timeframe)}&cf=AVERAGE`);
  const points = (Array.isArray(rows) ? rows : []).map((row) => ({
    time: finiteMetric(row.time),
    cpu: finiteMetric(row.cpu),
    mem: finiteMetric(row.mem),
    maxmem: finiteMetric(row.maxmem),
    netin: finiteMetric(row.netin),
    netout: finiteMetric(row.netout),
    diskread: finiteMetric(row.diskread),
    diskwrite: finiteMetric(row.diskwrite),
    disk: finiteMetric(row.disk),
    maxdisk: finiteMetric(row.maxdisk)
  })).filter((point) => point.time !== null).sort((a, b) => a.time - b.time);
  return {
    service: { id: service.id, name: service.name, node: service.pveNode, vmid: service.pveVmid, type: serviceType(service) },
    timeframe,
    points,
    fetchedAt: new Date().toISOString()
  };
}

function addLog(state, user, service, action, detail = "") {
  state.operationLogs.unshift({ id: uid("log"), userId: user.id, clientId: service?.clientId || user.clientId || "", serviceId: service?.id || "", action, detail, createdAt: new Date().toISOString() });
  state.operationLogs = state.operationLogs.slice(0, 500);
}

async function portalPayload(state, user) {
  const client = state.clients.find((item) => item.id === user.clientId);
  const services = state.services.filter((item) => item.clientId === user.clientId);
  let resources = [];
  try { resources = await pveRequest("/cluster/resources?type=vm"); } catch { resources = []; }
  const merged = services.map((service) => {
    const resource = resources.find((vm) => String(vm.vmid) === String(service.pveVmid) && (!service.pveNode || vm.node === service.pveNode));
    return { ...service, runtime: resource ? { status: resource.status, cpu: resource.cpu, mem: resource.mem, maxmem: resource.maxmem, uptime: resource.uptime } : null };
  });
  return {
    client,
    services: merged,
    products: state.products,
    purchaseOrders: state.purchaseOrders.filter((order) => order.clientId === user.clientId).slice().reverse(),
    osTemplates: state.osTemplates.filter((item) => item.enabled !== false),
    invoices: state.invoices.filter((item) => item.clientId === user.clientId).slice().reverse(),
    payments: state.payments.filter((item) => item.clientId === user.clientId).slice().reverse()
  };
}

async function issueConsoleTicket(state, user, service) {
  const consoleData = await pveRequest(`${serviceApiPath(service)}/vncproxy`, "POST", { websocket: 1 });
  const token = crypto.randomBytes(24).toString("hex");
  consoleTickets.set(token, {
    userId: user.id,
    serviceId: service.id,
    node: service.pveNode,
    type: serviceType(service),
    vmid: service.pveVmid,
    pveTicket: consoleData.ticket,
    port: consoleData.port,
    expiresAt: Date.now() + 45 * 1000,
    diagnosticExpiresAt: Date.now() + 5 * 60 * 1000,
    stage: "issued",
    error: ""
  });
  const cleanupTimer = setTimeout(() => consoleTickets.delete(token), 5 * 60 * 1000);
  cleanupTimer.unref();
  addLog(state, user, service, "vnc");
  writeJson(DB_FILE, state);
  const params = new URLSearchParams({ path: `api/portal/console/${token}`, name: service.name || `VM ${service.pveVmid}` });
  return { url: `/console.html?${params.toString()}`, expiresIn: 45 };
}

async function handleAuth(req, res, pathname, state) {
  if (req.method === "POST" && pathname === "/api/auth/register/request") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const email = normalizedEmail(body.email);
    const password = String(body.password || "");
    if (name.length < 2 || name.length > 60) return sendError(res, 400, "客户名称需要 2 至 60 个字符");
    if (!validEmail(email)) return sendError(res, 400, "邮箱格式不正确");
    if (password.length < 8 || password.length > 128) return sendError(res, 400, "密码需要 8 至 128 位");
    if (password !== String(body.confirmPassword || "")) return sendError(res, 400, "两次输入的密码不一致");
    if (state.users.some((item) => normalizedEmail(item.username) === email)) return sendError(res, 409, "该邮箱已经注册");

    const now = Date.now();
    const ip = clientIp(req);
    let records = pendingRegistrations();
    const previous = records.find((item) => item.email === email);
    if (previous && now - Number(previous.sentAt || 0) < 60 * 1000) return sendError(res, 429, "验证码发送过于频繁，请 60 秒后重试");
    if (records.filter((item) => item.requestIp === ip && now - Number(item.sentAt || 0) < 10 * 60 * 1000).length >= 5) return sendError(res, 429, "当前网络请求次数过多，请稍后重试");

    records = records.filter((item) => item.email !== email);
    const id = crypto.randomBytes(24).toString("hex");
    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const pending = {
      id,
      name,
      email,
      salt,
      passwordHash: hashPassword(password, salt),
      codeHash: verificationHash(id, code),
      requestIp: ip,
      attempts: 0,
      sentAt: now,
      expiresAt: now + 10 * 60 * 1000
    };
    records.push(pending);
    writeJson(REGISTRATION_FILE, records);
    try {
      await sendVerificationEmail(email, code);
    } catch (error) {
      writeJson(REGISTRATION_FILE, records.filter((item) => item.id !== id));
      console.error(`注册验证码发送失败：${error.message}`);
      return sendError(res, 502, "验证码发送失败，请检查邮箱地址或联系管理员");
    }
    return sendJson(res, 200, { ok: true, data: { registrationId: id, email, expiresIn: 600 } });
  }

  if (req.method === "POST" && pathname === "/api/auth/register/verify") {
    const body = await readBody(req);
    const registrationId = String(body.registrationId || "");
    const code = String(body.code || "").trim();
    const records = pendingRegistrations();
    const pending = records.find((item) => item.id === registrationId);
    if (!pending) return sendError(res, 410, "验证码已失效，请重新注册");
    if (!/^\d{6}$/.test(code) || verificationHash(registrationId, code) !== pending.codeHash) {
      pending.attempts = Number(pending.attempts || 0) + 1;
      writeJson(REGISTRATION_FILE, pending.attempts >= 5 ? records.filter((item) => item.id !== registrationId) : records);
      return sendError(res, 400, pending.attempts >= 5 ? "验证码错误次数过多，请重新注册" : "邮箱验证码不正确");
    }
    if (state.users.some((item) => normalizedEmail(item.username) === pending.email)) {
      writeJson(REGISTRATION_FILE, records.filter((item) => item.id !== registrationId));
      return sendError(res, 409, "该邮箱已经注册");
    }

    const login = { ip: clientIp(req), at: new Date().toISOString() };
    const client = { id: uid("client"), name: pending.name, contact: pending.email, balance: 0, status: "active", createdAt: today(), emailVerifiedAt: login.at };
    const newUser = {
      id: uid("user"),
      username: pending.email,
      passwordHash: pending.passwordHash,
      salt: pending.salt,
      role: "client",
      clientId: client.id,
      enabled: true,
      loginCount: 1,
      loginHistory: [login],
      lastLoginIp: login.ip,
      lastLoginAt: login.at,
      passwordChangedAt: login.at,
      emailVerifiedAt: login.at
    };
    state.clients.push(client);
    state.users.push(newUser);
    addLog(state, newUser, null, "self-register", pending.email);
    writeJson(DB_FILE, state);
    writeJson(REGISTRATION_FILE, records.filter((item) => item.id !== registrationId));
    const sid = crypto.randomBytes(32).toString("hex");
    sessions.set(sid, { userId: newUser.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return sendJson(res, 201, { ok: true, data: safeUser(newUser, state) }, { "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
  }

  if (req.method === "POST" && pathname === "/api/auth/password-reset/request") {
    const body = await readBody(req);
    const email = normalizedEmail(body.email);
    if (!validEmail(email)) return sendError(res, 400, "邮箱格式不正确");
    const now = Date.now();
    let records = passwordResetRecords();
    const previous = records.find((item) => item.email === email);
    if (previous && now - Number(previous.sentAt || 0) < 60 * 1000) return sendError(res, 429, "验证码发送过于频繁，请 60 秒后重试");
    records = records.filter((item) => item.email !== email);
    const id = crypto.randomBytes(24).toString("hex");
    const user = state.users.find((item) => item.role === "client" && item.emailVerifiedAt && normalizedEmail(item.username) === email);
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      records.push({ id, userId: user.id, email, codeHash: verificationHash(id, code), requestIp: clientIp(req), attempts: 0, sentAt: now, expiresAt: now + 10 * 60 * 1000 });
      writeJson(PASSWORD_RESET_FILE, records);
      try {
        await sendConfiguredMail(
          email,
          "tidc 密码重置验证码",
          `您的密码重置验证码是：${code}\n\n验证码 10 分钟内有效。如非本人操作，请忽略本邮件。`,
          mailTemplate({ label: "PASSWORD RESET", title: "重置登录密码", intro: "我们收到了您的密码重置请求，请使用下方验证码继续操作。", code, note: "验证码 10 分钟内有效。如非本人操作，请忽略本邮件。", accent: "#d76b5d", actionUrl: readJson(MAIL_FILE, {}).portalUrl })
        );
      } catch (error) {
        writeJson(PASSWORD_RESET_FILE, records.filter((item) => item.id !== id));
        console.error(`密码重置邮件发送失败：${error.message}`);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return sendJson(res, 200, { ok: true, data: { resetId: id, email, expiresIn: 600 }, message: "如果该邮箱已验证，验证码将发送到邮箱" });
  }

  if (req.method === "POST" && pathname === "/api/auth/password-reset/verify") {
    const body = await readBody(req);
    const resetId = String(body.resetId || "");
    const code = String(body.code || "").trim();
    const password = String(body.password || "");
    const records = passwordResetRecords();
    const pending = records.find((item) => item.id === resetId);
    if (!pending) return sendError(res, 410, "验证码已失效，请重新申请");
    if (!/^\d{6}$/.test(code) || verificationHash(resetId, code) !== pending.codeHash) {
      pending.attempts = Number(pending.attempts || 0) + 1;
      writeJson(PASSWORD_RESET_FILE, pending.attempts >= 5 ? records.filter((item) => item.id !== resetId) : records);
      return sendError(res, 400, pending.attempts >= 5 ? "验证码错误次数过多，请重新申请" : "邮箱验证码不正确");
    }
    if (password.length < 8 || password.length > 128) return sendError(res, 400, "新密码需要 8 至 128 位");
    if (password !== String(body.confirmPassword || "")) return sendError(res, 400, "两次输入的新密码不一致");
    const user = state.users.find((item) => item.id === pending.userId && item.emailVerifiedAt && normalizedEmail(item.username) === pending.email);
    if (!user) return sendError(res, 404, "账户不存在或邮箱未验证");
    const salt = crypto.randomBytes(16).toString("hex");
    user.salt = salt;
    user.passwordHash = hashPassword(password, salt);
    user.passwordChangedAt = new Date().toISOString();
    for (const [sessionId, activeSession] of sessions.entries()) {
      if (activeSession.userId === user.id) sessions.delete(sessionId);
    }
    addLog(state, user, null, "reset-password-by-email");
    writeJson(DB_FILE, state);
    writeJson(PASSWORD_RESET_FILE, records.filter((item) => item.id !== resetId));
    return sendJson(res, 200, { ok: true, message: "密码已重置，请使用新密码登录" });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const loginName = String(body.username || "").trim();
    const user = state.users.find((item) => (item.username === loginName || (loginName.includes("@") && normalizedEmail(item.username) === normalizedEmail(loginName))) && item.enabled !== false);
    if (!user || !verifyPassword(body.password, user)) return sendError(res, 401, "用户名或密码错误");
    const login = { ip: clientIp(req), at: new Date().toISOString() };
    user.lastLoginIp = login.ip;
    user.lastLoginAt = login.at;
    user.loginCount = Number(user.loginCount || 0) + 1;
    user.loginHistory = [login, ...(Array.isArray(user.loginHistory) ? user.loginHistory : [])].slice(0, 50);
    writeJson(DB_FILE, state);
    const sid = crypto.randomBytes(32).toString("hex");
    sessions.set(sid, { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return sendJson(res, 200, { ok: true, data: safeUser(user, state) }, { "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
  }
  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const sid = cookieMap(req).sid;
    if (sid) sessions.delete(sid);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }
  if (req.method === "GET" && pathname === "/api/auth/me") {
    const user = requireUser(req, res, state);
    if (!user) return;
    return sendJson(res, 200, { ok: true, data: safeUser(user, state) });
  }
  if (req.method === "PUT" && pathname === "/api/auth/password") {
    const user = requireUser(req, res, state);
    if (!user) return;
    const body = await readBody(req);
    if (!verifyPassword(body.currentPassword, user)) return sendError(res, 403, "当前密码不正确");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) return sendError(res, 400, "新密码至少需要 8 位");
    if (newPassword !== String(body.confirmPassword || "")) return sendError(res, 400, "两次输入的新密码不一致");
    if (verifyPassword(newPassword, user)) return sendError(res, 400, "新密码不能与当前密码相同");
    const salt = crypto.randomBytes(16).toString("hex");
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    user.passwordChangedAt = new Date().toISOString();
    const currentSid = cookieMap(req).sid;
    for (const [sessionId, activeSession] of sessions.entries()) {
      if (activeSession.userId === user.id && sessionId !== currentSid) sessions.delete(sessionId);
    }
    addLog(state, user, null, "change-own-password");
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, message: "密码已修改" });
  }
  return false;
}

async function handlePortal(req, res, pathname, state) {
  const user = requireUser(req, res, state);
  if (!user) return;

  const credentialsMatch = pathname.match(/^\/api\/portal\/console\/([a-f0-9]+)\/credentials$/);
  if (req.method === "GET" && credentialsMatch) {
    const ticket = consoleTickets.get(credentialsMatch[1]);
    if (!ticket || ticket.userId !== user.id || ticket.expiresAt < Date.now()) return sendError(res, 401, "VNC 临时票据已失效，请重新打开控制台");
    return sendJson(res, 200, { ok: true, data: { password: ticket.pveTicket, expiresAt: ticket.expiresAt } });
  }

  const consoleStatusMatch = pathname.match(/^\/api\/portal\/console\/([a-f0-9]+)\/status$/);
  if (req.method === "GET" && consoleStatusMatch) {
    const ticket = consoleTickets.get(consoleStatusMatch[1]);
    if (!ticket || ticket.userId !== user.id || ticket.diagnosticExpiresAt < Date.now()) return sendError(res, 404, "控制台诊断信息已失效");
    return sendJson(res, 200, { ok: true, data: { stage: ticket.stage, error: ticket.error || "", clientConnectedAt: ticket.clientConnectedAt || null, pveConnectedAt: ticket.pveConnectedAt || null } });
  }

  if (user.role !== "client") return sendError(res, 403, "没有客户服务访问权限");

  if (req.method === "GET" && pathname === "/api/portal") {
    return sendJson(res, 200, { ok: true, data: await portalPayload(state, user) });
  }

  if (req.method === "POST" && pathname === "/api/portal/purchase") {
    if (purchaseInProgress) return sendError(res, 409, "其他订单正在提交，请稍后重试");
    purchaseInProgress = true;
    try {
      const body = await readBody(req);
      const months = Number(body.months);
      if (![1, 3, 6, 12].includes(months)) return sendError(res, 400, "购买周期不正确");
      const latestState = normalizeState(readJson(DB_FILE, defaultState));
      const latestUser = latestState.users.find((item) => item.id === user.id && item.role === "client");
      const client = latestState.clients.find((item) => item.id === latestUser?.clientId);
      const product = latestState.products.find((item) => item.id === body.productId && !item.archivedAt);
      if (!latestUser || !client) return sendError(res, 409, "客户账户资料不完整");
      if (!product) return sendError(res, 404, "套餐不存在或已下架");
      const amount = Number(product.price || 0) * months;
      if (!Number.isFinite(amount) || amount < 0) return sendError(res, 409, "套餐价格配置不正确");
      if (Number(client.balance) < amount) return sendError(res, 409, `余额不足，还差 ¥${(amount - Number(client.balance)).toFixed(2)}`);
      const order = {
        id: sequence("ORD", latestState.purchaseOrders),
        clientId: client.id,
        productId: product.id,
        months,
        amount,
        status: "pending",
        createdAt: new Date().toISOString(),
        invoiceId: "",
        serviceId: "",
        note: ""
      };
      client.balance = Number(client.balance) - amount;
      const invoice = { id: sequence("INV", latestState.invoices), clientId: client.id, serviceId: "", orderId: order.id, title: `${product.name} ${months} 个月购买（待审核）`, amount, paid: amount, status: "paid", createdAt: today(), paidAt: today() };
      const payment = { id: uid("pay"), invoiceId: invoice.id, serviceId: "", orderId: order.id, clientId: client.id, amount, method: "余额", date: today(), note: "客户自助购买待审核" };
      order.invoiceId = invoice.id;
      latestState.purchaseOrders.push(order);
      latestState.invoices.push(invoice);
      latestState.payments.push(payment);
      addLog(latestState, latestUser, null, "purchase-request", `${order.id}；${product.name}；${months} 个月；¥${amount.toFixed(2)}`);
      writeJson(DB_FILE, latestState);
      void sendAdminPurchaseNotification(latestState, order, product, client).catch((error) => console.error(`管理员购买通知发送失败：${error.message}`));
      return sendJson(res, 201, { ok: true, data: await portalPayload(latestState, latestUser), order: { id: order.id, status: order.status } });
    } finally {
      purchaseInProgress = false;
    }
  }

  const statsMatch = pathname.match(/^\/api\/portal\/services\/([^/]+)\/stats$/);
  if (req.method === "GET" && statsMatch) {
    const service = ownedService(state, user, decodeURIComponent(statsMatch[1]));
    return sendJson(res, 200, { ok: true, data: await resourceStatsPayload(req, service) });
  }

  const match = pathname.match(/^\/api\/portal\/services\/([^/]+)\/(renew|action|reinstall|vnc)$/);
  if (!match || req.method !== "POST") return sendError(res, 404, "接口不存在");
  const service = ownedService(state, user, decodeURIComponent(match[1]));
  const operation = match[2];
  const body = await readBody(req);

  if (operation === "renew") {
    const months = Number(body.months);
    if (![1, 3, 6, 12].includes(months)) return sendError(res, 400, "续费周期不正确");
    const client = state.clients.find((item) => item.id === user.clientId);
    const product = state.products.find((item) => item.id === service.productId);
    if (!client || !product) return sendError(res, 409, "客户或套餐资料不完整");
    const amount = Number(product.price) * months;
    if (Number(client.balance) < amount) return sendError(res, 409, `余额不足，还差 ¥${(amount - Number(client.balance)).toFixed(2)}`);
    client.balance = Number(client.balance) - amount;
    const baseDate = service.expiresAt > today() ? service.expiresAt : today();
    service.expiresAt = addMonths(baseDate, months);
    service.status = "active";
    const invoice = { id: sequence("INV", state.invoices), clientId: client.id, serviceId: service.id, title: `${product.name} ${months} 个月续费`, amount, paid: amount, status: "paid", createdAt: today(), paidAt: today() };
    const payment = { id: uid("pay"), invoiceId: invoice.id, serviceId: service.id, clientId: client.id, amount, method: "余额", date: today(), note: "客户自助续费" };
    state.invoices.push(invoice);
    state.payments.push(payment);
    addLog(state, user, service, "renew", `${months} 个月，¥${amount.toFixed(2)}`);
    writeJson(DB_FILE, state);
    void syncServiceExpiryTag(service).catch((error) => console.error(`续费后移除 PVE 到期标记失败 (${service.id})：${error.message}`));
    void sendServiceNotification(state, service, "renewal", { months, amount }).catch((error) => console.error(`续费邮件发送失败：${error.message}`));
    return sendJson(res, 200, { ok: true, data: await portalPayload(state, user) });
  }

  if (operation === "action") {
    const allowed = new Set(["start", "shutdown", "reboot", "stop"]);
    if (!allowed.has(body.action)) return sendError(res, 400, "不支持的电源操作");
    const data = await pveRequest(`${serviceApiPath(service)}/status/${body.action}`, "POST");
    addLog(state, user, service, body.action);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data });
  }

  if (operation === "reinstall") {
    if (serviceType(service) !== "qemu") return sendError(res, 409, "当前版本仅支持 KVM/QEMU 使用 ISO 重装");
    const image = state.osTemplates.find((item) => item.id === body.imageId && item.enabled !== false && item.pveType === "qemu");
    if (!image || !service.allowedImageIds.includes(image.id)) return sendError(res, 403, "该系统镜像未授权给此服务");
    await pveRequest(`${serviceApiPath(service)}/status/stop`, "POST");
    await pveRequest(`${serviceApiPath(service)}/config`, "PUT", { ide2: `${image.iso},media=cdrom`, boot: "order=ide2;scsi0;virtio0;sata0" });
    await pveRequest(`${serviceApiPath(service)}/status/start`, "POST");
    service.os = `${image.name}（安装中）`;
    addLog(state, user, service, "reinstall", image.name);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, message: "已挂载安装镜像并启动虚拟机" });
  }

  if (operation === "vnc") {
    return sendJson(res, 200, { ok: true, data: await issueConsoleTicket(state, user, service) });
  }
}

async function handleAdmin(req, res, pathname, state) {
  const user = requireUser(req, res, state, "admin");
  if (!user) return;

  if (req.method === "GET" && pathname === "/api/admin/state") return sendJson(res, 200, { ok: true, data: publicState(state) });

  if (req.method === "GET" && pathname === "/api/admin/finance/export.xls") {
    return sendDownload(res, "application/vnd.ms-excel; charset=utf-8", `tidc-finance-${today()}.xls`, financeWorkbook(state));
  }

  if (req.method === "POST" && pathname === "/api/admin/finance/clear") {
    const body = await readBody(req);
    if (String(body.confirmation || "") !== "清空财务") return sendError(res, 400, "请输入“清空财务”确认操作");
    const result = clearFinancialData(state, user);
    return sendJson(res, 200, { ok: true, data: publicState(state), ...result });
  }

  const serviceStatsMatch = pathname.match(/^\/api\/admin\/services\/([^/]+)\/stats$/);
  if (req.method === "GET" && serviceStatsMatch) {
    const service = ownedService(state, user, decodeURIComponent(serviceStatsMatch[1]));
    return sendJson(res, 200, { ok: true, data: await resourceStatsPayload(req, service) });
  }

  if (req.method === "POST" && pathname === "/api/admin/clients") {
    const body = await readBody(req);
    if (!body.name || !body.username || !body.password) return sendError(res, 400, "客户名称、用户名和初始密码必填");
    if (String(body.password).length < 8) return sendError(res, 400, "初始密码至少需要 8 位");
    if (state.users.some((item) => item.username === body.username)) return sendError(res, 409, "用户名已存在");
    const client = { id: uid("client"), name: body.name, contact: body.contact || "", balance: Number(body.balance || 0), status: "active", createdAt: today() };
    state.clients.push(client);
    state.users.push(account(uid("user"), body.username, body.password, "client", client.id));
    writeJson(DB_FILE, state);
    return sendJson(res, 201, { ok: true, data: publicState(state) });
  }

  if (req.method === "POST" && pathname === "/api/admin/products") {
    const body = await readBody(req);
    const product = { id: uid("plan"), name: body.name, region: body.region || "", publicIp: String(body.publicIp || "").trim().slice(0, 255), type: body.type || "KVM", cpu: Number(body.cpu || 1), memory: Number(body.memory || 1), disk: Number(body.disk || 20), price: Number(body.price || 0), cost: Number(body.cost || 0) };
    if (!product.name || !product.publicIp || product.price < 0) return sendError(res, 400, "套餐名称、公网 IP 和价格资料必填");
    state.products.push(product);
    writeJson(DB_FILE, state);
    return sendJson(res, 201, { ok: true, data: publicState(state) });
  }

  if (req.method === "PUT" && pathname.match(/^\/api\/admin\/products\/[^/]+$/)) {
    const productId = decodeURIComponent(pathname.split("/")[4]);
    const product = state.products.find((item) => item.id === productId);
    if (!product) return sendError(res, 404, "套餐不存在");
    const body = await readBody(req);
    const updated = {
      name: String(body.name || "").trim(),
      region: String(body.region || "").trim(),
      publicIp: String(body.publicIp || "").trim().slice(0, 255),
      type: body.type === "LXC" ? "LXC" : "KVM",
      cpu: Number(body.cpu),
      memory: Number(body.memory),
      disk: Number(body.disk),
      price: Number(body.price),
      cost: Number(body.cost || 0)
    };
    if (!updated.name || !updated.region || !updated.publicIp || !Number.isFinite(updated.price) || updated.price < 0 || !Number.isFinite(updated.cost) || updated.cost < 0 || !Number.isFinite(updated.cpu) || updated.cpu < 1 || !Number.isFinite(updated.memory) || updated.memory < 1 || !Number.isFinite(updated.disk) || updated.disk < 1) return sendError(res, 400, "套餐资料不正确");
    Object.assign(product, updated);
    const affectedServices = state.services.filter((service) => service.productId === productId).length;
    addLog(state, user, null, "update-product", `${product.name} (${product.id})`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicState(state), affectedServices });
  }

  if (req.method === "DELETE" && pathname.match(/^\/api\/admin\/products\/[^/]+$/)) {
    const productId = decodeURIComponent(pathname.split("/")[4]);
    const product = state.products.find((item) => item.id === productId);
    if (!product) return sendError(res, 404, "套餐不存在");
    const usedBy = state.services.filter((item) => item.productId === productId).length;
    const pendingOrders = state.purchaseOrders.filter((item) => item.productId === productId && item.status === "pending").length;
    if (usedBy || pendingOrders) {
      product.archivedAt = new Date().toISOString();
      addLog(state, user, null, "archive-product", `${product.name} (${product.id})；${usedBy} 台实例使用中；${pendingOrders} 笔订单待审核`);
      writeJson(DB_FILE, state);
      return sendJson(res, 200, { ok: true, data: publicState(state), archived: true, usedBy, pendingOrders });
    }
    state.products = state.products.filter((item) => item.id !== productId);
    addLog(state, user, null, "delete-product", `${product.name} (${product.id})`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicState(state) });
  }

  const purchaseOrderMatch = pathname.match(/^\/api\/admin\/purchase-orders\/([^/]+)\/(approve|reject)$/);
  if (req.method === "POST" && purchaseOrderMatch) {
    const order = state.purchaseOrders.find((item) => item.id === decodeURIComponent(purchaseOrderMatch[1]));
    if (!order) return sendError(res, 404, "购买订单不存在");
    if (order.status !== "pending") return sendError(res, 409, "该订单已经处理");
    const client = state.clients.find((item) => item.id === order.clientId);
    const product = state.products.find((item) => item.id === order.productId);
    if (!client || !product) return sendError(res, 409, "订单关联的客户或套餐不存在");
    const body = await readBody(req);

    if (purchaseOrderMatch[2] === "reject") {
      const refund = Number(order.amount || 0);
      client.balance = Number(client.balance || 0) + refund;
      order.status = "rejected";
      order.note = String(body.note || "管理员拒绝订单").trim().slice(0, 200);
      order.reviewedAt = new Date().toISOString();
      order.reviewedBy = user.id;
      const invoice = state.invoices.find((item) => item.id === order.invoiceId);
      if (invoice) { invoice.status = "cancelled"; invoice.paid = 0; invoice.title = `${product.name} ${order.months} 个月购买（已退款）`; }
      state.payments.push({ id: uid("refund"), invoiceId: order.invoiceId || "", serviceId: "", orderId: order.id, clientId: client.id, amount: -refund, method: "余额退款", date: today(), note: `${order.id} 审核未通过` });
      addLog(state, user, null, "reject-purchase", `${order.id}；退款 ¥${refund.toFixed(2)}；${order.note}`);
      writeJson(DB_FILE, state);
      return sendJson(res, 200, { ok: true, data: publicState(state), order });
    }

    const pveNode = String(body.pveNode || "").trim();
    const pveVmid = String(body.pveVmid || "").trim();
    const pveType = productType(product);
    if (!pveNode || !pveVmid) return sendError(res, 400, "请选择 PVE 节点和 VMID");
    if (state.services.some((item) => item.pveNode === pveNode && serviceType(item) === pveType && String(item.pveVmid) === pveVmid)) return sendError(res, 409, "这台 PVE 虚拟机已经绑定");
    const mapping = state.natMappings.find((item) => item.pveType === pveType && String(item.pveVmid) === pveVmid);
    if (!mapping) return sendError(res, 409, "该 VMID 尚未配置 NAT 端口映射");
    let resources;
    try { resources = await pveRequest("/cluster/resources?type=vm"); }
    catch (error) { return sendError(res, 503, `暂时无法核对 PVE 资源：${error.message}`); }
    const resource = (Array.isArray(resources) ? resources : []).find((item) => item.node === pveNode && (item.type === "lxc" ? "lxc" : "qemu") === pveType && String(item.vmid) === pveVmid && Number(item.template || 0) !== 1);
    if (!resource) return sendError(res, 409, "所选 PVE 实例不存在、类型不符或是模板");

    const service = {
      id: uid("svc"), clientId: client.id, productId: product.id,
      name: String(body.name || `${product.name}-${mapping.resourceName || `${pveType === "lxc" ? "CT" : "VM"}${pveVmid}`}`).trim().slice(0, 120),
      status: "active", startDate: today(), expiresAt: addMonths(today(), order.months),
      pveNode, pveType, pveVmid, ipv4: product.publicIp || "", internalIp: mapping.internalIp,
      portStart: Number(mapping.portStart), portEnd: Number(mapping.portEnd), remotePort: Number(mapping.portStart),
      remoteUsername: "Administrator", remotePassword: "QwQ2026!", os: "待安装",
      allowedImageIds: state.osTemplates.filter((item) => item.enabled !== false && item.pveType === pveType).map((item) => item.id)
    };
    state.services.push(service);
    order.status = "provisioned";
    order.serviceId = service.id;
    order.pveNode = pveNode;
    order.pveType = pveType;
    order.pveVmid = pveVmid;
    order.reviewedAt = new Date().toISOString();
    order.reviewedBy = user.id;
    const invoice = state.invoices.find((item) => item.id === order.invoiceId);
    if (invoice) { invoice.serviceId = service.id; invoice.title = `${product.name} ${order.months} 个月购买`; }
    state.payments.filter((item) => item.orderId === order.id).forEach((item) => { item.serviceId = service.id; });
    addLog(state, user, service, "approve-purchase", `${order.id}；手动分配 ${pveNode}/${pveVmid}`);
    writeJson(DB_FILE, state);
    void sendServiceNotification(state, service, "purchase", { months: order.months, amount: order.amount }).catch((error) => console.error(`开通邮件发送失败：${error.message}`));
    return sendJson(res, 200, { ok: true, data: publicState(state), order, service });
  }

  if (req.method === "POST" && pathname === "/api/admin/services") {
    const body = await readBody(req);
    if (!state.clients.some((item) => item.id === body.clientId) || !state.products.some((item) => item.id === body.productId && !item.archivedAt)) return sendError(res, 400, "客户或套餐不存在或已下架");
    if (state.services.some((item) => item.pveNode === body.pveNode && String(item.pveVmid) === String(body.pveVmid))) return sendError(res, 409, "这台 PVE 虚拟机已经绑定");
    const pveType = body.pveType === "lxc" ? "lxc" : "qemu";
    const mapping = state.natMappings.find((item) => String(item.pveVmid) === String(body.pveVmid) && item.pveType === pveType);
    const service = { id: uid("svc"), clientId: body.clientId, productId: body.productId, name: body.name, status: "active", startDate: body.startDate || today(), expiresAt: body.expiresAt, pveNode: body.pveNode || "", pveType, pveVmid: body.pveVmid || "", ipv4: "", internalIp: mapping?.internalIp || String(body.internalIp || "").trim(), portStart: Number(mapping?.portStart || body.portStart), portEnd: Number(mapping?.portEnd || body.portEnd), remotePort: Number(body.remotePort || mapping?.portStart || body.portStart), remoteUsername: String(body.remoteUsername || "Administrator").trim().slice(0, 100), remotePassword: String(body.remotePassword || "QwQ2026!").slice(0, 200), os: body.os || "", allowedImageIds: state.osTemplates.filter((item) => item.enabled !== false && item.pveType === pveType).map((item) => item.id) };
    if (!service.name || !service.expiresAt || !service.internalIp || !service.remoteUsername || !service.remotePassword) return sendError(res, 400, "服务名称、NAT 网络、远程登录凭据和到期时间必填");
    if (!Number.isInteger(service.portStart) || !Number.isInteger(service.portEnd) || !Number.isInteger(service.remotePort) || service.portStart < 1 || service.portEnd > 65535 || service.portStart > service.portEnd || service.remotePort < service.portStart || service.remotePort > service.portEnd) return sendError(res, 400, "NAT 端口范围或远程端口不正确");
    state.services.push(service);
    addLog(state, user, service, "bind", `${service.pveNode}/${service.pveVmid}`);
    writeJson(DB_FILE, state);
    void sendServiceNotification(state, service, "purchase").catch((error) => console.error(`开通邮件发送失败：${error.message}`));
    return sendJson(res, 201, { ok: true, data: publicState(state) });
  }

  const serviceCredentialsMatch = pathname.match(/^\/api\/admin\/services\/([^/]+)\/credentials$/);
  if (req.method === "PUT" && serviceCredentialsMatch) {
    const service = ownedService(state, user, decodeURIComponent(serviceCredentialsMatch[1]));
    const body = await readBody(req);
    const remoteUsername = String(body.remoteUsername || "").trim();
    const remotePassword = String(body.remotePassword || "");
    if (!remoteUsername || remoteUsername.length > 100) return sendError(res, 400, "远程用户名需要填写，且不能超过 100 个字符");
    if (!remotePassword || remotePassword.length > 200) return sendError(res, 400, "远程密码需要填写，且不能超过 200 个字符");
    service.remoteUsername = remoteUsername;
    service.remotePassword = remotePassword;
    service.credentialsUpdatedAt = new Date().toISOString();
    addLog(state, user, service, "update-service-credentials", `更新 ${service.pveType === "lxc" ? "CT" : "VM"} ${service.pveVmid || "-"} 登录凭据`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicState(state) });
  }

  const serviceOperationMatch = pathname.match(/^\/api\/admin\/services\/([^/]+)\/(action|vnc|extend|expiry)$/);
  if (req.method === "POST" && serviceOperationMatch) {
    const service = ownedService(state, user, decodeURIComponent(serviceOperationMatch[1]));
    const operation = serviceOperationMatch[2];
    const body = await readBody(req);

    if (operation === "action") {
      const allowed = new Set(["start", "shutdown", "reboot", "stop"]);
      if (!allowed.has(body.action)) return sendError(res, 400, "不支持的电源操作");
      const data = await pveRequest(`${serviceApiPath(service)}/status/${body.action}`, "POST");
      addLog(state, user, service, body.action, "管理员操作");
      writeJson(DB_FILE, state);
      return sendJson(res, 200, { ok: true, data });
    }

    if (operation === "vnc") {
      return sendJson(res, 200, { ok: true, data: await issueConsoleTicket(state, user, service) });
    }

    if (operation === "expiry") {
      const expiresAt = String(body.expiresAt || "");
      const parsedExpiry = Date.parse(`${expiresAt}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || !Number.isFinite(parsedExpiry) || new Date(parsedExpiry).toISOString().slice(0, 10) !== expiresAt) return sendError(res, 400, "到期日期格式不正确");
      if (expiresAt === service.expiresAt) return sendError(res, 400, "到期日期没有变化");
      const previousExpiresAt = service.expiresAt || "";
      service.expiresAt = expiresAt;
      service.status = expiresAt < today() ? "expired" : "active";
      addLog(state, user, service, "set-expiry", `${previousExpiresAt || "-"} -> ${expiresAt}`);
      writeJson(DB_FILE, state);
      void syncServiceExpiryTag(service).catch((error) => console.error(`设定到期日后同步 PVE 标记失败 (${service.id})：${error.message}`));
      return sendJson(res, 200, { ok: true, data: publicState(state), expiry: { previousExpiresAt, newExpiresAt: expiresAt } });
    }

    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return sendError(res, 400, "延期天数需要是 1 至 3650 的整数");
    const previousExpiresAt = service.expiresAt || today();
    const baseDate = previousExpiresAt >= today() ? previousExpiresAt : today();
    service.expiresAt = addDays(baseDate, days);
    service.status = "active";
    addLog(state, user, service, "extend-expiry", `${days} 天；${previousExpiresAt} -> ${service.expiresAt}`);
    writeJson(DB_FILE, state);
    void syncServiceExpiryTag(service).catch((error) => console.error(`续期后移除 PVE 到期标记失败 (${service.id})：${error.message}`));
    return sendJson(res, 200, { ok: true, data: publicState(state), extension: { days, previousExpiresAt, newExpiresAt: service.expiresAt } });
  }

  if (req.method === "POST" && pathname.match(/^\/api\/admin\/clients\/[^/]+\/balance$/)) {
    const clientId = decodeURIComponent(pathname.split("/")[4]);
    const body = await readBody(req);
    const client = state.clients.find((item) => item.id === clientId);
    if (!client) return sendError(res, 404, "客户不存在");
    const operation = ["add", "subtract", "set"].includes(body.operation) ? body.operation : "add";
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0 || (operation !== "set" && amount <= 0)) return sendError(res, 400, "调整金额不正确");
    const previousBalance = Math.round(Number(client.balance || 0) * 100) / 100;
    let newBalance = previousBalance;
    if (operation === "add") newBalance += amount;
    if (operation === "subtract") newBalance -= amount;
    if (operation === "set") newBalance = amount;
    newBalance = Math.round(newBalance * 100) / 100;
    if (newBalance < 0) return sendError(res, 409, `余额不足，当前余额为 ¥${previousBalance.toFixed(2)}`);
    const delta = Math.round((newBalance - previousBalance) * 100) / 100;
    if (delta === 0) return sendError(res, 400, "余额没有发生变化");
    const defaultNotes = { add: "账户充值", subtract: "余额扣款", set: "管理员设定余额" };
    const note = String(body.note || "").trim().slice(0, 200) || defaultNotes[operation];
    const method = String(body.method || (operation === "add" ? "人工充值" : "人工调整")).trim().slice(0, 50);
    client.balance = newBalance;
    const recordType = operation === "add" ? "manual-topup" : "balance-adjustment";
    const logAction = operation === "add" ? "manual-topup" : "adjust-client-balance";
    state.payments.push({ id: uid("balance"), invoiceId: "", serviceId: "", clientId, amount: delta, method, date: today(), note, type: recordType, operation, balanceBefore: previousBalance, balanceAfter: newBalance });
    addLog(state, user, null, logAction, `${client.name}；${previousBalance.toFixed(2)} -> ${newBalance.toFixed(2)}；${note}`);
    writeJson(DB_FILE, state);
    const adjustment = { operation, amount, delta, previousBalance, newBalance, note, method };
    if (operation === "add") void sendTopupNotification(state, client, adjustment).catch((error) => console.error(`人工充值邮件发送失败：${error.message}`));
    return sendJson(res, 200, { ok: true, data: publicState(state), adjustment });
  }

  if (req.method === "DELETE" && pathname.match(/^\/api\/admin\/services\/[^/]+$/)) {
    const serviceId = decodeURIComponent(pathname.split("/")[4]);
    const service = state.services.find((item) => item.id === serviceId);
    if (!service) return sendError(res, 404, "服务绑定不存在");
    const client = state.clients.find((item) => item.id === service.clientId);
    const unbound = {
      id: service.id,
      name: service.name,
      clientId: service.clientId,
      clientName: client?.name || "未知客户",
      pveNode: service.pveNode || "",
      pveType: serviceType(service),
      pveVmid: service.pveVmid || ""
    };
    addLog(state, user, service, "unbind-service", `${unbound.clientName}；${unbound.pveNode}/${unbound.pveVmid}；仅移除本地绑定`);
    state.services = state.services.filter((item) => item.id !== serviceId);
    writeJson(DB_FILE, state);
    void sendServiceNotification(state, service, "unbind").catch((error) => console.error(`解绑邮件发送失败：${error.message}`));
    return sendJson(res, 200, { ok: true, data: publicState(state), unbound });
  }

  if (req.method === "PUT" && pathname.match(/^\/api\/admin\/clients\/[^/]+\/password$/)) {
    const clientId = decodeURIComponent(pathname.split("/")[4]);
    const body = await readBody(req);
    const client = state.clients.find((item) => item.id === clientId);
    const accountUser = state.users.find((item) => item.clientId === clientId && item.role === "client");
    if (!client || !accountUser) return sendError(res, 404, "客户登录账户不存在");
    const password = String(body.password || "");
    if (password.length < 8) return sendError(res, 400, "新密码至少需要 8 位");
    const salt = crypto.randomBytes(16).toString("hex");
    accountUser.salt = salt;
    accountUser.passwordHash = hashPassword(password, salt);
    accountUser.passwordChangedAt = new Date().toISOString();
    accountUser.passwordResetByAdminAt = accountUser.passwordChangedAt;
    for (const [sessionId, activeSession] of sessions.entries()) {
      if (activeSession.userId === accountUser.id) sessions.delete(sessionId);
    }
    addLog(state, user, null, "reset-client-password", client.name);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicState(state) });
  }

  if (req.method === "DELETE" && pathname.match(/^\/api\/admin\/clients\/[^/]+$/)) {
    const clientId = decodeURIComponent(pathname.split("/")[4]);
    const client = state.clients.find((item) => item.id === clientId);
    if (!client) return sendError(res, 404, "客户不存在");
    const serviceIds = new Set(state.services.filter((item) => item.clientId === clientId).map((item) => item.id));
    state.users = state.users.filter((item) => item.clientId !== clientId);
    state.clients = state.clients.filter((item) => item.id !== clientId);
    state.services = state.services.filter((item) => item.clientId !== clientId);
    state.invoices = state.invoices.filter((item) => item.clientId !== clientId);
    state.payments = state.payments.filter((item) => item.clientId !== clientId);
    addLog(state, user, null, "delete-client", `${client.name}；移除 ${serviceIds.size} 个本地服务绑定`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicState(state), removedServices: serviceIds.size });
  }

  if (req.method === "GET" && pathname === "/api/admin/mail/config") return sendJson(res, 200, { ok: true, data: publicMailConfig(readJson(MAIL_FILE, {})) });
  if (req.method === "PUT" && pathname === "/api/admin/mail/config") {
    const body = await readBody(req);
    const current = readJson(MAIL_FILE, {});
    const fromEmail = normalizedEmail(body.fromEmail);
    if (!body.host || !validEmail(fromEmail)) return sendError(res, 400, "SMTP 主机和发件邮箱必填");
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return sendError(res, 400, "SMTP 端口不正确");
    const next = {
      host: String(body.host).trim(),
      port,
      secure: Boolean(body.secure),
      user: String(body.user || "").trim(),
      password: body.password || current.password || "",
      fromEmail,
      senderName: String(body.senderName || "tidc").trim().slice(0, 80),
      portalUrl: String(body.portalUrl || "").trim().slice(0, 500),
      adminEmail: normalizedEmail(body.adminEmail),
      rejectUnauthorized: body.rejectUnauthorized !== false,
      notificationsEnabled: Boolean(body.notificationsEnabled),
      expiry5Enabled: body.expiry5Enabled !== false,
      expiry3Enabled: body.expiry3Enabled !== false,
      deletionWarningEnabled: body.deletionWarningEnabled !== false,
      purchaseEnabled: body.purchaseEnabled !== false,
      renewalEnabled: body.renewalEnabled !== false,
      topupEnabled: body.topupEnabled !== false,
      unbindEnabled: body.unbindEnabled !== false,
      adminPurchaseEnabled: body.adminPurchaseEnabled !== false,
      adminExpiryEnabled: body.adminExpiryEnabled !== false
    };
    if (next.adminEmail && !validEmail(next.adminEmail)) return sendError(res, 400, "管理员通知邮箱格式不正确");
    if (next.portalUrl) {
      try {
        const portalUrl = new URL(next.portalUrl);
        if (!["http:", "https:"].includes(portalUrl.protocol)) throw new Error("unsupported protocol");
        next.portalUrl = portalUrl.toString();
      } catch { return sendError(res, 400, "客户后台地址需要填写完整的 http:// 或 https:// 地址"); }
    }
    if (next.user && !next.password) return sendError(res, 400, "SMTP 登录密码必填");
    resetMailTransport();
    writeJson(MAIL_FILE, next);
    addLog(state, user, null, "update-mail-config", `${next.host}:${next.port}`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: publicMailConfig(next) });
  }
  if (req.method === "POST" && pathname === "/api/admin/mail/test") {
    const body = await readBody(req);
    const to = normalizedEmail(body.to);
    if (!validEmail(to)) return sendError(res, 400, "测试收件邮箱格式不正确");
    const config = readJson(MAIL_FILE, {});
    const startedAt = Date.now();
    const result = await mailTransport(config).sendMail({
      from: emailAddress(config),
      to,
      subject: "tidc SMTP 测试邮件",
      text: "tidc SMTP 配置测试成功。",
      html: mailTemplate({ label: "SMTP CONNECTION TEST", title: "邮件服务连接成功", intro: "tidc 已经可以发送客户验证码、VPS 开通、续费、到期和充值到账通知。", details: [["SMTP 主机", config.host], ["发件邮箱", config.fromEmail], ["测试时间", new Date().toLocaleString("zh-CN", { timeZone: BUSINESS_TIME_ZONE, hour12: false })]], actionUrl: config.portalUrl })
    });
    return sendJson(res, 200, { ok: true, message: "测试邮件已发送", data: { messageId: result.messageId, elapsedMs: Date.now() - startedAt } });
  }
  if (req.method === "POST" && pathname === "/api/admin/mail/run-reminders") {
    const result = await runExpiryNotifications();
    return sendJson(res, 200, { ok: true, data: result, message: result.enabled ? `扫描完成，发送 ${result.sent} 封提醒` : "业务邮件通知尚未启用" });
  }

  if (req.method === "GET" && pathname === "/api/admin/pve/config") return sendJson(res, 200, { ok: true, data: publicPveConfig(readJson(PVE_FILE, {})) });
  if (req.method === "PUT" && pathname === "/api/admin/pve/config") {
    const body = await readBody(req);
    const current = readJson(PVE_FILE, {});
    const next = { host: body.host || "", port: Number(body.port || 8006), tokenId: body.tokenId || "", tokenSecret: body.tokenSecret || current.tokenSecret || "", rejectUnauthorized: Boolean(body.rejectUnauthorized) };
    writeJson(PVE_FILE, next);
    return sendJson(res, 200, { ok: true, data: publicPveConfig(next) });
  }
  if (req.method === "GET" && pathname === "/api/admin/pve/test") return sendJson(res, 200, { ok: true, data: await pveRequest("/version") });
  if (req.method === "GET" && pathname === "/api/admin/pve/vms") return sendJson(res, 200, { ok: true, data: await pveRequest("/cluster/resources?type=vm") });
  if (req.method === "POST" && pathname === "/api/admin/pve/sync-expiry-tags") {
    const result = await syncExpiryTags(state);
    addLog(state, user, null, "sync-expiry-tags", `新增 ${result.tagged}；更新 ${result.updated}；移除 ${result.untagged}；失败 ${result.errors.length}`);
    writeJson(DB_FILE, state);
    return sendJson(res, 200, { ok: true, data: result });
  }
  if (req.method === "GET" && pathname === "/api/admin/pve/health") {
    const checks = await Promise.allSettled([
      pveRequest("/version"),
      pveRequest("/nodes"),
      pveRequest("/cluster/resources?type=vm"),
      pveRequest("/access/permissions")
    ]);
    const [versionResult, nodesResult, vmsResult, permissionsResult] = checks;
    if (versionResult.status === "rejected") throw versionResult.reason;
    const nodes = nodesResult.status === "fulfilled" && Array.isArray(nodesResult.value) ? nodesResult.value : [];
    let vms = vmsResult.status === "fulfilled" && Array.isArray(vmsResult.value) ? vmsResult.value : [];
    const permissions = permissionsResult.status === "fulfilled" && permissionsResult.value && typeof permissionsResult.value === "object" ? permissionsResult.value : {};
    const warnings = [];
    const nodeVmErrors = [];
    if (nodes.length) {
      const requests = nodes.flatMap((node) => [
        { node: node.node, type: "qemu", request: pveRequest(`/nodes/${encodeURIComponent(node.node)}/qemu`) },
        { node: node.node, type: "lxc", request: pveRequest(`/nodes/${encodeURIComponent(node.node)}/lxc`) }
      ]);
      const results = await Promise.allSettled(requests.map((item) => item.request));
      const directVms = [];
      results.forEach((result, index) => {
        const source = requests[index];
        if (result.status === "fulfilled" && Array.isArray(result.value)) {
          result.value.forEach((vm) => directVms.push({ ...vm, node: vm.node || source.node, type: vm.type || source.type }));
        } else if (result.status === "rejected") {
          nodeVmErrors.push(`${source.node}/${source.type}: ${result.reason.message}`);
        }
      });
      const merged = new Map();
      [...vms, ...directVms].forEach((vm) => merged.set(`${vm.node}:${vm.type || "qemu"}:${vm.vmid}`, vm));
      vms = [...merged.values()];
    }
    if (nodesResult.status === "rejected") warnings.push(`节点读取失败：${nodesResult.reason.message}`);
    else if (!nodes.length) warnings.push("API 已连接，但 Token 看不到任何节点。请为 Token 分配 / 路径的 PVEAuditor ACL 并启用 Propagate。");
    if (vmsResult.status === "rejected") warnings.push(`虚拟机读取失败：${vmsResult.reason.message}`);
    else if (!vms.length) warnings.push("API 已连接，但 Token 看不到任何虚拟机。请为 Token 分配 /vms 路径的 PVEAuditor（VM.Audit）ACL并启用 Propagate。");
    if (nodeVmErrors.length && !vms.length) warnings.push(`节点虚拟机接口也不可见：${nodeVmErrors.join("；")}`);
    if (!Object.keys(permissions).length) warnings.push("Token 当前没有可见 ACL；若启用了 Privilege Separation，需要给 Token ID 单独授权。");
    return sendJson(res, 200, {
      ok: true,
      data: {
        connected: true,
        version: versionResult.value?.version || "unknown",
        nodes,
        vms,
        permissionPaths: Object.keys(permissions).length,
        warnings,
        checkedAt: new Date().toISOString()
      }
    });
  }

  return sendError(res, 404, "接口不存在");
}

async function handleApi(req, res, pathname) {
  const state = normalizeState(readJson(DB_FILE, defaultState));
  if (pathname.startsWith("/api/auth/")) return handleAuth(req, res, pathname, state);
  if (pathname.startsWith("/api/portal")) return handlePortal(req, res, pathname, state);
  if (pathname.startsWith("/api/admin")) return handleAdmin(req, res, pathname, state);
  return sendError(res, 404, "接口不存在");
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  if (!publicFiles.has(requested)) return sendError(res, 404, "文件不存在");
  const file = path.normalize(path.join(ROOT, requested));
  if (!file.startsWith(ROOT)) return sendError(res, 403, "禁止访问");
  fs.readFile(file, (error, content) => {
    if (error) return sendError(res, 404, "文件不存在");
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
}

function handleConsoleUpgrade(req, clientSocket, head) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/api\/portal\/console\/([a-f0-9]+)$/);
  const token = match?.[1];
  const ticket = token ? consoleTickets.get(token) : null;
  const state = normalizeState(readJson(DB_FILE, defaultState));
  const user = currentUser(req, state);
  if (!ticket || !user || ticket.userId !== user.id || ticket.expiresAt < Date.now()) {
    clientSocket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return clientSocket.destroy();
  }
  ticket.stage = "connecting-pve";
  ticket.clientConnectedAt = new Date().toISOString();
  ticket.error = "";
  const config = readJson(PVE_FILE, {});
  const host = String(config.host || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const headers = {
    Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`,
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Key": req.headers["sec-websocket-key"],
    "Sec-WebSocket-Version": req.headers["sec-websocket-version"] || "13"
  };
  if (req.headers["sec-websocket-protocol"]) headers["Sec-WebSocket-Protocol"] = req.headers["sec-websocket-protocol"];
  const remotePath = `/api2/json/nodes/${encodeURIComponent(ticket.node)}/${ticket.type}/${encodeURIComponent(ticket.vmid)}/vncwebsocket?port=${encodeURIComponent(ticket.port)}&vncticket=${encodeURIComponent(ticket.pveTicket)}`;
  const remoteRequest = https.request({
    hostname: host,
    port: Number(config.port || 8006),
    path: remotePath,
    method: "GET",
    rejectUnauthorized: Boolean(config.rejectUnauthorized),
    headers,
    timeout: 15000
  });
  remoteRequest.on("upgrade", (remoteResponse, remoteSocket, remoteHead) => {
    ticket.stage = "connected";
    ticket.pveConnectedAt = new Date().toISOString();
    let responseHeaders = "HTTP/1.1 101 Switching Protocols\r\n";
    for (let index = 0; index < remoteResponse.rawHeaders.length; index += 2) responseHeaders += `${remoteResponse.rawHeaders[index]}: ${remoteResponse.rawHeaders[index + 1]}\r\n`;
    clientSocket.write(`${responseHeaders}\r\n`);
    if (head?.length) remoteSocket.write(head);
    if (remoteHead?.length) clientSocket.write(remoteHead);
    clientSocket.pipe(remoteSocket);
    remoteSocket.pipe(clientSocket);
  });
  remoteRequest.on("response", (response) => {
    ticket.stage = "pve-error";
    ticket.error = `PVE WebSocket 返回 HTTP ${response.statusCode || 502}`;
    clientSocket.write(`HTTP/1.1 ${response.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`);
    clientSocket.destroy();
  });
  remoteRequest.on("timeout", () => remoteRequest.destroy(new Error("服务器连接 PVE WebSocket 超时")));
  remoteRequest.on("error", (error) => {
    ticket.stage = "pve-error";
    ticket.error = error.message || "服务器无法连接 PVE WebSocket";
    if (!clientSocket.destroyed) clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    clientSocket.destroy();
  });
  remoteRequest.end();
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith("/api/")) await handleApi(req, res, pathname);
    else serveStatic(res, pathname);
  } catch (error) {
    sendError(res, error.statusCode || 500, error.message || "服务器错误");
  }
});

server.on("upgrade", handleConsoleUpgrade);

server.listen(PORT, () => {
  console.log(`tidc VPS 服务中心已启动：http://localhost:${PORT}`);
});

let scheduledReminderRunning = false;
async function runScheduledReminders() {
  if (scheduledReminderRunning) return;
  scheduledReminderRunning = true;
  try { await runExpiryNotifications(); }
  catch (error) { console.error(`邮件提醒扫描失败：${error.message}`); }
  finally { scheduledReminderRunning = false; }
}

const firstReminderScan = setTimeout(runScheduledReminders, 60 * 1000);
firstReminderScan.unref();
const reminderInterval = setInterval(runScheduledReminders, 5 * 60 * 1000);
reminderInterval.unref();

let scheduledExpiryTagSyncRunning = false;
async function runScheduledExpiryTagSync() {
  if (scheduledExpiryTagSyncRunning) return;
  scheduledExpiryTagSyncRunning = true;
  try {
    const state = normalizeState(readJson(DB_FILE, defaultState));
    const result = await syncExpiryTags(state);
    if (result.errors.length) console.error(`PVE 到期标记同步存在 ${result.errors.length} 个失败`);
  } catch (error) { console.error(`PVE 到期标记同步失败：${error.message}`); }
  finally { scheduledExpiryTagSyncRunning = false; }
}

const firstExpiryTagSync = setTimeout(runScheduledExpiryTagSync, 2 * 60 * 1000);
firstExpiryTagSync.unref();
const expiryTagSyncInterval = setInterval(runScheduledExpiryTagSync, 60 * 60 * 1000);
expiryTagSyncInterval.unref();
