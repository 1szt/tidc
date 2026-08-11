const WINDOWS_PASSWORD_MIN_LENGTH = 8;
const WINDOWS_PASSWORD_MAX_LENGTH = 64;
const PASSWORD_GROUPS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_+"];

function passwordError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isWindowsPasswordGuest(service) {
  if (!service || service.pveType === "lxc") return false;
  const os = String(service.os || "").trim().toLowerCase();
  if (/debian|ubuntu|centos|rocky|alma|fedora|linux|freebsd|arch|opensuse/.test(os)) return false;
  return true;
}

function prepareWindowsPasswordReset(service, password) {
  if (!isWindowsPasswordGuest(service)) throw passwordError("该实例不是可重置密码的 Windows KVM/QEMU 虚拟机", 409);
  if (!service.pveNode || !service.pveVmid) throw passwordError("服务尚未绑定 PVE 虚拟机", 409);

  const username = String(service.remoteUsername || "Administrator").trim();
  const nextPassword = String(password || "");
  if (!username || username.length > 100) throw passwordError("Windows 用户名配置不正确", 409);
  if (nextPassword.length < WINDOWS_PASSWORD_MIN_LENGTH || nextPassword.length > WINDOWS_PASSWORD_MAX_LENGTH) {
    throw passwordError(`新密码需要是 ${WINDOWS_PASSWORD_MIN_LENGTH} 至 ${WINDOWS_PASSWORD_MAX_LENGTH} 个字符`);
  }
  if (/[\r\n\0]/.test(nextPassword)) throw passwordError("新密码不能包含换行或空字符");

  const characterGroups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(nextPassword)).length;
  if (characterGroups < 3) throw passwordError("新密码至少需要包含大写字母、小写字母、数字、符号中的三类");
  if (nextPassword.toLowerCase().includes(username.toLowerCase())) throw passwordError("新密码不能包含 Windows 用户名");

  return { username, password: nextPassword };
}

function generateWindowsPassword(length = 18) {
  const crypto = require("crypto");
  const size = Math.max(12, Math.min(WINDOWS_PASSWORD_MAX_LENGTH, Number(length) || 18));
  const all = PASSWORD_GROUPS.join("");
  const characters = PASSWORD_GROUPS.map((group) => group[crypto.randomInt(group.length)]);
  while (characters.length < size) characters.push(all[crypto.randomInt(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function recordWindowsPasswordReset(service, { password, username, actorId, source, at = new Date().toISOString() }) {
  service.remoteUsername = username;
  service.remotePassword = password;
  service.credentialsUpdatedAt = at;
  service.passwordResetAt = at;
  service.passwordResetBy = actorId;
  service.passwordResetSource = source;
  service.passwordResetCount = Number(service.passwordResetCount || 0) + 1;
  const history = Array.isArray(service.passwordResetHistory) ? service.passwordResetHistory : [];
  service.passwordResetHistory = [{ at, actorId, source, username }, ...history].slice(0, 20);
  return service;
}

module.exports = { generateWindowsPassword, isWindowsPasswordGuest, prepareWindowsPasswordReset, recordWindowsPasswordReset };
