// Consolidated auth handler. Routed via vercel.json rewrites:
//   /api/users/auth/:a      ->  /api/auth?a=:a       (default|session|logout|register|resetPassword)
//   /api/users/auth/2fa/:a   ->  /api/auth?r=2fa&a=:a (generate|initializePanelSession — stub)
const { sb } = require("../lib/sb");
const { userJson } = require("../lib/user");

async function getProfile(id) {
  for (let i = 0; i < 10; i++) {
    const rows = await sb(
      "/rest/v1/profiles?select=id,seq,username,email,role,sub_until,hwid,banned_hwid,created_at&id=eq." + id
    );
    if (rows.length) return rows[0];
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function login(req, res) {
  try {
    const { username, password } = req.query;
    if (!username || !password) return res.status(400).send("Majburiy maydonlar to'ldirilmagan.");
    let email = username;
    if (!username.includes("@")) {
      try {
        email = await sb("/rest/v1/rpc/login_email", { method: "POST", body: JSON.stringify({ p_login: username }) }, true);
      } catch (e) {
        return res.status(400).send("Login yoki parol noto'g'ri.");
      }
      if (typeof email !== "string" || !email.includes("@")) return res.status(400).send("Login yoki parol noto'g'ri.");
    }
    let s;
    try {
      s = await sb("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }, true);
    } catch (e) {
      return res.status(400).send("Login yoki parol noto'g'ri.");
    }
    if (!s.user) return res.status(400).send("Login yoki parol noto'g'ri.");
    const rows = await sb("/rest/v1/profiles?select=id,seq,username,email,role,sub_until,hwid,banned_hwid,created_at&id=eq." + s.user.id);
    if (!rows.length) return res.status(400).send("Login yoki parol noto'g'ri.");
    const sess = await sb("/rest/v1/web_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: rows[0].id }),
    });
    const out = userJson(rows[0], sess[0].token);
    out.authMessage = "Muvaffaqiyatli kirdingiz.";
    return res.status(200).json(out);
  } catch (e) {
    return res.status(400).send("Avtorizatsiyada xatolik.");
  }
}

async function session(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Sessiya muddati tugagan.");
    const rows = await sb(
      "/rest/v1/web_sessions?select=user_id,profiles(id,seq,username,email,role,sub_until,hwid,banned_hwid,created_at)&token=eq." + encodeURIComponent(token)
    );
    if (!rows.length || !rows[0].profiles) return res.status(400).send("Sessiya muddati tugagan.");
    return res.status(200).json(userJson(rows[0].profiles, token));
  } catch (e) {
    return res.status(400).send("Sessiya muddati tugagan.");
  }
}

async function logout(req, res) {
  try {
    const { token } = req.query;
    if (token) await sb("/rest/v1/web_sessions?token=eq." + encodeURIComponent(token), { method: "DELETE" });
    return res.status(200).send("OK");
  } catch (e) {
    return res.status(200).send("OK");
  }
}

async function register(req, res) {
  try {
    const { username, password, email } = req.query;
    if (!username || !password || !email) return res.status(400).send("Majburiy maydonlar to'ldirilmagan.");
    let u;
    try {
      u = await sb("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username } }),
      });
    } catch (e) {
      const m = String((e.body && (e.body.msg || e.body.message)) || "");
      if (/already|exists|registered/i.test(m)) return res.status(400).send("Bu email boshqa foydalanuvchiga biriktirilgan.");
      throw e;
    }
    const p = await getProfile(u.id);
    if (!p) return res.status(400).send("Ro'yxatdan o'tishda xatolik, qayta urining.");
    const s = await sb("/rest/v1/web_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: p.id }),
    });
    const out = userJson(p, s[0].token);
    out.authMessage = "Muvaffaqiyatli ro'yxatdan o'tdingiz.";
    return res.status(200).json(out);
  } catch (e) {
    return res.status(400).send("Ro'yxatdan o'tishda xatolik.");
  }
}

async function resetPassword(req, res) {
  try {
    const { email, newPassword } = req.query;
    if (!email || !newPassword || newPassword.length < 6) return res.status(400).send("Majburiy maydonlar to'ldirilmagan.");
    const rows = await sb("/rest/v1/profiles?select=id&email=ilike." + encodeURIComponent(email));
    if (!rows.length) return res.status(400).send("Foydalanuvchi topilmadi.");
    await sb("/auth/v1/admin/users/" + rows[0].id, { method: "PUT", body: JSON.stringify({ password: newPassword }) });
    await sb("/rest/v1/web_sessions?user_id=eq." + rows[0].id, { method: "DELETE" });
    return res.status(200).send("Parol o'zgartirildi.");
  } catch (e) {
    return res.status(400).send("Tiklashda xatolik.");
  }
}

module.exports = async (req, res) => {
  const r = req.query.r || "";
  const a = req.query.a;
  if (r === "2fa") return res.status(400).send("Autentifikator tez orada ishga tushadi.");
  if (r === "state") return res.status(200).send("OK");
  if (a === "default") return login(req, res);
  if (a === "session") return session(req, res);
  if (a === "logout") return logout(req, res);
  if (a === "register") return register(req, res);
  if (a === "resetPassword") return resetPassword(req, res);
  return res.status(404).send("Not found.");
};
