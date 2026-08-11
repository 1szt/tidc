let session = null;
let portal = null;
let adminState = null;
let pveVms = [];
let pveNodes = [];
let resourceStatsState = { serviceId: "", metric: "cpu", timeframe: "day", data: null, requestId: 0, loading: false };
let resourceStatsTimer = null;

const viewInfo = {
  "portal-home": ["概览", "账户与服务状态"],
  "my-services": ["我的实例", "续费、电源、系统与远程控制台"],
  marketplace: ["购买服务器", "提交订单并等待管理员分配"],
  "my-billing": ["账单记录", "续费账单与付款记录"],
  "admin-home": ["运营概览", "客户、服务与收入状态"],
  customers: ["客户账户", "登录账户与余额管理"],
  plans: ["套餐管理", "配置规格、价格与成本"],
  "purchase-orders": ["订单审核", "审核客户购买并手动分配 PVE 实例"],
  bindings: ["实例绑定", "将客户服务绑定到 PVE 虚拟机"],
  "admin-vms": ["全部虚拟机", "集中管理运行状态、控制台与到期时间"],
  finance: ["财务流水", "充值、续费与收入记录"],
  "pve-settings": ["PVE 设置", "API 连接与资源同步"],
  "mail-settings": ["邮件设置", "管理员通知、业务提醒与客户验证码"]
};

const actionNames = { start: "开机", shutdown: "关机", reboot: "重启", stop: "强制停止" };
const defaultRemoteUsername = "Administrator";
const defaultRemotePassword = "QwQ2026!";

const els = Object.fromEntries([
  "loginPage", "loginForm", "openRegistration", "openPasswordReset", "appShell", "accountName", "accountRole", "openOwnPassword", "logoutButton", "viewTitle", "viewSubtitle",
  "portalMetrics", "expiringServices", "recentInvoices", "serviceGrid", "refreshPortal", "marketplaceBalance", "productCatalog", "marketplaceOrders", "clientInvoiceTable",
  "adminMetrics", "adminExpiring", "customerTabs", "customerManagePane", "customerSearch", "customerCount", "customerTable", "clientForm", "productForm", "productFormTitle", "productSubmitButton", "cancelProductEdit", "productList", "purchaseOrderCount", "purchaseOrderList", "refreshPurchaseResources", "serviceForm", "adminVmCount", "adminVmSearch", "syncExpiryTags", "refreshAdminVms", "adminVmTable",
  "serviceClient", "serviceProduct", "servicePveNode", "servicePveType", "servicePveVmid", "serviceNatPreview", "refreshBindingResources", "bindingResourceStatus", "bindingList", "syncPveVms", "financeMetrics", "paymentTable", "exportFinance", "openClearFinance", "pveForm",
  "testPve", "refreshPveHealth", "pveStatus", "pveHealth", "pveVmList", "renewDialog", "renewForm", "renewServiceName", "renewAmount", "purchaseDialog", "purchaseForm", "purchaseProductName", "purchaseSummary", "purchaseAmount",
  "reinstallDialog", "reinstallForm", "reinstallServiceName", "imageSelect", "topupDialog", "topupForm", "topupClientName", "balanceDialog", "balanceForm", "balanceClientName", "balanceOperation", "balanceAmountLabel", "balanceSubmitButton",
  "passwordDialog", "passwordForm", "passwordClientName", "generatePassword", "passwordResult", "passwordResultValue",
  "loginHistoryDialog", "loginHistoryClientName", "loginHistoryList", "clientServicesDialog", "clientServicesName", "clientServicesList", "serviceCredentialsDialog", "serviceCredentialsForm", "serviceCredentialsName", "showServiceCredentialPassword", "generateServiceCredentialPassword", "vmPasswordResetDialog", "vmPasswordResetForm", "vmPasswordResetTitle", "vmPasswordResetService", "vmPasswordResetNotice", "showVmPasswordReset", "generateVmPassword", "vmPasswordResetSubmit", "ownPasswordDialog", "ownPasswordForm", "ownPasswordAccount",
  "registrationDialog", "registerRequestForm", "registerVerifyForm", "registrationEmail", "restartRegistration", "passwordResetDialog", "passwordResetRequestForm", "passwordResetVerifyForm", "passwordResetEmail", "restartPasswordReset", "clearFinanceDialog", "clearFinanceForm",
  "mailForm", "mailStatus", "mailTestEmail", "testMail", "runMailReminders", "rechargeDialog", "supportQqValue", "copySupportQq",
  "resourceStatsDialog", "resourceStatsService", "resourceStatsTabs", "resourceStatsTimeframe", "resourceStatsAutoRefresh", "refreshResourceStats", "resourceStatsStatus", "resourceChartTitle", "resourceChartRange", "resourceChartLegend", "resourceChart", "resourceChartSummary", "toast"
].map((id) => [id, document.getElementById(id)]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "服务器返回格式异常" }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

async function restoreSession() {
  try {
    session = (await api("/api/auth/me")).data;
    await enterApplication();
  } catch {
    showLogin();
  }
}

function showLogin() {
  stopResourceStatsAutoRefresh();
  session = null;
  portal = null;
  adminState = null;
  els.loginPage.classList.remove("hidden");
  els.appShell.classList.add("hidden");
}

async function enterApplication() {
  els.loginPage.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.accountName.textContent = session.name;
  els.accountRole.textContent = session.role === "admin" ? "系统管理员" : `账户 ${session.username}`;
  document.body.dataset.role = session.role;
  if (session.role === "admin") {
    await Promise.all([loadAdminState(), loadPveConfig(), loadMailConfig()]);
    switchView(requestedViewAfterLogin("admin") || "admin-home");
  } else {
    await loadPortal();
    switchView(requestedViewAfterLogin("client") || "portal-home");
  }
}

function requestedViewAfterLogin(role) {
  const url = new URL(window.location.href);
  const requested = url.searchParams.get("next") || "";
  const allowed = role === "admin"
    ? new Set(["admin-home", "customers", "plans", "purchase-orders", "bindings", "admin-vms", "finance", "pve-settings", "mail-settings"])
    : new Set(["portal-home", "my-services", "marketplace", "my-billing"]);
  url.searchParams.delete("next");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return allowed.has(requested) ? requested : "";
}

async function loadPortal() {
  portal = (await api("/api/portal")).data;
  renderPortal();
}

async function loadAdminState() {
  adminState = (await api("/api/admin/state")).data;
  renderAdmin();
}

function renderPortal() {
  if (!portal) return;
  const active = portal.services.filter((item) => item.status === "active").length;
  const expiring = portal.services.filter((item) => daysLeft(item.expiresAt) >= 0 && daysLeft(item.expiresAt) <= 7).length;
  const outstandingInvoices = portal.invoices.filter((item) => item.status === "unpaid" || item.status === "partial");
  const unpaid = outstandingInvoices.reduce((sum, item) => sum + Number(item.amount || 0) - Number(item.paid || 0), 0);
  els.portalMetrics.innerHTML = [
    metric("账户余额", money(portal.client?.balance), "可用于在线续费", `<button class="primary-button compact" data-open-recharge type="button">充值</button>`),
    metric("有效实例", `${active} 台`, `共绑定 ${portal.services.length} 台`),
    metric("7 天内到期", `${expiring} 台`, expiring ? "请及时续费" : "暂无临期实例"),
    metric("待支付账单", money(unpaid), `${outstandingInvoices.length} 张待处理`)
  ].join("");

  const sorted = portal.services.slice().sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)));
  els.expiringServices.innerHTML = sorted.slice(0, 5).map((service) => rowItem(
    service.name,
    `${productName(service.productId)} · ${hardwareSpec(service)} · ${remoteAccessAddress(service)}`,
    expiryText(service.expiresAt),
    daysLeft(service.expiresAt) <= 7 ? "danger" : ""
  )).join("") || empty("暂无服务");

  els.recentInvoices.innerHTML = portal.invoices.slice(0, 5).map((invoice) => rowItem(invoice.title, invoice.id, money(invoice.amount), invoice.status === "paid" ? "success" : "warning")).join("") || empty("暂无账单");
  els.serviceGrid.innerHTML = sortServicesByVmid(portal.services).map(serviceCard).join("") || empty("暂无绑定实例");
  renderMarketplace();
  els.clientInvoiceTable.innerHTML = portal.invoices.map((invoice) => `
    <tr><td>${escapeHtml(invoice.id)}</td><td>${escapeHtml(invoice.title)}</td><td>${money(invoice.amount)}</td><td>${statusBadge(invoice.status)}</td><td>${escapeHtml(invoice.createdAt || "-")}</td></tr>
  `).join("") || emptyRow(5);
}

function serviceCard(service) {
  const product = portal.products.find((item) => item.id === service.productId);
  const runtime = service.runtime;
  const actualStatus = runtime?.status || service.status;
  const remaining = daysLeft(service.expiresAt);
  const powerLabel = actualStatus === "running" ? "运行中" : actualStatus === "stopped" ? "已关机" : "未同步";
  const publicIp = productPublicIp(service, product);
  const remoteAddress = remoteAccessAddress(service, product);
  return `
    <article class="service-card">
      <div class="service-head">
        <div><span class="status-dot ${actualStatus === "running" ? "online" : ""}"></span><h2>${escapeHtml(service.name)}</h2><p>${escapeHtml(remoteAddress)}</p></div>
        ${statusBadge(remaining < 0 ? "expired" : service.status)}
      </div>
      <div class="service-specs">
        <span><small>配置</small>${specBadge(service, product)}</span>
        <span><small>系统</small>${escapeHtml(service.os || "未记录")}</span>
        <span><small>公网 IP</small><code>${escapeHtml(publicIp)}</code></span>
        <span><small>内网 IP</small><code>${escapeHtml(service.internalIp || "未配置")}</code></span>
        <span><small>端口范围</small>${copyControl(natPortRange(service), "端口范围")}</span>
        <span><small>远程桌面地址</small>${copyControl(remoteAddress, "远程桌面地址")}</span>
        <span><small>用户名</small>${copyControl(remoteUsername(service), "用户名")}</span>
        <span><small>密码</small>${passwordControl(service)}</span>
        <span><small>状态</small>${escapeHtml(powerLabel)}</span>
        <span><small>到期时间</small>${escapeHtml(service.expiresAt || "-")}</span>
      </div>
      <div class="expiry-strip ${remaining <= 7 ? "urgent" : ""}"><span>${expiryText(service.expiresAt)}</span><button class="primary-button compact" data-renew="${escapeHtml(service.id)}" type="button">立即续费</button></div>
      <div class="service-actions">
        <button class="secondary-button compact stats-action" data-resource-stats="${escapeHtml(service.id)}" type="button">资源统计</button>
        <button class="secondary-button compact" data-vm-action="start" data-service-id="${escapeHtml(service.id)}" type="button">开机</button>
        <button class="secondary-button compact" data-vm-action="shutdown" data-service-id="${escapeHtml(service.id)}" type="button">关机</button>
        <button class="secondary-button compact" data-vm-action="reboot" data-service-id="${escapeHtml(service.id)}" type="button">重启</button>
        <button class="secondary-button compact" data-reinstall="${escapeHtml(service.id)}" type="button">重装系统</button>
        ${isWindowsPasswordService(service) ? `<button class="secondary-button compact password-reset-action" data-reset-vm-password="${escapeHtml(service.id)}" data-reset-mode="client" type="button">重置 Windows 密码</button>` : ""}
        <button class="secondary-button compact" data-vnc="${escapeHtml(service.id)}" type="button">VNC 控制台</button>
      </div>
    </article>
  `;
}

function renderMarketplace() {
  if (!portal || !els.productCatalog) return;
  const products = portal.products.filter((product) => !product.archivedAt);
  els.marketplaceBalance.textContent = money(portal.client?.balance);
  els.productCatalog.innerHTML = products.map((product, index) => {
    return `<article class="product-card tone-${index % 3}">
      <div class="product-card-head"><div><span>${escapeHtml(product.region || "默认区域")}</span><h2>${escapeHtml(product.name)}</h2></div><span class="inventory-badge review">管理员审核</span></div>
      <div class="product-spec-line"><strong>${escapeHtml(productHardwareSpec(product))}</strong><span>${escapeHtml(product.type || "KVM")}</span></div>
      <dl class="product-facts"><div><dt>CPU</dt><dd>${Number(product.cpu || 0)} 核</dd></div><div><dt>内存</dt><dd>${Number(product.memory || 0)} GB</dd></div><div><dt>磁盘</dt><dd>${Number(product.disk || 0)} GB</dd></div><div><dt>线路</dt><dd>${escapeHtml(product.publicIp || "待配置")}</dd></div></dl>
      <div class="product-purchase"><div><strong>${money(product.price)}</strong><span>/ 月</span></div><button class="primary-button" data-buy-product="${escapeHtml(product.id)}" type="button">提交订单</button></div>
    </article>`;
  }).join("") || empty("管理员尚未上架套餐");
  const orders = portal.purchaseOrders || [];
  els.marketplaceOrders.innerHTML = orders.map((order) => {
    const product = portal.products.find((item) => item.id === order.productId);
    const detail = order.status === "provisioned" ? `${order.pveNode || "-"} / VM ${order.pveVmid || "-"}` : order.status === "rejected" ? (order.note || "订单审核未通过") : "等待管理员选择 PVE 节点和 VMID";
    return `<article class="order-item"><div class="order-item-head"><div><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.createdAt ? formatTime(order.createdAt) : "-")}</span></div>${statusBadge(order.status)}</div><h3>${escapeHtml(product?.name || "已下架套餐")} · ${escapeHtml(productHardwareSpec(product || {}))}</h3><p>${order.months} 个月 · ${money(order.amount)} · ${escapeHtml(detail)}</p></article>`;
  }).join("") || empty("暂无购买订单");
}

function renderAdmin() {
  if (!adminState) return;
  const totalBalance = sum(adminState.clients, "balance");
  const income = sum(adminState.payments, "amount");
  const monthlyCost = adminState.services.filter((item) => item.status === "active").reduce((total, service) => total + Number(adminState.products.find((product) => product.id === service.productId)?.cost || 0), 0);
  const expiring = adminState.services.filter((item) => daysLeft(item.expiresAt) >= 0 && daysLeft(item.expiresAt) <= 7);
  const pendingOrders = adminState.purchaseOrders.filter((item) => item.status === "pending").length;
  els.adminMetrics.innerHTML = [
    metric("客户账户", `${adminState.clients.length} 个`, `余额 ${money(totalBalance)} · ${pendingOrders} 笔订单待审核`),
    metric("已绑定实例", `${adminState.services.length} 台`, `${adminState.services.filter((item) => item.status === "active").length} 台有效`),
    metric("累计入账", money(income), `${adminState.payments.length} 笔流水`),
    metric("预估月成本", money(monthlyCost), `${expiring.length} 台将在 7 天内到期`)
  ].join("");
  els.adminExpiring.innerHTML = expiring.map((service) => rowItem(service.name, `${clientName(service.clientId)} · ${hardwareSpec(service)} · ${remoteAccessAddress(service)}`, expiryText(service.expiresAt), "danger")).join("") || empty("暂无临期服务");

  renderCustomerTable();
  renderAdminVmTable();
  renderPurchaseOrders();

  const activeProducts = adminState.products.filter((product) => !product.archivedAt);
  els.productList.innerHTML = activeProducts.map((product) => {
    const usedBy = adminState.services.filter((service) => service.productId === product.id).length;
    return rowItem(
      `${product.name} · ${product.region}`,
      `${product.type} · ${productHardwareSpec(product)} · 公网 ${product.publicIp || "未设置"} · 成本 ${money(product.cost)}`,
      `<div class="product-row-actions"><span>${money(product.price)}/月 · ${usedBy} 台使用</span><button class="secondary-button compact" data-edit-product="${escapeHtml(product.id)}" type="button">编辑</button><button class="danger-button compact" data-delete-product="${escapeHtml(product.id)}" type="button">删除</button></div>`,
      "",
      true
    );
  }).join("") || empty("暂无套餐");

  els.serviceClient.innerHTML = adminState.clients.map((client) => option(client.id, clientEmail(client.id))).join("");
  els.serviceProduct.innerHTML = activeProducts.map((product) => option(product.id, `${product.name} · ${productHardwareSpec(product)} · ${product.publicIp || "未设置公网 IP"} · ${money(product.price)}/月`)).join("");
  renderBindingOptions();
  updateServiceNatPreview();
  els.bindingList.innerHTML = sortServicesByVmid(adminState.services).map((service) => rowItem(
    service.name,
    `${clientEmail(service.clientId)} · ${hardwareSpec(service)} · ${service.pveNode || "-"}/${service.pveVmid || "-"} · ${service.internalIp || "无内网 IP"} · ${natPortRange(service)} · ${remoteAccessAddress(service)}`,
    `<div class="binding-row-actions"><span class="${daysLeft(service.expiresAt) <= 7 ? "danger-text" : ""}">${escapeHtml(expiryText(service.expiresAt))}</span><button class="secondary-button compact" data-edit-service-credentials="${escapeHtml(service.id)}" type="button">编辑凭据</button><button class="danger-button compact" data-unbind-service="${escapeHtml(service.id)}" type="button">解绑</button></div>`,
    "",
    true
  )).join("") || empty("暂无绑定");

  const expenses = sum(adminState.expenses, "amount");
  els.financeMetrics.innerHTML = [metric("累计收款", money(income), `${adminState.payments.length} 笔`), metric("累计支出", money(expenses), `${adminState.expenses.length} 笔`), metric("账面差额", money(income - expenses), "收入减支出"), metric("客户余额", money(totalBalance), "未消费余额")].join("");
  els.paymentTable.innerHTML = adminState.payments.slice().reverse().map((payment) => `<tr><td>${escapeHtml(payment.date || "-")}</td><td>${escapeHtml(clientName(payment.clientId))}</td><td>${escapeHtml(payment.serviceId ? serviceName(payment.serviceId) : payment.orderId || "账户充值")}</td><td>${escapeHtml(payment.method || "-")}</td><td>${money(payment.amount)}</td><td>${escapeHtml(payment.note || "-")}</td></tr>`).join("") || emptyRow(6);
}

async function exportFinanceData() {
  els.exportFinance.disabled = true;
  try {
    const response = await fetch("/api/admin/finance/export.xls", { credentials: "same-origin" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `导出失败 (${response.status})`);
    }
    const disposition = response.headers.get("content-disposition") || "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encodedName ? decodeURIComponent(encodedName) : `tidc-finance-${new Date().toISOString().slice(0, 10)}.xls`;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("财务 Excel 已导出");
  } catch (error) { toast(error.message); }
  finally { els.exportFinance.disabled = false; }
}

function renderPurchaseOrders() {
  if (!adminState || !els.purchaseOrderList) return;
  const orders = (adminState.purchaseOrders || []).slice().sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  const pending = orders.filter((item) => item.status === "pending").length;
  els.purchaseOrderCount.textContent = `${pending} 笔待审核订单 · 共 ${orders.length} 笔`;
  els.purchaseOrderList.innerHTML = orders.map((order) => {
    const product = adminState.products.find((item) => item.id === order.productId);
    const client = adminState.clients.find((item) => item.id === order.clientId);
    const selectedNode = pveNodes.length === 1 ? pveNodes[0].node : "";
    const completed = order.status !== "pending";
    const result = order.status === "provisioned" ? `已分配 ${order.pveNode || "-"} / VM ${order.pveVmid || "-"}` : order.status === "rejected" ? `已退款 · ${order.note || "审核未通过"}` : "等待分配";
    const controls = completed ? `<div class="order-result ${escapeHtml(order.status)}">${escapeHtml(result)}</div>` : `<div class="review-controls">
      <label>PVE 节点<select data-review-node="${escapeHtml(order.id)}"><option value="">请选择节点</option>${pveNodes.map((node) => option(node.node, node.node, node.node === selectedNode)).join("")}</select></label>
      <label>VMID<select data-review-vmid="${escapeHtml(order.id)}"${selectedNode ? "" : " disabled"}>${reviewVmOptions(order, selectedNode)}</select></label>
      <button class="primary-button" data-approve-order="${escapeHtml(order.id)}" type="button">确认分配并开通</button>
      <button class="danger-button" data-reject-order="${escapeHtml(order.id)}" type="button">拒绝并退款</button>
    </div>`;
    return `<article class="order-item review-order" data-order-id="${escapeHtml(order.id)}"><div class="order-item-head"><div><strong>${escapeHtml(order.id)}</strong><span>${escapeHtml(order.createdAt ? formatTime(order.createdAt) : "-")}</span></div>${statusBadge(order.status)}</div><h3>${escapeHtml(client?.name || "未知客户")} · ${escapeHtml(product?.name || "已下架套餐")}</h3><p>${escapeHtml(productHardwareSpec(product || {}))} · ${order.months} 个月 · ${money(order.amount)}</p>${controls}</article>`;
  }).join("") || empty("暂无购买订单");
}

function availableReviewVms(order, node) {
  const product = adminState?.products.find((item) => item.id === order.productId);
  const type = String(product?.type || "KVM").toUpperCase().includes("LXC") ? "lxc" : "qemu";
  return pveVms.filter((vm) => {
    const vmType = vm.type === "lxc" ? "lxc" : "qemu";
    const bound = adminState.services.some((service) => service.pveNode === vm.node && (service.pveType === "lxc" ? "lxc" : "qemu") === vmType && String(service.pveVmid) === String(vm.vmid));
    return vm.node === node && vmType === type && Number(vm.template || 0) !== 1 && !bound && Boolean(natMapping(vm.vmid, vmType));
  });
}

function reviewVmOptions(order, node) {
  if (!node) return `<option value="">请先选择节点</option>`;
  const available = availableReviewVms(order, node);
  return `<option value="">请选择 VMID</option>` + available.map((vm) => {
    const mapping = natMapping(vm.vmid, vm.type === "lxc" ? "lxc" : "qemu");
    return option(String(vm.vmid), `VM ${vm.vmid} · ${vm.name || "未命名"} · ${mapping.internalIp} · ${mapping.portStart}-${mapping.portEnd}`);
  }).join("");
}

function wireEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      session = (await api("/api/auth/login", { method: "POST", body: JSON.stringify(formData(els.loginForm)) })).data;
      els.loginForm.reset();
      await enterApplication();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.openRegistration.addEventListener("click", () => {
    resetRegistration();
    els.registrationDialog.showModal();
  });
  els.registerRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = formData(els.registerRequestForm);
    if (data.password !== data.confirmPassword) return toast("两次输入的密码不一致");
    button.disabled = true;
    try {
      const payload = await api("/api/auth/register/request", { method: "POST", body: JSON.stringify(data) });
      els.registerVerifyForm.elements.registrationId.value = payload.data.registrationId;
      els.registrationEmail.textContent = `验证码已发送至 ${payload.data.email}`;
      els.registerRequestForm.classList.add("hidden");
      els.registerVerifyForm.classList.remove("hidden");
      els.registerVerifyForm.elements.code.focus();
      toast("验证码已发送，10 分钟内有效");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  els.registerVerifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      session = (await api("/api/auth/register/verify", { method: "POST", body: JSON.stringify(formData(els.registerVerifyForm)) })).data;
      els.registrationDialog.close();
      resetRegistration();
      await enterApplication();
      toast("邮箱验证成功，账户已创建");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  els.restartRegistration.addEventListener("click", resetRegistration);

  els.openPasswordReset.addEventListener("click", () => {
    resetPasswordReset();
    els.passwordResetDialog.showModal();
  });
  els.passwordResetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify(formData(els.passwordResetRequestForm)) });
      els.passwordResetVerifyForm.elements.resetId.value = payload.data.resetId;
      els.passwordResetEmail.textContent = `如果邮箱已验证，验证码将发送至 ${payload.data.email}`;
      els.passwordResetRequestForm.classList.add("hidden");
      els.passwordResetVerifyForm.classList.remove("hidden");
      els.passwordResetVerifyForm.elements.code.focus();
      toast("请检查邮箱，验证码 10 分钟内有效");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  els.passwordResetVerifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.passwordResetVerifyForm);
    if (data.password !== data.confirmPassword) return toast("两次输入的新密码不一致");
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/api/auth/password-reset/verify", { method: "POST", body: JSON.stringify(data) });
      els.passwordResetDialog.close();
      resetPasswordReset();
      toast("密码已重置，请使用新密码登录");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  els.restartPasswordReset.addEventListener("click", resetPasswordReset);

  els.logoutButton.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  els.copySupportQq.addEventListener("click", () => copyText(els.supportQqValue.value, "客服 QQ"));

  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-view]");
    const jump = event.target.closest("[data-view-jump]");
    const renew = event.target.closest("[data-renew]");
    const buyProduct = event.target.closest("[data-buy-product]");
    const reinstall = event.target.closest("[data-reinstall]");
    const vnc = event.target.closest("[data-vnc]");
    const action = event.target.closest("[data-vm-action]");
    const adminVmAction = event.target.closest("[data-admin-vm-action]");
    const adminVnc = event.target.closest("[data-admin-vnc]");
    const resourceStats = event.target.closest("[data-resource-stats]");
    const statsMetric = event.target.closest("[data-stats-metric]");
    const adminExtend = event.target.closest("[data-admin-extend]");
    const adminSetExpiry = event.target.closest("[data-admin-set-expiry]");
    const editServiceCredentials = event.target.closest("[data-edit-service-credentials]");
    const resetVmPassword = event.target.closest("[data-reset-vm-password]");
    const topup = event.target.closest("[data-topup]");
    const balanceAdjust = event.target.closest("[data-balance-adjust]");
    const deleteClient = event.target.closest("[data-delete-client]");
    const resetPassword = event.target.closest("[data-reset-password]");
    const loginHistory = event.target.closest("[data-login-history]");
    const viewClientServices = event.target.closest("[data-view-client-services]");
    const unbindService = event.target.closest("[data-unbind-service]");
    const editProductButton = event.target.closest("[data-edit-product]");
    const deleteProductButton = event.target.closest("[data-delete-product]");
    const approveOrder = event.target.closest("[data-approve-order]");
    const rejectOrder = event.target.closest("[data-reject-order]");
    const openRecharge = event.target.closest("[data-open-recharge]");
    const themeToggle = event.target.closest("[data-theme-toggle]");
    const copyButton = event.target.closest("[data-copy-value]");
    const copyPassword = event.target.closest("[data-copy-password]");
    const customerPane = event.target.closest("[data-customer-pane]");
    const close = event.target.closest("[data-close-dialog]");
    if (nav) switchView(nav.dataset.view);
    if (jump) switchView(jump.dataset.viewJump);
    if (renew) openRenew(renew.dataset.renew);
    if (buyProduct) openPurchase(buyProduct.dataset.buyProduct);
    if (reinstall) openReinstall(reinstall.dataset.reinstall);
    if (vnc) await openVnc(vnc.dataset.vnc);
    if (action) await operateVm(action.dataset.serviceId, action.dataset.vmAction);
    if (adminVmAction) await operateAdminVm(adminVmAction.dataset.serviceId, adminVmAction.dataset.adminVmAction);
    if (adminVnc) await openAdminVnc(adminVnc.dataset.adminVnc);
    if (resourceStats) await openResourceStats(resourceStats.dataset.resourceStats);
    if (statsMetric) selectResourceMetric(statsMetric.dataset.statsMetric);
    if (adminExtend) await extendAdminVm(adminExtend.dataset.adminExtend);
    if (adminSetExpiry) await setAdminVmExpiry(adminSetExpiry.dataset.adminSetExpiry);
    if (editServiceCredentials) openServiceCredentials(editServiceCredentials.dataset.editServiceCredentials);
    if (resetVmPassword) openVmPasswordReset(resetVmPassword.dataset.resetVmPassword, resetVmPassword.dataset.resetMode);
    if (topup) openTopup(topup.dataset.topup);
    if (balanceAdjust) openBalanceAdjust(balanceAdjust.dataset.balanceAdjust);
    if (deleteClient) await removeClient(deleteClient.dataset.deleteClient);
    if (resetPassword) openPasswordDialog(resetPassword.dataset.resetPassword);
    if (loginHistory) openLoginHistory(loginHistory.dataset.loginHistory);
    if (viewClientServices) openClientServices(viewClientServices.dataset.viewClientServices);
    if (unbindService) await removeServiceBinding(unbindService.dataset.unbindService);
    if (editProductButton) editProduct(editProductButton.dataset.editProduct);
    if (deleteProductButton) await deleteProduct(deleteProductButton.dataset.deleteProduct);
    if (approveOrder) await approvePurchaseOrder(approveOrder.dataset.approveOrder);
    if (rejectOrder) await rejectPurchaseOrder(rejectOrder.dataset.rejectOrder);
    if (openRecharge) els.rechargeDialog.showModal();
    if (themeToggle) setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    if (copyButton) await copyText(copyButton.dataset.copyValue, copyButton.dataset.copyLabel || "内容");
    if (copyPassword) {
      const service = findService(copyPassword.dataset.copyPassword);
      if (service) await copyText(remotePassword(service), "密码");
    }
    if (customerPane) switchCustomerPane(customerPane.dataset.customerPane);
    if (close) close.closest("dialog").close();
  });

  document.addEventListener("change", async (event) => {
    if (event.target === els.resourceStatsTimeframe) {
      resourceStatsState.timeframe = els.resourceStatsTimeframe.value;
      await loadResourceStats();
      return;
    }
    if (event.target === els.resourceStatsAutoRefresh) {
      if (els.resourceStatsAutoRefresh.checked) {
        await loadResourceStats({ silent: true });
        startResourceStatsAutoRefresh();
      } else stopResourceStatsAutoRefresh();
      return;
    }
    const nodeSelect = event.target.closest("[data-review-node]");
    if (!nodeSelect) return;
    const order = adminState?.purchaseOrders.find((item) => item.id === nodeSelect.dataset.reviewNode);
    const vmSelect = nodeSelect.closest(".review-controls")?.querySelector("[data-review-vmid]");
    if (!order || !vmSelect) return;
    vmSelect.innerHTML = reviewVmOptions(order, nodeSelect.value);
    vmSelect.disabled = !nodeSelect.value;
  });

  let revealedPassword = null;
  const hidePassword = () => {
    if (!revealedPassword) return;
    revealedPassword.textContent = "••••••••";
    revealedPassword = null;
  };
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-hold-password]");
    if (!button) return;
    const service = findService(button.dataset.holdPassword);
    const display = button.closest(".password-control")?.querySelector("[data-password-display]");
    if (!service || !display) return;
    hidePassword();
    display.textContent = remotePassword(service);
    revealedPassword = display;
    button.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  document.addEventListener("pointerup", hidePassword);
  document.addEventListener("pointercancel", hidePassword);
  window.addEventListener("blur", hidePassword);

  els.refreshPortal.addEventListener("click", async () => {
    try { await loadPortal(); toast("实例状态已刷新"); } catch (error) { toast(error.message); }
  });

  els.refreshResourceStats.addEventListener("click", () => loadResourceStats());
  els.resourceStatsDialog.addEventListener("close", stopResourceStatsAutoRefresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && els.resourceStatsDialog.open && els.resourceStatsAutoRefresh.checked) loadResourceStats({ silent: true });
  });

  els.adminVmSearch.addEventListener("input", renderAdminVmTable);
  els.syncExpiryTags.addEventListener("click", async () => {
    els.syncExpiryTags.disabled = true;
    try {
      const payload = await api("/api/admin/pve/sync-expiry-tags", { method: "POST", body: "{}" });
      const result = payload.data;
      await loadPveHealth();
      toast(`同步完成：新增 ${result.tagged}，更新 ${result.updated}，移除 ${result.untagged}，失败 ${result.errors.length}`);
    } catch (error) { toast(error.message); }
    finally { els.syncExpiryTags.disabled = false; }
  });
  els.refreshAdminVms.addEventListener("click", async () => {
    els.refreshAdminVms.disabled = true;
    try {
      await loadPveHealth();
      renderAdminVmTable();
    } finally { els.refreshAdminVms.disabled = false; }
  });

  els.renewForm.addEventListener("change", updateRenewAmount);
  els.renewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.renewForm);
    try {
      portal = (await api(`/api/portal/services/${encodeURIComponent(data.serviceId)}/renew`, { method: "POST", body: JSON.stringify({ months: Number(data.months) }) })).data;
      els.renewDialog.close();
      renderPortal();
      toast("续费成功，到期时间已更新");
    } catch (error) { toast(error.message); }
  });

  els.purchaseForm.addEventListener("change", updatePurchaseAmount);
  els.purchaseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.purchaseForm);
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api("/api/portal/purchase", { method: "POST", body: JSON.stringify({ productId: data.productId, months: Number(data.months) }) });
      portal = payload.data;
      els.purchaseDialog.close();
      renderPortal();
      switchView("marketplace");
      toast(`订单 ${payload.order?.id || ""} 已提交，等待管理员审核分配`);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.reinstallForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.reinstallForm);
    if (!confirm("确认重装这台实例？当前系统盘数据可能丢失。")) return;
    try {
      const payload = await api(`/api/portal/services/${encodeURIComponent(data.serviceId)}/reinstall`, { method: "POST", body: JSON.stringify({ imageId: data.imageId }) });
      els.reinstallDialog.close();
      await loadPortal();
      toast(payload.message || "重装任务已提交");
    } catch (error) { toast(error.message); }
  });

  els.clientForm.addEventListener("submit", (event) => submitAdminForm(event, "/api/admin/clients", els.clientForm));
  els.productForm.addEventListener("submit", submitProductForm);
  els.cancelProductEdit.addEventListener("click", resetProductForm);
  els.serviceForm.addEventListener("submit", (event) => submitAdminForm(event, "/api/admin/services", els.serviceForm));
  els.refreshPurchaseResources.addEventListener("click", loadPveHealth);

  els.openOwnPassword.addEventListener("click", () => {
    els.ownPasswordForm.reset();
    els.ownPasswordAccount.textContent = `${session.name} · ${session.username}`;
    els.ownPasswordDialog.showModal();
  });
  els.ownPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.ownPasswordForm);
    if (data.newPassword !== data.confirmPassword) return toast("两次输入的新密码不一致");
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/api/auth/password", { method: "PUT", body: JSON.stringify(data) });
      els.ownPasswordDialog.close();
      els.ownPasswordForm.reset();
      toast("密码修改成功，其他登录会话已退出");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.showServiceCredentialPassword.addEventListener("change", () => {
    els.serviceCredentialsForm.elements.remotePassword.type = els.showServiceCredentialPassword.checked ? "text" : "password";
  });
  els.generateServiceCredentialPassword.addEventListener("click", () => {
    els.serviceCredentialsForm.elements.remotePassword.value = generateSecurePassword();
    els.showServiceCredentialPassword.checked = true;
    els.serviceCredentialsForm.elements.remotePassword.type = "text";
  });
  els.serviceCredentialsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.serviceCredentialsForm);
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api(`/api/admin/services/${encodeURIComponent(data.serviceId)}/credentials`, { method: "PUT", body: JSON.stringify({ remoteUsername: data.remoteUsername, remotePassword: data.remotePassword }) });
      adminState = payload.data;
      els.serviceCredentialsDialog.close();
      renderAdmin();
      if (els.clientServicesDialog.open) renderClientServices(els.clientServicesDialog.dataset.clientId);
      toast("VPS 登录凭据已更新");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.showVmPasswordReset.addEventListener("change", () => {
    els.vmPasswordResetForm.elements.password.type = els.showVmPasswordReset.checked ? "text" : "password";
  });
  els.generateVmPassword.addEventListener("click", () => {
    els.vmPasswordResetForm.elements.password.value = generateSecurePassword(18);
    els.showVmPasswordReset.checked = true;
    els.vmPasswordResetForm.elements.password.type = "text";
  });
  els.vmPasswordResetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.vmPasswordResetForm);
    const isAdmin = data.mode === "admin" && session?.role === "admin";
    const prefix = isAdmin ? "/api/admin/services" : "/api/portal/services";
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api(`${prefix}/${encodeURIComponent(data.serviceId)}/reset-password`, { method: "POST", body: JSON.stringify({ password: data.password }) });
      if (isAdmin) {
        adminState = payload.data;
        renderAdmin();
      } else {
        portal = payload.data;
        renderPortal();
      }
      els.vmPasswordResetDialog.close();
      els.vmPasswordResetForm.reset();
      toast(payload.warning || (isAdmin ? "Windows 密码已重置并保存，未向客户发送邮件" : "Windows 密码已重置并保存，成功邮件已发送"));
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.topupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.topupForm);
    try {
      const payload = await api(`/api/admin/clients/${encodeURIComponent(data.clientId)}/balance`, { method: "POST", body: JSON.stringify({ operation: "add", amount: Number(data.amount), method: data.method, note: data.note }) });
      adminState = payload.data;
      els.topupDialog.close();
      renderAdmin();
      toast(`充值成功，当前余额 ${money(payload.adjustment.newBalance)}`);
    } catch (error) { toast(error.message); }
  });

  els.balanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.balanceForm);
    try {
      const payload = await api(`/api/admin/clients/${encodeURIComponent(data.clientId)}/balance`, { method: "POST", body: JSON.stringify({ operation: data.operation, amount: Number(data.amount), method: "人工调整", note: data.note }) });
      adminState = payload.data;
      els.balanceDialog.close();
      renderAdmin();
      toast(`余额已调整为 ${money(payload.adjustment.newBalance)}`);
    } catch (error) { toast(error.message); }
  });
  els.balanceOperation.addEventListener("change", updateBalanceForm);

  els.exportFinance.addEventListener("click", exportFinanceData);
  els.openClearFinance.addEventListener("click", () => {
    els.clearFinanceForm.reset();
    els.clearFinanceDialog.showModal();
    els.clearFinanceForm.elements.confirmation.focus();
  });
  els.clearFinanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.clearFinanceForm);
    if (data.confirmation !== "清空财务") return toast("请输入“清空财务”确认操作");
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api("/api/admin/finance/clear", { method: "POST", body: JSON.stringify({ confirmation: data.confirmation }) });
      adminState = payload.data;
      els.clearFinanceDialog.close();
      renderAdmin();
      toast(`财务已清空，备份文件 ${payload.backupFilename}`);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  els.customerSearch.addEventListener("input", renderCustomerTable);
  els.generatePassword.addEventListener("click", () => {
    els.passwordForm.elements.password.value = generateSecurePassword();
  });
  els.passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.passwordForm);
    try {
      adminState = (await api(`/api/admin/clients/${encodeURIComponent(data.clientId)}/password`, { method: "PUT", body: JSON.stringify({ password: data.password }) })).data;
      els.passwordResultValue.value = data.password;
      els.passwordResult.classList.remove("hidden");
      renderAdmin();
      toast("客户密码已修改，原登录会话已注销");
    } catch (error) { toast(error.message); }
  });

  els.pveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(els.pveForm);
    data.rejectUnauthorized = els.pveForm.elements.rejectUnauthorized.checked;
    try {
      await api("/api/admin/pve/config", { method: "PUT", body: JSON.stringify(data) });
      toast("PVE 配置已保存，正在检测连接");
      await loadPveHealth();
    } catch (error) { toast(error.message); }
  });

  els.testPve.addEventListener("click", loadPveHealth);
  els.refreshPveHealth.addEventListener("click", loadPveHealth);
  els.syncPveVms.addEventListener("click", refreshPveVms);
  els.refreshBindingResources.addEventListener("click", loadPveHealth);
  els.servicePveNode.addEventListener("change", renderBindingVmOptions);
  els.servicePveType.addEventListener("change", renderBindingVmOptions);
  els.servicePveVmid.addEventListener("change", prefillServiceFromVm);
  els.serviceProduct.addEventListener("change", updateServiceNatPreview);
  els.serviceForm.elements.remotePort.addEventListener("input", updateServiceNatPreview);

  els.mailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = formData(els.mailForm);
    data.secure = els.mailForm.elements.secure.checked;
    data.rejectUnauthorized = els.mailForm.elements.rejectUnauthorized.checked;
    for (const name of ["notificationsEnabled", "expiry5Enabled", "expiry3Enabled", "deletionWarningEnabled", "purchaseEnabled", "renewalEnabled", "topupEnabled", "unbindEnabled", "passwordResetEnabled", "adminPurchaseEnabled", "adminExpiryEnabled"]) {
      data[name] = els.mailForm.elements[name].checked;
    }
    button.disabled = true;
    try {
      const config = (await api("/api/admin/mail/config", { method: "PUT", body: JSON.stringify(data) })).data;
      applyMailConfig(config);
      els.mailForm.elements.password.value = "";
      toast("邮件配置已保存");
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  els.testMail.addEventListener("click", async () => {
    const to = els.mailTestEmail.value.trim();
    if (!to) return toast("请输入测试收件邮箱");
    els.testMail.disabled = true;
    els.mailStatus.className = "connection-state checking";
    els.mailStatus.textContent = "正在发送测试邮件...";
    try {
      const payload = await api("/api/admin/mail/test", { method: "POST", body: JSON.stringify({ to }) });
      els.mailStatus.className = "connection-state success";
      const elapsedText = Number.isFinite(payload.data?.elapsedMs) ? ` · SMTP 用时 ${payload.data.elapsedMs} ms` : "";
      els.mailStatus.textContent = `测试邮件已发送至 ${to}${elapsedText}`;
      toast(`测试邮件已发送${elapsedText}`);
    } catch (error) {
      els.mailStatus.className = "connection-state error";
      els.mailStatus.textContent = `发送失败：${error.message}`;
      toast(error.message);
    } finally { els.testMail.disabled = false; }
  });
  els.runMailReminders.addEventListener("click", async () => {
    els.runMailReminders.disabled = true;
    try {
      const payload = await api("/api/admin/mail/run-reminders", { method: "POST", body: "{}" });
      toast(payload.message);
      await loadMailConfig();
    } catch (error) { toast(error.message); }
    finally { els.runMailReminders.disabled = false; }
  });
}

async function submitAdminForm(event, path, form) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    adminState = (await api(path, { method: "POST", body: JSON.stringify(formData(form)) })).data;
    form.reset();
    setDefaultDates();
    renderAdmin();
    if (form === els.clientForm) switchCustomerPane("manage");
    toast("保存成功");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function resetRegistration() {
  els.registerRequestForm.reset();
  els.registerVerifyForm.reset();
  els.registerRequestForm.classList.remove("hidden");
  els.registerVerifyForm.classList.add("hidden");
  els.registrationEmail.textContent = "";
}

function resetPasswordReset() {
  els.passwordResetRequestForm.reset();
  els.passwordResetVerifyForm.reset();
  els.passwordResetRequestForm.classList.remove("hidden");
  els.passwordResetVerifyForm.classList.add("hidden");
  els.passwordResetEmail.textContent = "";
}

async function submitProductForm(event) {
  event.preventDefault();
  const button = event.submitter;
  const data = formData(els.productForm);
  const productId = data.productId;
  delete data.productId;
  button.disabled = true;
  try {
    const path = productId ? `/api/admin/products/${encodeURIComponent(productId)}` : "/api/admin/products";
    const payload = await api(path, { method: productId ? "PUT" : "POST", body: JSON.stringify(data) });
    adminState = payload.data;
    resetProductForm();
    renderAdmin();
    toast(productId ? `套餐已更新，公网 IP 已同步到 ${payload.affectedServices || 0} 台实例` : "套餐已创建");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function editProduct(productId) {
  const product = adminState.products.find((item) => item.id === productId);
  if (!product) return toast("套餐不存在");
  for (const key of ["productId", "name", "region", "publicIp", "type", "price", "cpu", "memory", "disk", "cost"]) {
    let value = key === "productId" ? product.id : product[key];
    if (key === "type") value = String(product.type || "").toUpperCase().includes("LXC") ? "LXC" : "KVM";
    els.productForm.elements[key].value = value;
  }
  els.productFormTitle.textContent = "编辑套餐";
  els.productSubmitButton.textContent = "保存修改";
  els.cancelProductEdit.classList.remove("hidden");
  els.productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
  els.productForm.reset();
  els.productForm.elements.productId.value = "";
  els.productFormTitle.textContent = "新建套餐";
  els.productSubmitButton.textContent = "保存套餐";
  els.cancelProductEdit.classList.add("hidden");
}

async function deleteProduct(productId) {
  const product = adminState.products.find((item) => item.id === productId);
  if (!product) return toast("套餐不存在");
  const usedBy = adminState.services.filter((service) => service.productId === productId).length;
  const pendingOrders = (adminState.purchaseOrders || []).filter((order) => order.productId === productId && order.status === "pending").length;
  const message = usedBy || pendingOrders
    ? `套餐“${product.name}”仍有 ${usedBy} 台实例和 ${pendingOrders} 笔待审核订单。下架后停止新购买，但现有资料会保留。确认下架？`
    : `确认删除套餐“${product.name}”？`;
  if (!confirm(message)) return;
  try {
    const payload = await api(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
    adminState = payload.data;
    if (els.productForm.elements.productId.value === productId) resetProductForm();
    renderAdmin();
    toast(payload.archived ? "套餐已下架，现有实例资料已保留" : "套餐已删除");
  } catch (error) { toast(error.message); }
}

function openRenew(serviceId) {
  const service = portal.services.find((item) => item.id === serviceId);
  if (!service) return;
  els.renewForm.elements.serviceId.value = service.id;
  els.renewForm.elements.months.value = "1";
  els.renewServiceName.textContent = `${service.name} · 当前到期 ${service.expiresAt}`;
  updateRenewAmount();
  els.renewDialog.showModal();
}

function openPurchase(productId) {
  const product = portal?.products.find((item) => item.id === productId && !item.archivedAt);
  if (!product) return toast("套餐不存在或已下架");
  els.purchaseForm.reset();
  els.purchaseForm.elements.productId.value = product.id;
  els.purchaseForm.elements.months.value = "1";
  els.purchaseProductName.textContent = `${product.name} · ${product.region || "默认区域"}`;
  els.purchaseSummary.innerHTML = `<span><small>配置</small><strong>${escapeHtml(productHardwareSpec(product))}</strong></span><span><small>虚拟化</small><strong>${escapeHtml(product.type || "KVM")}</strong></span><span><small>交付方式</small><strong>管理员审核分配</strong></span><span><small>当前余额</small><strong>${money(portal.client?.balance)}</strong></span>`;
  updatePurchaseAmount();
  els.purchaseDialog.showModal();
}

async function approvePurchaseOrder(orderId) {
  const card = els.purchaseOrderList.querySelector(`[data-order-id="${CSS.escape(orderId)}"]`);
  const pveNode = card?.querySelector("[data-review-node]")?.value || "";
  const pveVmid = card?.querySelector("[data-review-vmid]")?.value || "";
  if (!pveNode || !pveVmid) return toast("请先选择 PVE 节点和 VMID");
  if (!confirm(`确认将 ${pveNode} / VM ${pveVmid} 分配给该订单？`)) return;
  try {
    const payload = await api(`/api/admin/purchase-orders/${encodeURIComponent(orderId)}/approve`, { method: "POST", body: JSON.stringify({ pveNode, pveVmid }) });
    adminState = payload.data;
    renderAdmin();
    toast(`订单 ${orderId} 已审核并开通`);
  } catch (error) { toast(error.message); }
}

async function rejectPurchaseOrder(orderId) {
  if (!confirm(`确认拒绝订单 ${orderId} 并将款项退回客户余额？`)) return;
  try {
    const payload = await api(`/api/admin/purchase-orders/${encodeURIComponent(orderId)}/reject`, { method: "POST", body: JSON.stringify({ note: "管理员审核未通过" }) });
    adminState = payload.data;
    renderAdmin();
    toast(`订单 ${orderId} 已拒绝，余额已退回`);
  } catch (error) { toast(error.message); }
}

function updatePurchaseAmount() {
  const product = portal?.products.find((item) => item.id === els.purchaseForm.elements.productId.value);
  const months = Number(els.purchaseForm.elements.months.value || 1);
  els.purchaseAmount.textContent = money(Number(product?.price || 0) * months);
}

function updateRenewAmount() {
  const service = portal?.services.find((item) => item.id === els.renewForm.elements.serviceId.value);
  const product = service ? portal.products.find((item) => item.id === service.productId) : null;
  els.renewAmount.textContent = money(Number(product?.price || 0) * Number(els.renewForm.elements.months.value || 1));
}

function openReinstall(serviceId) {
  const service = portal.services.find((item) => item.id === serviceId);
  if (!service) return;
  const images = portal.osTemplates.filter((image) => service.allowedImageIds.includes(image.id));
  if (!images.length) return toast("管理员尚未为此实例开放系统镜像");
  els.reinstallForm.reset();
  els.reinstallForm.elements.serviceId.value = service.id;
  els.reinstallServiceName.textContent = `${service.name} · ${service.ipv4 || "无 IP"}`;
  els.imageSelect.innerHTML = images.map((image) => option(image.id, image.name)).join("");
  els.reinstallDialog.showModal();
}

async function operateVm(serviceId, action) {
  if (!confirm(`确认对该实例执行“${actionNames[action]}”？`)) return;
  try {
    toast(`正在提交${actionNames[action]}指令`);
    await api(`/api/portal/services/${encodeURIComponent(serviceId)}/action`, { method: "POST", body: JSON.stringify({ action }) });
    setTimeout(() => loadPortal().catch(() => {}), 1200);
    toast(`${actionNames[action]}指令已提交`);
  } catch (error) { toast(error.message); }
}

async function openVnc(serviceId) {
  const popup = window.open("about:blank", "_blank");
  try {
    const payload = await api(`/api/portal/services/${encodeURIComponent(serviceId)}/vnc`, { method: "POST", body: "{}" });
    if (popup) popup.location = payload.data.url;
    else window.location.href = payload.data.url;
    toast("VNC 临时会话已创建");
  } catch (error) {
    if (popup) popup.close();
    toast(error.message);
  }
}

const resourceMetricMeta = {
  cpu: { title: "CPU 占用量", unit: "percent" },
  memory: { title: "内存占用量", unit: "percent" },
  bandwidth: { title: "网络带宽", unit: "rate" },
  diskio: { title: "磁盘 IO", unit: "rate" },
  traffic: { title: "累计流量", unit: "bytes" }
};

const resourceTimeframeLabels = {
  hour: "最近 1 小时",
  day: "最近 24 小时",
  week: "最近 7 天",
  month: "最近 30 天",
  year: "最近 1 年"
};

async function openResourceStats(serviceId) {
  const service = findService(serviceId);
  if (!service) return toast("实例不存在或已解除绑定");
  stopResourceStatsAutoRefresh();
  resourceStatsState = { serviceId, metric: "cpu", timeframe: "day", data: null, requestId: resourceStatsState.requestId + 1, loading: false };
  els.resourceStatsService.textContent = `${service.name} · ${service.pveNode || "未绑定节点"} / VM ${service.pveVmid || "-"}`;
  els.resourceStatsTimeframe.value = "day";
  els.resourceStatsTabs.querySelectorAll("[data-stats-metric]").forEach((button) => {
    const active = button.dataset.statsMetric === "cpu";
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.resourceStatsDialog.showModal();
  await loadResourceStats();
  startResourceStatsAutoRefresh();
}

function stopResourceStatsAutoRefresh() {
  if (resourceStatsTimer) clearInterval(resourceStatsTimer);
  resourceStatsTimer = null;
}

function startResourceStatsAutoRefresh() {
  stopResourceStatsAutoRefresh();
  if (!els.resourceStatsDialog.open || !els.resourceStatsAutoRefresh.checked) return;
  resourceStatsTimer = setInterval(() => {
    if (!document.hidden && els.resourceStatsDialog.open) loadResourceStats({ silent: true });
  }, 30 * 1000);
}

async function loadResourceStats({ silent = false } = {}) {
  if (!resourceStatsState.serviceId || resourceStatsState.loading) return;
  const requestId = ++resourceStatsState.requestId;
  resourceStatsState.loading = true;
  els.refreshResourceStats.disabled = true;
  els.resourceStatsStatus.className = "resource-stats-status loading";
  els.resourceStatsStatus.textContent = silent && resourceStatsState.data ? "正在自动刷新 PVE 统计数据..." : "正在读取 PVE 历史数据...";
  if (!silent || !resourceStatsState.data) {
    els.resourceChart.innerHTML = `<div class="resource-chart-loading">正在加载统计图</div>`;
    els.resourceChartSummary.innerHTML = "";
  }
  const prefix = session?.role === "admin" ? "/api/admin" : "/api/portal";
  try {
    const payload = await api(`${prefix}/services/${encodeURIComponent(resourceStatsState.serviceId)}/stats?timeframe=${encodeURIComponent(resourceStatsState.timeframe)}`);
    if (requestId !== resourceStatsState.requestId) return;
    resourceStatsState.data = payload.data;
    els.resourceStatsStatus.className = "resource-stats-status success";
    els.resourceStatsStatus.textContent = `${payload.data.points.length} 个采样点 · 更新于 ${formatTime(payload.data.fetchedAt)}`;
    renderResourceStats();
  } catch (error) {
    if (requestId !== resourceStatsState.requestId) return;
    els.resourceStatsStatus.className = "resource-stats-status error";
    els.resourceStatsStatus.textContent = `刷新失败：${error.message}`;
    if (!resourceStatsState.data) els.resourceChart.innerHTML = `<div class="resource-chart-empty">无法读取资源统计</div>`;
  } finally {
    if (requestId === resourceStatsState.requestId) {
      resourceStatsState.loading = false;
      els.refreshResourceStats.disabled = false;
    }
  }
}

function selectResourceMetric(metric) {
  if (!resourceMetricMeta[metric]) return;
  resourceStatsState.metric = metric;
  els.resourceStatsTabs.querySelectorAll("[data-stats-metric]").forEach((button) => {
    const active = button.dataset.statsMetric === metric;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderResourceStats();
}

function finiteStat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildResourceSeries(points, metric) {
  if (metric === "cpu") return [{ label: "CPU", color: "var(--accent)", values: points.map((point) => point.cpu === null ? null : Math.max(0, point.cpu * 100)) }];
  if (metric === "memory") return [{ label: "内存", color: "var(--coral)", values: points.map((point) => {
    const mem = finiteStat(point.mem);
    const maxmem = finiteStat(point.maxmem);
    return mem === null || maxmem === null || maxmem <= 0 ? null : Math.max(0, mem / maxmem * 100);
  }) }];
  if (metric === "bandwidth") return [
    { label: "下载", color: "var(--accent)", values: points.map((point) => finiteStat(point.netin)) },
    { label: "上传", color: "var(--coral)", values: points.map((point) => finiteStat(point.netout)) }
  ];
  if (metric === "diskio") return [
    { label: "读取", color: "var(--cyan)", values: points.map((point) => finiteStat(point.diskread)) },
    { label: "写入", color: "var(--gold)", values: points.map((point) => finiteStat(point.diskwrite)) }
  ];

  let inbound = 0;
  let outbound = 0;
  let hasInbound = false;
  let hasOutbound = false;
  const inboundValues = [];
  const outboundValues = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const seconds = previous ? Math.max(0, Number(point.time) - Number(previous.time)) : 0;
    const netin = finiteStat(point.netin);
    const netout = finiteStat(point.netout);
    if (netin !== null) { hasInbound = true; inbound += Math.max(0, netin) * seconds; }
    if (netout !== null) { hasOutbound = true; outbound += Math.max(0, netout) * seconds; }
    inboundValues.push(hasInbound ? inbound : null);
    outboundValues.push(hasOutbound ? outbound : null);
  });
  return [
    { label: "下载流量", color: "var(--accent)", values: inboundValues },
    { label: "上传流量", color: "var(--coral)", values: outboundValues }
  ];
}

function formatResourceValue(value, unit) {
  if (!Number.isFinite(value)) return "-";
  if (unit === "percent") return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
  const suffix = unit === "rate" ? "/s" : "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}${suffix}`;
}

function chartTimeLabel(timestamp, timeframe) {
  const date = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(date.getTime())) return "-";
  if (timeframe === "hour" || timeframe === "day") return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("zh-CN", { year: timeframe === "year" ? "2-digit" : undefined, month: "2-digit", day: "2-digit" });
}

function niceChartMaximum(value, unit) {
  if (unit === "percent") return 100;
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function renderResourceStats() {
  const data = resourceStatsState.data;
  const meta = resourceMetricMeta[resourceStatsState.metric];
  els.resourceChartTitle.textContent = meta.title;
  els.resourceChartRange.textContent = resourceTimeframeLabels[resourceStatsState.timeframe] || resourceTimeframeLabels.day;
  if (!data?.points?.length) {
    els.resourceChartLegend.innerHTML = "";
    els.resourceChart.innerHTML = `<div class="resource-chart-empty">当前时间范围没有可用数据</div>`;
    els.resourceChartSummary.innerHTML = "";
    return;
  }

  const points = data.points;
  const series = buildResourceSeries(points, resourceStatsState.metric);
  const allValues = series.flatMap((item) => item.values.filter(Number.isFinite));
  if (!allValues.length) {
    els.resourceChartLegend.innerHTML = series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join("");
    els.resourceChart.innerHTML = `<div class="resource-chart-empty">PVE 暂未生成此项统计</div>`;
    els.resourceChartSummary.innerHTML = "";
    return;
  }

  const width = 980;
  const height = 310;
  const left = 76;
  const right = 18;
  const top = 22;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = niceChartMaximum(Math.max(...allValues), meta.unit);
  const firstTime = Number(points[0].time);
  const lastTime = Number(points[points.length - 1].time);
  const timeSpan = Math.max(1, lastTime - firstTime);
  const xFor = (time) => left + (Number(time) - firstTime) / timeSpan * plotWidth;
  const yFor = (value) => top + plotHeight - Math.max(0, Math.min(maximum, value)) / maximum * plotHeight;
  const sampleStep = Math.max(1, Math.ceil(points.length / 260));
  const sampleIndexes = [];
  for (let index = 0; index < points.length; index += sampleStep) sampleIndexes.push(index);
  if (sampleIndexes[sampleIndexes.length - 1] !== points.length - 1) sampleIndexes.push(points.length - 1);

  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = top + plotHeight * ratio;
    const value = maximum * (1 - ratio);
    return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${escapeHtml(formatResourceValue(value, meta.unit))}</text>`;
  }).join("");
  const xAxis = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const x = left + plotWidth * ratio;
    const time = firstTime + timeSpan * ratio;
    return `<text class="chart-axis-label" x="${x}" y="${height - 15}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}">${escapeHtml(chartTimeLabel(time, resourceStatsState.timeframe))}</text>`;
  }).join("");
  const paths = series.map((item, seriesIndex) => {
    const usable = sampleIndexes.filter((index) => Number.isFinite(item.values[index]));
    if (!usable.length) return "";
    const line = usable.map((index, pointIndex) => `${pointIndex ? "L" : "M"}${xFor(points[index].time).toFixed(2)},${yFor(item.values[index]).toFixed(2)}`).join(" ");
    const area = series.length === 1 ? `<path class="chart-area" d="${line} L${xFor(points[usable[usable.length - 1]].time).toFixed(2)},${top + plotHeight} L${xFor(points[usable[0]].time).toFixed(2)},${top + plotHeight} Z"></path>` : "";
    return `${area}<path class="chart-series chart-series-${seriesIndex}" style="stroke:${item.color}" d="${line}"></path>`;
  }).join("");

  els.resourceChartLegend.innerHTML = series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join("");
  els.resourceChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${xAxis}${paths}</svg>`;
  els.resourceChartSummary.innerHTML = series.map((item) => {
    const values = item.values.filter(Number.isFinite);
    const latest = values[values.length - 1];
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const peak = Math.max(...values);
    return `<div><span>${escapeHtml(item.label)}当前</span><strong>${escapeHtml(formatResourceValue(latest, meta.unit))}</strong></div><div><span>${escapeHtml(item.label)}平均</span><strong>${escapeHtml(formatResourceValue(average, meta.unit))}</strong></div><div><span>${escapeHtml(item.label)}峰值</span><strong>${escapeHtml(formatResourceValue(peak, meta.unit))}</strong></div>`;
  }).join("");
}

async function operateAdminVm(serviceId, action) {
  const service = adminState?.services.find((item) => item.id === serviceId);
  if (!service || !actionNames[action]) return;
  const warning = action === "stop" ? "强制停止可能导致未保存的数据丢失。" : "";
  if (!confirm(`确认对 ${service.name} 执行“${actionNames[action]}”？${warning}`)) return;
  try {
    toast(`正在提交${actionNames[action]}指令`);
    await api(`/api/admin/services/${encodeURIComponent(serviceId)}/action`, { method: "POST", body: JSON.stringify({ action }) });
    toast(`${actionNames[action]}指令已提交`);
    setTimeout(() => loadPveHealth().catch(() => {}), 1200);
  } catch (error) { toast(error.message); }
}

async function openAdminVnc(serviceId) {
  const popup = window.open("about:blank", "_blank");
  try {
    const payload = await api(`/api/admin/services/${encodeURIComponent(serviceId)}/vnc`, { method: "POST", body: "{}" });
    if (popup) popup.location = payload.data.url;
    else window.location.href = payload.data.url;
    toast("管理员 VNC 临时会话已创建");
  } catch (error) {
    if (popup) popup.close();
    toast(error.message);
  }
}

async function extendAdminVm(serviceId) {
  const input = document.querySelector(`[data-vm-days="${CSS.escape(serviceId)}"]`);
  const days = Number(input?.value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return toast("延期天数需要是 1 至 3650 的整数");
  const service = adminState?.services.find((item) => item.id === serviceId);
  if (!service || !confirm(`确认给 ${service.name} 增加 ${days} 天？`)) return;
  try {
    const payload = await api(`/api/admin/services/${encodeURIComponent(serviceId)}/extend`, { method: "POST", body: JSON.stringify({ days }) });
    adminState = payload.data;
    renderAdmin();
    toast(`已增加 ${days} 天，新到期时间 ${payload.extension.newExpiresAt}`);
  } catch (error) { toast(error.message); }
}

async function setAdminVmExpiry(serviceId) {
  const input = document.querySelector(`[data-vm-expiry-date="${CSS.escape(serviceId)}"]`);
  const expiresAt = String(input?.value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return toast("请选择有效的到期日期");
  const service = adminState?.services.find((item) => item.id === serviceId);
  if (!service || service.expiresAt === expiresAt) return toast("到期日期没有变化");
  if (!confirm(`确认将 ${service.name} 的到期时间设为 ${expiresAt}？`)) return;
  try {
    const payload = await api(`/api/admin/services/${encodeURIComponent(serviceId)}/expiry`, { method: "POST", body: JSON.stringify({ expiresAt }) });
    adminState = payload.data;
    renderAdmin();
    toast(`到期时间已设为 ${payload.expiry.newExpiresAt}`);
  } catch (error) { toast(error.message); }
}

function openTopup(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  if (!client) return;
  els.topupForm.reset();
  els.topupForm.elements.clientId.value = client.id;
  els.topupClientName.textContent = `${client.name} · 当前余额 ${money(client.balance)}`;
  els.topupDialog.showModal();
}

function openBalanceAdjust(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  if (!client) return;
  els.balanceForm.reset();
  els.balanceForm.elements.clientId.value = client.id;
  els.balanceClientName.textContent = `${client.name} · 当前余额 ${money(client.balance)}`;
  updateBalanceForm();
  els.balanceDialog.showModal();
}

function updateBalanceForm() {
  const operation = els.balanceOperation.value;
  const labels = { subtract: ["扣款金额", "确认扣款"], set: ["目标余额", "确认设定"] };
  const [amountLabel, submitLabel] = labels[operation] || labels.subtract;
  els.balanceAmountLabel.textContent = amountLabel;
  els.balanceSubmitButton.textContent = submitLabel;
  els.balanceForm.elements.amount.min = operation === "set" ? "0" : "0.01";
}

function renderCustomerTable() {
  if (!adminState || !els.customerTable) return;
  const query = String(els.customerSearch.value || "").trim().toLowerCase();
  const clients = adminState.clients.filter((client) => {
    const accountUser = clientAccount(client.id);
    return `${client.name} ${client.contact || ""} ${accountUser?.username || ""} ${accountUser?.lastLoginIp || ""}`.toLowerCase().includes(query);
  });
  els.customerCount.textContent = `${clients.length} 个客户账户`;
  els.customerTable.innerHTML = clients.map((client) => {
    const accountUser = clientAccount(client.id);
    const serviceCount = adminState.services.filter((item) => item.clientId === client.id).length;
    return `<tr>
      <td><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.contact || "无联系方式")}</small></td>
      <td><strong>${escapeHtml(accountUser?.username || "未创建")}</strong><small>登录 ${Number(accountUser?.loginCount || 0)} 次</small></td>
      <td><strong>${money(client.balance)}</strong></td>
      <td><button class="instance-count-button" data-view-client-services="${escapeHtml(client.id)}" type="button">查看 ${serviceCount} 台</button></td>
      <td>${accountUser?.lastLoginAt ? escapeHtml(formatTime(accountUser.lastLoginAt)) : "从未登录"}</td>
      <td><code>${escapeHtml(accountUser?.lastLoginIp || "-")}</code></td>
      <td><span class="password-state">已加密</span><small>${accountUser?.passwordChangedAt ? formatTime(accountUser.passwordChangedAt) : "-"}</small></td>
      <td><div class="table-actions"><button class="recharge-action" data-topup="${escapeHtml(client.id)}" type="button">人工充值</button><button data-balance-adjust="${escapeHtml(client.id)}" type="button">余额调整</button><button data-login-history="${escapeHtml(client.id)}" type="button">登录记录</button><button data-reset-password="${escapeHtml(client.id)}" type="button">修改密码</button><button class="danger-text" data-delete-client="${escapeHtml(client.id)}" type="button">删除</button></div></td>
    </tr>`;
  }).join("") || emptyRow(8);
}

function renderAdminVmTable() {
  if (!adminState || !els.adminVmTable) return;
  const query = String(els.adminVmSearch.value || "").trim().toLowerCase();
  const services = sortServicesByVmid(adminState.services.filter((service) => `${service.name} ${clientEmail(service.clientId)} ${clientName(service.clientId)} ${hardwareSpec(service)} ${service.pveVmid || ""} ${service.internalIp || ""} ${productPublicIp(service)} ${remoteAccessAddress(service)}`.toLowerCase().includes(query)));
  els.adminVmCount.textContent = `${services.length} 台已绑定虚拟机`;
  els.adminVmTable.innerHTML = services.map((service) => {
    const runtime = pveVms.find((vm) => String(vm.vmid) === String(service.pveVmid) && (!service.pveNode || vm.node === service.pveNode));
    const runtimeStatus = runtime?.status || "unknown";
    const pveTags = String(runtime?.tags || "").split(";").filter(Boolean);
    const hasExpiryTag = pveTags.some((tag) => tag === "clouddesk-expired" || /^expired-\d+-days$/.test(tag));
    const statusLabel = runtimeStatus === "running" ? "运行中" : runtimeStatus === "stopped" ? "已关机" : "未同步";
    const remaining = daysLeft(service.expiresAt);
    const startDisabled = runtimeStatus === "running" ? " disabled" : "";
    const runningDisabled = runtimeStatus === "stopped" ? " disabled" : "";
    return `<tr>
      <td class="vm-identity"><strong>VM ${escapeHtml(service.pveVmid || "-")}</strong><small>${escapeHtml(service.name)}</small></td>
      <td>${escapeHtml(clientEmail(service.clientId))}</td>
      <td>${specBadge(service)}</td>
      <td class="vm-nat"><strong><code>${escapeHtml(productPublicIp(service))}</code></strong><small><code>${escapeHtml(service.internalIp || "未配置")}</code></small></td>
      <td class="vm-access"><strong>${copyControl(natPortRange(service), "端口范围")}</strong><small>${copyControl(remoteAccessAddress(service), "远程桌面地址")}</small></td>
      <td>${credentialsControl(service, true)}</td>
      <td><span class="runtime-state ${escapeHtml(runtimeStatus)}">${escapeHtml(statusLabel)}</span></td>
      <td class="vm-expiry ${remaining <= 7 ? "urgent" : ""}"><strong>${escapeHtml(service.expiresAt || "-")}</strong><small>${escapeHtml(expiryText(service.expiresAt))}</small>${hasExpiryTag && remaining < 0 ? `<span class="expiry-tag">已到期 ${Math.abs(remaining)} 天</span>` : ""}</td>
      <td><div class="vm-extension"><input data-vm-days="${escapeHtml(service.id)}" type="number" min="1" max="3650" step="1" value="3" aria-label="${escapeHtml(service.name)} 延期天数"><button data-admin-extend="${escapeHtml(service.id)}" type="button">增加</button></div></td>
      <td><div class="vm-date-control"><input data-vm-expiry-date="${escapeHtml(service.id)}" type="date" value="${escapeHtml(service.expiresAt || "")}" aria-label="${escapeHtml(service.name)} 指定到期日"><button data-admin-set-expiry="${escapeHtml(service.id)}" type="button">设定</button></div></td>
      <td><div class="vm-actions"><button class="stats-action" data-resource-stats="${escapeHtml(service.id)}" type="button">统计</button><button data-admin-vm-action="start" data-service-id="${escapeHtml(service.id)}" type="button"${startDisabled}>开机</button><button data-admin-vm-action="shutdown" data-service-id="${escapeHtml(service.id)}" type="button"${runningDisabled}>关机</button><button data-admin-vm-action="reboot" data-service-id="${escapeHtml(service.id)}" type="button"${runningDisabled}>重启</button><button class="force-action" data-admin-vm-action="stop" data-service-id="${escapeHtml(service.id)}" type="button"${runningDisabled}>强制停止</button>${isWindowsPasswordService(service) ? `<button class="password-reset-action" data-reset-vm-password="${escapeHtml(service.id)}" data-reset-mode="admin" type="button">重置密码</button>` : ""}<button class="vnc-action" data-admin-vnc="${escapeHtml(service.id)}" type="button">VNC</button></div></td>
    </tr>`;
  }).join("") || emptyRow(11);
}

function clientAccount(clientId) {
  return adminState?.users.find((user) => user.clientId === clientId && user.role === "client");
}

function switchCustomerPane(pane) {
  const manage = pane !== "create";
  els.customerTabs.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.customerPane === (manage ? "manage" : "create")));
  els.customerManagePane.classList.toggle("hidden", !manage);
  els.clientForm.classList.toggle("hidden", manage);
  if (manage) renderCustomerTable();
}

function openPasswordDialog(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  const accountUser = clientAccount(clientId);
  if (!client || !accountUser) return toast("客户登录账户不存在");
  els.passwordForm.reset();
  els.passwordForm.elements.clientId.value = client.id;
  els.passwordClientName.textContent = `${client.name} · ${accountUser.username}`;
  els.passwordResult.classList.add("hidden");
  els.passwordResultValue.value = "";
  els.passwordDialog.showModal();
}

function openLoginHistory(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  const accountUser = clientAccount(clientId);
  if (!client || !accountUser) return toast("客户登录账户不存在");
  els.loginHistoryClientName.textContent = `${client.name} · ${accountUser.username} · 共登录 ${Number(accountUser.loginCount || 0)} 次`;
  els.loginHistoryList.innerHTML = (accountUser.loginHistory || []).map((entry) => rowItem(entry.ip || "unknown", formatTime(entry.at), "登录成功")).join("") || empty("暂无登录记录");
  els.loginHistoryDialog.showModal();
}

function openClientServices(clientId) {
  if (!renderClientServices(clientId)) return;
  if (!els.clientServicesDialog.open) els.clientServicesDialog.showModal();
}

function renderClientServices(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  if (!client) return false;
  const accountUser = clientAccount(clientId);
  const services = sortServicesByVmid(adminState.services.filter((item) => item.clientId === clientId));
  els.clientServicesDialog.dataset.clientId = clientId;
  els.clientServicesName.textContent = `${client.name} · ${accountUser?.username || "未创建登录账户"} · ${services.length} 台`;
  els.clientServicesList.innerHTML = services.map((service) => {
    const runtime = pveVms.find((vm) => vm.node === service.pveNode && String(vm.vmid) === String(service.pveVmid));
    const runtimeStatus = runtime?.status || "unknown";
    const statusLabel = runtimeStatus === "running" ? "运行中" : runtimeStatus === "stopped" ? "已关机" : "未同步";
    const type = service.pveType === "lxc" ? "LXC" : "KVM/QEMU";
    return `<article class="owned-service-item">
      <div class="owned-service-heading"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(remoteAccessAddress(service))}</small></div><span class="runtime-state ${escapeHtml(runtimeStatus)}">${statusLabel}</span></div>
      <div class="owned-service-details"><span><small>类型 / VMID</small>${type} / ${escapeHtml(service.pveVmid || "-")}</span><span><small>配置</small>${specBadge(service)}</span><span><small>公网 IP</small>${escapeHtml(productPublicIp(service))}</span><span><small>内网 IP</small>${escapeHtml(service.internalIp || "未配置")}</span><span><small>端口范围</small>${copyControl(natPortRange(service), "端口范围")}</span><span><small>远程桌面地址</small>${copyControl(remoteAccessAddress(service), "远程桌面地址")}</span><span><small>登录凭据</small>${credentialsControl(service)}</span><span><small>到期时间</small>${escapeHtml(service.expiresAt || "-")}</span><span><small>剩余时间</small>${escapeHtml(expiryText(service.expiresAt))}</span></div>
      <div class="owned-service-actions"><button class="secondary-button compact" data-edit-service-credentials="${escapeHtml(service.id)}" type="button">编辑凭据</button><button class="secondary-button compact stats-action" data-resource-stats="${escapeHtml(service.id)}" type="button">资源统计</button><button class="danger-button compact" data-unbind-service="${escapeHtml(service.id)}" type="button">解除绑定</button></div>
    </article>`;
  }).join("") || empty("该客户当前没有绑定虚拟机");
  return true;
}

async function removeServiceBinding(serviceId) {
  const service = adminState.services.find((item) => item.id === serviceId);
  if (!service) return toast("服务绑定不存在或已被移除");
  const clientId = service.clientId;
  if (!confirm(`确认解除“${service.name}”与客户的绑定？\n\n此操作只删除系统内的客户服务映射，不会删除、关机或修改 PVE 中的虚拟机。`)) return;
  try {
    const payload = await api(`/api/admin/services/${encodeURIComponent(serviceId)}`, { method: "DELETE" });
    adminState = payload.data;
    renderAdmin();
    if (els.clientServicesDialog.open) renderClientServices(clientId);
    toast(`已解除 ${payload.unbound?.pveNode || "PVE"}/${payload.unbound?.pveVmid || "VM"} 的本地绑定`);
  } catch (error) { toast(error.message); }
}

function generateSecurePassword(length = 16) {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_+"];
  const alphabet = groups.join("");
  const randomIndex = (size) => {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return bytes[0] % size;
  };
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < length) characters.push(alphabet[randomIndex(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

async function removeClient(clientId) {
  const client = adminState.clients.find((item) => item.id === clientId);
  if (!client) return;
  const services = adminState.services.filter((item) => item.clientId === clientId).length;
  const message = services
    ? `确认删除“${client.name}”？将同时移除该账号、${services} 个本地服务绑定及相关账单流水，但不会删除 PVE 中的虚拟机。`
    : `确认删除“${client.name}”及其本地账单流水？`;
  if (!confirm(message)) return;
  try {
    const payload = await api(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: "DELETE" });
    adminState = payload.data;
    renderAdmin();
    toast(`客户已删除${payload.removedServices ? `，移除 ${payload.removedServices} 个本地绑定` : ""}`);
  } catch (error) { toast(error.message); }
}

async function loadPveConfig() {
  try {
    const config = (await api("/api/admin/pve/config")).data;
    els.pveForm.elements.host.value = config.host || "";
    els.pveForm.elements.port.value = config.port || 8006;
    els.pveForm.elements.tokenId.value = config.tokenId || "";
    els.pveForm.elements.tokenSecret.placeholder = config.hasTokenSecret ? "已保存，留空不修改" : "请输入 Token Secret";
    els.pveForm.elements.rejectUnauthorized.checked = config.rejectUnauthorized;
    if (config.host && config.tokenId && config.hasTokenSecret) await loadPveHealth();
  } catch (error) { els.pveStatus.textContent = error.message; }
}

async function loadMailConfig() {
  try {
    const config = (await api("/api/admin/mail/config")).data;
    applyMailConfig(config);
  } catch (error) {
    els.mailStatus.className = "connection-state error";
    els.mailStatus.textContent = error.message;
  }
}

function applyMailConfig(config) {
  els.mailForm.elements.host.value = config.host || "";
  els.mailForm.elements.port.value = config.port || 465;
  els.mailForm.elements.user.value = config.user || "";
  els.mailForm.elements.password.placeholder = config.hasPassword ? "已保存，留空不修改" : "请输入 SMTP 密码";
  els.mailForm.elements.fromEmail.value = config.fromEmail || "";
  els.mailForm.elements.senderName.value = config.senderName || "tidc";
  els.mailForm.elements.portalUrl.value = config.portalUrl || "";
  els.mailForm.elements.adminEmail.value = config.adminEmail || "";
  els.mailForm.elements.secure.checked = config.secure !== false;
  els.mailForm.elements.rejectUnauthorized.checked = config.rejectUnauthorized !== false;
  for (const name of ["notificationsEnabled", "expiry5Enabled", "expiry3Enabled", "deletionWarningEnabled", "purchaseEnabled", "renewalEnabled", "topupEnabled", "unbindEnabled", "passwordResetEnabled", "adminPurchaseEnabled", "adminExpiryEnabled"]) {
    els.mailForm.elements[name].checked = Boolean(config[name]);
  }
  els.mailStatus.className = `connection-state ${config.configured ? "success" : "warning"}`;
  const scanText = config.lastReminderRunAt ? ` · 上次扫描 ${formatTime(config.lastReminderRunAt)}` : "";
  const adminEmailText = config.adminEmail ? ` · 管理员邮箱 ${config.adminEmail}` : " · 管理员邮箱未绑定";
  els.mailStatus.textContent = config.configured ? `SMTP 已配置 · ${config.host}:${config.port} · 业务通知${config.notificationsEnabled ? "已启用" : "未启用"}${adminEmailText}${scanText}` : "尚未完成 SMTP 配置";
}

async function loadPveHealth() {
  els.pveStatus.className = "connection-state checking";
  els.pveStatus.textContent = "正在检查 API、节点、虚拟机和 Token 权限...";
  els.pveHealth.innerHTML = "";
  try {
    const data = (await api("/api/admin/pve/health")).data;
    pveNodes = data.nodes || [];
    pveVms = data.vms || [];
    els.pveStatus.className = `connection-state ${data.warnings.length ? "warning" : "success"}`;
    els.pveStatus.textContent = `API 已连接 · PVE ${data.version} · ${formatTime(data.checkedAt)}`;
    els.pveHealth.innerHTML = `
      <div><strong>${data.nodes.length}</strong><span>可见节点</span></div>
      <div><strong>${data.vms.length}</strong><span>可见虚拟机</span></div>
      <div><strong>${data.permissionPaths}</strong><span>权限路径</span></div>
    ` + data.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
    renderPveVmList();
    renderBindingOptions();
    renderAdminVmTable();
    renderPurchaseOrders();
    toast(data.warnings.length ? "PVE 已连接，但 Token 权限需要调整" : "PVE 连接与权限正常");
  } catch (error) {
    els.pveStatus.className = "connection-state error";
    els.pveStatus.textContent = `连接失败：${error.message}`;
    els.pveHealth.innerHTML = `<p>请检查主机地址、8006 端口、Token ID/Secret 与服务器网络。</p>`;
    toast(error.message);
  }
}

async function refreshPveVms() {
  try {
    await loadPveHealth();
  } catch (error) { els.pveStatus.textContent = error.message; toast(error.message); }
}

function renderPveVmList() {
  els.pveVmList.innerHTML = pveVms.map((vm) => rowItem(`${vm.name || "未命名"} · VM ${vm.vmid}`, `${vm.node} · ${vm.type || "qemu"}`, vm.status || "-")).join("") || empty("Token 当前看不到虚拟机");
}

function renderBindingOptions() {
  if (!els.servicePveNode || !adminState) return;
  const currentNode = els.servicePveNode.value;
  const nodes = pveNodes.map((node) => node.node).filter(Boolean);
  els.servicePveNode.innerHTML = nodes.length
    ? `<option value="">请选择节点</option>${nodes.map((node) => option(node, node)).join("")}`
    : `<option value="">未读取到 PVE 节点</option>`;
  if (nodes.includes(currentNode)) els.servicePveNode.value = currentNode;
  else if (nodes.length === 1) els.servicePveNode.value = nodes[0];
  renderBindingVmOptions();
}

function renderBindingVmOptions() {
  if (!els.servicePveVmid || !adminState) return;
  const node = els.servicePveNode.value;
  const type = els.servicePveType.value;
  const currentVmid = els.servicePveVmid.value;
  const available = pveVms.filter((vm) => {
    const vmType = vm.type === "lxc" ? "lxc" : "qemu";
    const alreadyBound = adminState.services.some((service) => service.pveNode === vm.node && String(service.pveVmid) === String(vm.vmid));
    return vm.node === node && vmType === type && !alreadyBound;
  });
  let placeholder = node ? "请选择虚拟机" : "请先选择节点";
  if (node && !available.length) placeholder = pveVms.length ? "该节点没有未绑定的此类实例" : "Token 当前看不到虚拟机";
  els.servicePveVmid.innerHTML = `<option value="">${placeholder}</option>` + available.map((vm) => {
    const mapping = natMapping(vm.vmid, vm.type === "lxc" ? "lxc" : "qemu");
    const natText = mapping ? ` · ${mapping.internalIp} · ${mapping.portStart}-${mapping.portEnd}` : " · 未配置 NAT 映射";
    return option(String(vm.vmid), `VM ${vm.vmid} · ${vm.name || "未命名"} · ${vm.status || "未知"}${natText}`);
  }).join("");
  if (available.some((vm) => String(vm.vmid) === currentVmid)) els.servicePveVmid.value = currentVmid;
  els.bindingResourceStatus.textContent = pveNodes.length
    ? `已连接 ${pveNodes.length} 个节点，读取到 ${pveVms.length} 台虚拟机；当前可绑定 ${available.length} 台`
    : "尚未读取到 PVE 节点，请刷新资源或检查连接";
  prefillServiceFromVm();
}

function prefillServiceFromVm() {
  const vm = pveVms.find((item) => item.node === els.servicePveNode.value && String(item.vmid) === els.servicePveVmid.value);
  if (vm && !els.serviceForm.elements.name.value) els.serviceForm.elements.name.value = vm.name || `VM-${vm.vmid}`;
  const mapping = natMapping(els.servicePveVmid.value, els.servicePveType.value);
  for (const name of ["internalIp", "portStart", "portEnd", "remotePort"]) els.serviceForm.elements[name].value = "";
  for (const name of ["internalIp", "portStart", "portEnd"]) els.serviceForm.elements[name].readOnly = Boolean(mapping);
  if (mapping) {
    els.serviceForm.elements.internalIp.value = mapping.internalIp;
    els.serviceForm.elements.portStart.value = mapping.portStart;
    els.serviceForm.elements.portEnd.value = mapping.portEnd;
    els.serviceForm.elements.remotePort.value = mapping.portStart;
  }
  updateServiceNatPreview();
}

function natMapping(vmid, type) {
  return adminState?.natMappings?.find((item) => String(item.pveVmid) === String(vmid) && item.pveType === type);
}

function updateServiceNatPreview() {
  if (!els.serviceNatPreview) return;
  const product = adminState?.products.find((item) => item.id === els.serviceProduct.value);
  const remotePort = Number(els.serviceForm.elements.remotePort.value || 0);
  els.serviceNatPreview.querySelector("strong").textContent = product?.publicIp && remotePort ? `${product.publicIp}:${remotePort}` : "请先选择套餐和 VMID";
}

function switchView(viewId) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  const info = viewInfo[viewId] || ["服务中心", ""];
  els.viewTitle.textContent = info[0];
  els.viewSubtitle.textContent = info[1];
  if (viewId === "bindings") {
    renderBindingOptions();
    if (!pveNodes.length && session?.role === "admin") loadPveHealth();
  }
  if (viewId === "purchase-orders") {
    renderPurchaseOrders();
    if (!pveNodes.length && session?.role === "admin") loadPveHealth();
  }
  if (viewId === "admin-vms") renderAdminVmTable();
}

function metric(label, value, note, action = "") {
  return `<article class="metric-card"><div class="metric-card-head"><span>${escapeHtml(label)}</span>${action}</div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function rowItem(title, meta, value, tone = "", allowHtml = false) {
  return `<article class="row-item"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></div><div class="row-value ${tone}">${allowHtml ? value : escapeHtml(value)}</div></article>`;
}

function statusBadge(status) {
  const labels = { active: "有效", suspended: "暂停", expired: "已到期", paid: "已支付", unpaid: "未支付", partial: "部分支付", cancelled: "已取消", pending: "待审核", provisioned: "已开通", rejected: "已退款" };
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(labels[status] || status || "未知")}</span>`;
}

function productName(id) {
  const products = portal?.products || adminState?.products || [];
  return products.find((item) => item.id === id)?.name || "未命名套餐";
}

function serviceProduct(service, product = null) {
  const products = portal?.products || adminState?.products || [];
  return product || products.find((item) => item.id === service.productId) || null;
}

function hardwareSpec(service, product = null) {
  const matched = serviceProduct(service, product);
  return productHardwareSpec(matched);
}

function productHardwareSpec(product) {
  const matched = product || null;
  const cpu = Number(matched?.cpu || 0);
  const memory = Number(matched?.memory || 0);
  const disk = Number(matched?.disk || 0);
  if (!cpu || !memory) return "规格待补充";
  return `${cpu}H${memory}G${disk ? ` · ${disk}G` : ""}`;
}

function specBadge(service, product = null) {
  const spec = hardwareSpec(service, product);
  return `<span class="spec-badge ${spec === "规格待补充" ? "missing" : ""}">${escapeHtml(spec)}</span>`;
}

function productPublicIp(service, product = null) {
  const products = portal?.products || adminState?.products || [];
  const matched = product || products.find((item) => item.id === service.productId);
  return matched?.publicIp || service.ipv4 || "未设置";
}

function natPortRange(service) {
  const start = Number(service.portStart || 0);
  const end = Number(service.portEnd || 0);
  return start && end ? `${start}-${end}` : "未配置";
}

function remoteAccessAddress(service, product = null) {
  const publicIp = productPublicIp(service, product);
  const port = Number(service.remotePort || service.portStart || 0);
  return publicIp !== "未设置" && port ? `${publicIp}:${port}` : "未配置远程地址";
}

function setTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  try { localStorage.setItem("tidc-theme", normalized); } catch {}
  document.querySelectorAll("[data-theme-label]").forEach((label) => { label.textContent = normalized === "dark" ? "浅色" : "深色"; });
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => { button.setAttribute("aria-pressed", String(normalized === "dark")); });
}

function syncThemeControls() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
}

function remoteUsername(service) {
  return String(service?.remoteUsername || defaultRemoteUsername);
}

function remotePassword(service) {
  return String(service?.remotePassword || defaultRemotePassword);
}

function sortServicesByVmid(services) {
  return [...(services || [])].sort((left, right) => {
    const leftRaw = String(left?.pveVmid || "").trim();
    const rightRaw = String(right?.pveVmid || "").trim();
    const leftNumber = /^\d+$/.test(leftRaw) ? Number(leftRaw) : Number.POSITIVE_INFINITY;
    const rightNumber = /^\d+$/.test(rightRaw) ? Number(rightRaw) : Number.POSITIVE_INFINITY;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    const vmidOrder = leftRaw.localeCompare(rightRaw, undefined, { numeric: true });
    if (vmidOrder) return vmidOrder;
    return String(left?.name || "").localeCompare(String(right?.name || ""), "zh-CN");
  });
}

function isWindowsPasswordService(service) {
  if (!service || service.pveType === "lxc") return false;
  return !/debian|ubuntu|centos|rocky|alma|fedora|linux|freebsd|arch|opensuse/i.test(String(service.os || ""));
}

function findService(serviceId) {
  return adminState?.services.find((item) => item.id === serviceId)
    || portal?.services.find((item) => item.id === serviceId);
}

function copyControl(value, label) {
  const text = String(value || "");
  return `<span class="copy-field"><code>${escapeHtml(text)}</code><button type="button" data-copy-value="${escapeHtml(text)}" data-copy-label="${escapeHtml(label)}" aria-label="复制${escapeHtml(label)}">复制</button></span>`;
}

function passwordControl(service) {
  const id = escapeHtml(service.id);
  return `<span class="password-control"><code data-password-display>••••••••</code><button type="button" data-hold-password="${id}" aria-label="按住查看密码">按住查看</button><button type="button" data-copy-password="${id}" aria-label="复制密码">复制</button></span>`;
}

function credentialsControl(service, editable = false) {
  const editButton = editable ? `<button class="credential-edit-button" type="button" data-edit-service-credentials="${escapeHtml(service.id)}">编辑凭据</button>` : "";
  const sourceLabel = service.passwordResetSource === "client" ? "客户自助" : service.passwordResetSource === "purchase-approval" ? "审核开通" : "管理员";
  const resetMeta = service.passwordResetAt ? `<small class="credential-reset-meta">最近重置：${escapeHtml(formatTime(service.passwordResetAt))} · ${sourceLabel}</small>` : "";
  return `<span class="credentials-control"><span>${copyControl(remoteUsername(service), "用户名")}</span><span>${passwordControl(service)}</span>${resetMeta}${editButton}</span>`;
}

function openVmPasswordReset(serviceId, mode) {
  const service = findService(serviceId);
  if (!service) return toast("VPS 服务不存在");
  if (!isWindowsPasswordService(service)) return toast("该实例不是可重置密码的 Windows KVM/QEMU 虚拟机");
  const isAdmin = mode === "admin" && session?.role === "admin";
  els.vmPasswordResetForm.reset();
  els.vmPasswordResetForm.elements.serviceId.value = service.id;
  els.vmPasswordResetForm.elements.mode.value = isAdmin ? "admin" : "client";
  els.vmPasswordResetForm.elements.username.value = remoteUsername(service);
  els.vmPasswordResetForm.elements.password.value = generateSecurePassword(18);
  els.vmPasswordResetForm.elements.password.type = "password";
  els.showVmPasswordReset.checked = false;
  els.vmPasswordResetTitle.textContent = isAdmin ? "管理员重置 Windows 密码" : "自助重置 Windows 密码";
  els.vmPasswordResetService.textContent = `${service.name} · VM ${service.pveVmid || "-"}`;
  els.vmPasswordResetNotice.textContent = isAdmin
    ? "重置成功后将更新后台保存的当前密码并记录管理员操作，不会向客户发送邮件。"
    : "重置成功后将更新后台保存的当前密码，并向账户绑定邮箱发送新密码和客户后台地址。";
  els.vmPasswordResetSubmit.textContent = isAdmin ? "确认重置（不发邮件）" : "确认重置并发送邮件";
  els.vmPasswordResetDialog.showModal();
}

function openServiceCredentials(serviceId) {
  const service = adminState?.services.find((item) => item.id === serviceId);
  if (!service) return toast("VPS 服务不存在");
  els.serviceCredentialsForm.reset();
  els.serviceCredentialsForm.elements.serviceId.value = service.id;
  els.serviceCredentialsForm.elements.remoteUsername.value = remoteUsername(service);
  els.serviceCredentialsForm.elements.remotePassword.value = remotePassword(service);
  els.serviceCredentialsForm.elements.remotePassword.type = "password";
  els.showServiceCredentialPassword.checked = false;
  els.serviceCredentialsName.textContent = `${service.name} · VM ${service.pveVmid || "-"} · ${clientName(service.clientId)}`;
  els.serviceCredentialsDialog.showModal();
}

async function copyText(value, label) {
  const text = String(value || "");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }
  toast(`${label}已复制`);
}

function clientName(id) {
  return adminState?.clients.find((item) => item.id === id)?.name || "未知客户";
}

function clientEmail(id) {
  const client = adminState?.clients.find((item) => item.id === id);
  const contact = String(client?.contact || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return contact;

  const username = String(clientAccount(id)?.username || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return username;
  return "未绑定邮箱";
}

function serviceName(id) {
  return adminState?.services.find((item) => item.id === id)?.name || (id ? id : "账户充值");
}

function daysLeft(dateString) {
  if (!dateString) return -9999;
  const end = Date.parse(`${dateString}T00:00:00Z`);
  const current = Date.parse(`${shanghaiDateString()}T00:00:00Z`);
  return Math.round((end - current) / 86400000);
}

function expiryText(dateString) {
  const days = daysLeft(dateString);
  if (days < 0) return `已到期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `剩余 ${days} 天`;
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function option(value, label, selected = false) { return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`; }
function money(value) {
  const amount = Number(value || 0);
  const formatted = Math.abs(amount).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-¥${formatted}` : `¥${formatted}`;
}
function sum(rows, key) { return rows.reduce((total, row) => total + Number(row[key] || 0), 0); }
function empty(text) { return `<div class="empty-state">${escapeHtml(text)}</div>`; }
function emptyRow(cols) { return `<tr><td class="empty-state" colspan="${cols}">暂无记录</td></tr>`; }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }

function setDefaultDates() {
  const start = shanghaiDateString();
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  els.serviceForm.elements.startDate.value = start;
  els.serviceForm.elements.expiresAt.value = end.toISOString().slice(0, 10);
}

function shanghaiDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

wireEvents();
syncThemeControls();
setDefaultDates();
restoreSession();
