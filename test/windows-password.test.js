const test = require("node:test");
const assert = require("node:assert/strict");
const { generateWindowsPassword, isWindowsPasswordGuest, prepareWindowsPasswordReset, recordWindowsPasswordReset } = require("../windows-password");

const service = () => ({ id: "svc-1", pveNode: "pve01", pveType: "qemu", pveVmid: "158", remoteUsername: "Administrator", remotePassword: "OldPassword1!" });

test("prepares a valid Windows password reset", () => {
  assert.deepEqual(prepareWindowsPasswordReset(service(), "NewPassword2!"), { username: "Administrator", password: "NewPassword2!" });
});

test("generates random passwords that satisfy the Windows policy", () => {
  const generated = new Set(Array.from({ length: 20 }, () => generateWindowsPassword()));
  assert.equal(generated.size, 20);
  for (const password of generated) {
    assert.equal(password.length, 18);
    assert.doesNotThrow(() => prepareWindowsPasswordReset(service(), password));
  }
});

test("rejects LXC, unbound services, and weak passwords", () => {
  assert.throws(() => prepareWindowsPasswordReset({ ...service(), pveType: "lxc" }, "NewPassword2!"), /KVM\/QEMU/);
  assert.throws(() => prepareWindowsPasswordReset({ ...service(), os: "Ubuntu 24.04" }, "NewPassword2!"), /不是可重置密码的 Windows/);
  assert.throws(() => prepareWindowsPasswordReset({ ...service(), pveNode: "" }, "NewPassword2!"), /尚未绑定/);
  assert.throws(() => prepareWindowsPasswordReset(service(), "password"), /三类/);
  assert.throws(() => prepareWindowsPasswordReset(service(), "Administrator2!"), /不能包含/);
});

test("detects Windows-capable services without exposing the action on known Linux guests", () => {
  assert.equal(isWindowsPasswordGuest({ ...service(), os: "Windows Server 2022" }), true);
  assert.equal(isWindowsPasswordGuest({ ...service(), os: "待安装" }), true);
  assert.equal(isWindowsPasswordGuest({ ...service(), os: "Debian 12" }), false);
});

test("records only the current password and password-free audit metadata", () => {
  const target = service();
  recordWindowsPasswordReset(target, { password: "NewPassword2!", username: "Administrator", actorId: "u-client", source: "client", at: "2026-08-11T08:00:00.000Z" });
  assert.equal(target.remotePassword, "NewPassword2!");
  assert.equal(target.passwordResetCount, 1);
  assert.deepEqual(target.passwordResetHistory[0], { at: "2026-08-11T08:00:00.000Z", actorId: "u-client", source: "client", username: "Administrator" });
  assert.equal(JSON.stringify(target.passwordResetHistory).includes("NewPassword2!"), false);
  assert.equal(JSON.stringify(target).includes("OldPassword1!"), false);
});
