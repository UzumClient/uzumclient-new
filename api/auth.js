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
    if (rows[0].banned_hwid) return res.status(400).send("Akkount bloklangan.");
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
    if (rows[0].profiles.banned_hwid) return res.status(400).send("Akkount bloklangan.");
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
    if (!/^[^@\s]+@gmail\.com$/i.test(email)) {
      return res.status(400).send("Faqat @gmail.com email bilan ro'yxatdan o'tish mumkin.");
    }
    if (username.includes("@") || username.toLowerCase() === email.toLowerCase()) {
      return res.status(400).send("Taxallus email bo'lishi mumkin emas.");
    }
    if (!/^[A-Za-z][A-Za-z0-9_.-]{2,19}$/.test(username)) {
      return res.status(400).send("Taxallus noto'g'ri: lotin harfi bilan boshlansin, 3-20 belgi, bo'sh joy va belgilarsiz.");
    }
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

async function recoverySend(req, res) {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).send("Email kiritilmadi.");
    const rows = await sb("/rest/v1/profiles?select=id&email=ilike." + encodeURIComponent(email));
    if (!rows.length) return res.status(400).send("Bu email bilan akkount topilmadi.");
    try {
      await sb("/auth/v1/recover", { method: "POST", body: JSON.stringify({ email }) }, true);
    } catch (e) {
      return res.status(400).send("Kod yuborishda xatolik. Birozdan keyin urinib ko'ring.");
    }
    return res.status(200).send("Havola emailingizga yuborildi.");
  } catch (e) {
    return res.status(400).send("Xatolik.");
  }
}

async function recoveryVerify(req, res) {
  try {
    const { email, code, newPassword } = req.query;
    if (!email || !code || !newPassword) return res.status(400).send("Barcha maydonlarni to'ldiring.");
    if (newPassword.length < 6) return res.status(400).send("Yangi parol kamida 6 belgidan iborat bo'lishi kerak!");
    let v;
    try {
      v = await sb("/auth/v1/verify",
        { method: "POST", body: JSON.stringify({ email, token: code, type: "recovery" }) }, true);
    } catch (e) {
      return res.status(400).send("Kod noto'g'ri yoki muddati o'tgan.");
    }
    const uid = v && v.user && v.user.id;
    if (!uid) return res.status(400).send("Kod noto'g'ri yoki muddati o'tgan.");
    await sb("/auth/v1/admin/users/" + uid, { method: "PUT", body: JSON.stringify({ password: newPassword }) });
    await sb("/rest/v1/web_sessions?user_id=eq." + uid, { method: "DELETE" });
    return res.status(200).send("Parol o'zgartirildi. Yangi parol bilan kiring.");
  } catch (e) {
    return res.status(400).send("Tiklashda xatolik.");
  }
}

async function recoveryLink(req, res) {
  try {
    const { th, at, newPassword } = req.query;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).send("Yangi parol kamida 6 belgidan iborat bo'lishi kerak!");
    }
    let uid = null;
    if (th) {
      try {
        const v = await sb("/auth/v1/verify",
          { method: "POST", body: JSON.stringify({ token_hash: th, type: "recovery" }) }, true);
        uid = v && v.user && v.user.id;
      } catch (e) { /* keyingi usul */ }
    }
    if (!uid && at) {
      try {
        const u = await sb("/auth/v1/user", {
          method: "GET",
          headers: { apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + at },
        });
        uid = u && u.id;
      } catch (e) { /* tugadi */ }
    }
    if (!uid) return res.status(400).send("Havola eskirgan yoki noto'g'ri. Qaytadan so'rang.");
    await sb("/auth/v1/admin/users/" + uid, { method: "PUT", body: JSON.stringify({ password: newPassword }) });
    await sb("/rest/v1/web_sessions?user_id=eq." + uid, { method: "DELETE" });
    return res.status(200).send("Parol o'zgartirildi. Yangi parol bilan kiring.");
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
  if (a === "recoverySend") return recoverySend(req, res);
  if (a === "recoveryVerify") return recoveryVerify(req, res);
  if (a === "recoveryLink") return recoveryLink(req, res);
  return res.status(404).send("Not found.");
};
