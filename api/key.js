// Consolidated user-actions handler:
//   /api/users/actions/:a            ->  /api/key?a=:a   (activateDigitalKey|emailSetup)
//   /api/admin/users/resetHardwareId  ->  /api/key?a=userResetHwid  (buyer self-reset)
//   /api/email/setup                  ->  /api/key?a=emailSetup
const { sb } = require("../lib/sb");

async function activateDigitalKey(req, res) {
  try {
    const { token, key } = req.query;
    if (!token || !key) return res.status(400).send("Kiritilgan kalit noto'g'ri.");
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(400).send("Kiritilgan kalit noto'g'ri.");
    const uid = s[0].user_id;
    const keys = await sb("/rest/v1/sub_keys?select=id,days,used&value=eq." + encodeURIComponent(key));
    if (!keys.length || keys[0].used) return res.status(400).send("Kiritilgan kalit noto'g'ri yoki allaqachon ishlatilgan.");
    const k = keys[0];
    const prof = await sb("/rest/v1/profiles?select=id,sub_until&id=eq." + uid);
    let base = new Date();
    if (prof.length && prof[0].sub_until) {
      const cur = new Date(prof[0].sub_until);
      if (!isNaN(cur) && cur > base) base = cur;
    }
    const until = new Date(base.getTime() + k.days * 864e5).toISOString();
    await sb("/rest/v1/profiles?id=eq." + uid, { method: "PATCH", body: JSON.stringify({ sub_until: until }) });
    await sb("/rest/v1/sub_keys?id=eq." + k.id, {
      method: "PATCH",
      body: JSON.stringify({ used: true, used_by: uid, used_at: new Date().toISOString() }),
    });
    return res.status(200).send("Kalit faollashtirildi: +" + k.days + " kun.");
  } catch (e) {
    return res.status(400).send("Kiritilgan kalit noto'g'ri.");
  }
}

// Buyer self HWID reset + admin reset of another user (?user=, admin only).
// Always 200+{message} so the cabinet toast logic works:
// failure messages contain "topilmadi", success does not.
async function userResetHwid(req, res) {
  try {
    const { token, user } = req.query;
    if (!token) return res.status(200).json({ message: "Sessiya topilmadi." });
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(200).json({ message: "Sessiya topilmadi." });
    let targetId = s[0].user_id;
    if (user) {
      const me = await sb("/rest/v1/profiles?select=username,role&id=eq." + s[0].user_id);
      if (!me.length) return res.status(200).json({ message: "Sessiya topilmadi." });
      if (me[0].username !== user && me[0].role !== "ADMIN") {
        return res.status(200).json({ message: "Ruxsat topilmadi." });
      }
      if (me[0].username !== user) {
        const byName = await sb("/rest/v1/profiles?select=id&username=eq." + encodeURIComponent(user));
        if (!byName.length) return res.status(200).json({ message: "Foydalanuvchi topilmadi." });
        targetId = byName[0].id;
      }
    }
    const prof = await sb("/rest/v1/profiles?select=id,hwid&id=eq." + targetId);
    if (!prof.length || !prof[0].hwid) return res.status(200).json({ message: "HWID bog'lanishi topilmadi." });
    await sb("/rest/v1/profiles?id=eq." + targetId, { method: "PATCH", body: JSON.stringify({ hwid: null }) });
    return res.status(200).json({ message: user ? "HWID tiklandi." : "HWID muvaffaqiyatli tiklandi." });
  } catch (e) {
    return res.status(200).json({ message: "HWID bog'lanishi topilmadi." });
  }
}

module.exports = async (req, res) => {
  if (req.query.a === "activateDigitalKey") return activateDigitalKey(req, res);
  if (req.query.a === "userResetHwid") return userResetHwid(req, res);
  if (req.query.a === "emailSetup") return res.status(400).send("Hozircha emailni o'zgartirib bo'lmaydi.");
  if (req.query.a === "changePassword") return changePassword(req, res);
  return res.status(404).send("Not found.");
};

async function changePassword(req, res) {
  try {
    const { token, oldPassword, newPassword } = req.query;
    if (!token || !oldPassword || !newPassword) {
      return res.status(400).send("Iltimos, ikkala maydonni to'ldiring!");
    }
    if (newPassword.length < 6) {
      return res.status(400).send("Yangi parol kamida 6 belgidan iborat bo'lishi kerak!");
    }
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(400).send("Sessiya muddati tugagan.");
    const uid = s[0].user_id;
    const prof = await sb("/rest/v1/profiles?select=id,email&id=eq." + uid);
    if (!prof.length) return res.status(400).send("Foydalanuvchi topilmadi.");
    try {
      await sb("/auth/v1/token?grant_type=password",
        { method: "POST", body: JSON.stringify({ email: prof[0].email, password: oldPassword }) }, true);
    } catch (e) {
      return res.status(400).send("Eski parol noto'g'ri.");
    }
    await sb("/auth/v1/admin/users/" + uid, { method: "PUT", body: JSON.stringify({ password: newPassword }) });
    await sb("/rest/v1/web_sessions?user_id=eq." + uid, { method: "DELETE" });
    return res.status(200).send("Parol o'zgartirildi.");
  } catch (e) {
    return res.status(400).send("Parolni o'zgartirishda xatolik.");
  }
}
