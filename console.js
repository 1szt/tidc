import noVncModule from "./vendor/novnc.js";

const RFB = noVncModule.default || noVncModule;
const params = new URLSearchParams(location.search);
const path = String(params.get("path") || "").replace(/^\/+/, "");
const name = params.get("name") || "VNC 控制台";
const screen = document.querySelector("#screen");
const status = document.querySelector("#consoleStatus");
const errorBox = document.querySelector("#consoleError");
let rfb = null;
let connectionTimer = null;
let diagnosing = false;

document.querySelector("#consoleName").textContent = name;

function fail(message) {
  clearTimeout(connectionTimer);
  status.textContent = "连接失败";
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

async function diagnose(token, fallback) {
  if (diagnosing) return;
  diagnosing = true;
  try {
    const response = await fetch(`/api/portal/console/${encodeURIComponent(token)}/status`);
    const payload = await response.json();
    const data = payload.data || {};
    if (data.stage === "issued") return fail("网页可以访问，但 VNC WebSocket 没有到达服务端。请让网站通过 HTTPS 443 提供服务，并检查反向代理是否转发 Upgrade 和 Connection 请求头。");
    if (data.stage === "connecting-pve") return fail("浏览器已经连接到本站，但本站服务器连接 PVE WebSocket 超时。请检查服务器到 PVE 8006 端口的直连路由、防火墙和运营商网络。");
    if (data.stage === "pve-error") return fail(`本站服务器连接 PVE 失败：${data.error || "未知网络错误"}`);
    return fail(fallback);
  } catch {
    return fail(fallback);
  } finally {
    diagnosing = false;
  }
}

async function connect() {
  if (!path) {
    fail("控制台令牌缺失，请关闭窗口后从客户服务中心重新打开 VNC。");
    return;
  }
  const token = path.split("/").pop();
  let password = "";
  try {
    const response = await fetch(`/api/portal/console/${encodeURIComponent(token)}/credentials`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "无法取得 VNC 临时票据");
    password = payload.data.password;
  } catch (error) {
    fail(error.message || "无法取得 VNC 临时票据");
    return;
  }
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socketUrl = `${scheme}://${location.host}/${path}`;
  try {
    rfb = new RFB(screen, socketUrl, { shared: true, credentials: { password } });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.clipViewport = false;
    rfb.showDotCursor = true;
    rfb.qualityLevel = 6;
    rfb.compressionLevel = 6;
    connectionTimer = setTimeout(() => diagnose(token, "VNC WebSocket 建立超时，请检查本站 443 端口和反向代理配置。"), 15000);
    rfb.addEventListener("connect", () => {
      clearTimeout(connectionTimer);
      status.textContent = "已连接";
      errorBox.classList.add("hidden");
      password = "";
    });
    rfb.addEventListener("disconnect", (event) => {
      clearTimeout(connectionTimer);
      if (event.detail.clean) status.textContent = "已断开";
      else diagnose(token, "VNC 连接已中断，请关闭窗口后重新打开控制台。");
    });
    rfb.addEventListener("securityfailure", (event) => fail(`VNC 验证失败：${event.detail.reason || "票据无效"}`));
    rfb.addEventListener("credentialsrequired", () => fail("PVE 拒绝了临时 VNC 票据，请重新打开控制台。"));
  } catch (error) {
    fail(error.message || "无法初始化 VNC 客户端");
  }
}

if (!path) {
  fail("控制台令牌缺失，请关闭窗口后从客户服务中心重新打开 VNC。");
} else {
  connect();
}

document.querySelector("#sendCad").addEventListener("click", () => rfb?.sendCtrlAltDel());
document.querySelector("#disconnect").addEventListener("click", () => rfb?.disconnect());
document.querySelector("#fullscreen").addEventListener("click", () => document.documentElement.requestFullscreen?.());
