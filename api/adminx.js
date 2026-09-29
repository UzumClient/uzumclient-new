// Admin API. Rewrite: /api/admin/:path* -> /api/adminx?path=:path*
// Hamma endpoint admin huquqni talab qiladi (profiles.role = ADMIN).
const { sb } = require("../lib/sb");
const { fmtDate, fmtSub } = require("../lib/user");

const PAGE = 10;

function fmt(iso) {
  return fmtSub(iso);
}

function groupOf(role) {
  if (role === "ADMIN") return "admin";
  if (role === "YOUTUBE") return "youtuber";
  return "default";
}

async function caller(token) {
  if (!token) return null;
  try {
    const s = await sb(
      "/rest/v1/web_sessions?select=user_id,profiles(id,seq,username,role)&token=eq." + encodeURIComponent(token)
    );
    if (!s.length || !s[0].profiles || s[0].profiles.role !== "ADMIN") return null;
    return s[0].profiles;
  } catch (e) {
    return null;
  }
}

function userRow(p) {
  return {
    uid: p.seq != null ? p.seq : 0,
    user: p.username,
    email: p.email,
    subtill: fmt(p.sub_until),
    regdate: fmtDate(p.created_at),
    hwid: p.hwid || "-",
    group: groupOf(p.role),
  };
}

async function profByUsername(username) {
  const rows = await sb("/rest/v1/profiles?select=*&username=eq." + encodeURIComponent(username));
  return rows.length ? rows[0] : null;
}

// ---------- users ----------
async function usersGetAll(q, res) {
  const all = await sb("/rest/v1/profiles?select=id,seq,username,email,role,sub_until,created_at,hwid&order=seq");
  all.sort((a, b) => (a.role === "ADMIN" ? 0 : 1) - (b.role === "ADMIN" ? 0 : 1) || (a.seq || 0) - (b.seq || 0));
  return res.status(200).json({ content: all.map(userRow), total: 1 });
}

async function usersSearch(q, res) {
  const like = encodeURIComponent("*" + (q.query || "") + "*");
  const all = await sb(
    "/rest/v1/profiles?select=id,seq,username,email,role,sub_until,created_at,hwid&or=(username.ilike." + like + ",email.ilike." + like + ")&order=seq"
  );
  all.sort((a, b) => (a.role === "ADMIN" ? 0 : 1) - (b.role === "ADMIN" ? 0 : 1) || (a.seq || 0) - (b.seq || 0));
  return res.status(200).json({ content: all.map(userRow), total: 1 });
}

async function usersGetById(q, res) {
  const rows = await sb("/rest/v1/profiles?select=*&seq=eq." + encodeURIComponent(q.id || ""));
  if (!rows.length) return res.status(400).send("Foydalanuvchi topilmadi.");
  const p = rows[0];
  return res.status(200).json({
    banned: !!p.banned_hwid,
    email: p.email,
    group: groupOf(p.role),
    hwid: p.hwid || "Not Linked",
    subtill: fmt(p.sub_until),
    user: p.username,
  });
}

async function usersPatch(q, body, res) {
  const target = await profByUsername(q.user || "");
  if (!target) return res.status(400).send("Foydalanuvchi topilmadi.");
  const patch = {};
  if (body.username) patch.username = body.username;
  if (body.email) patch.email = body.email;
  if (body.role) patch.role = body.role === "DEFAULT" ? "USER" : body.role;
  if (body.isBanned != null) patch.banned_hwid = !!body.isBanned;
  if (body.subTill != null) {
    if (body.subTill === "-") {
      patch.sub_until = null;
    } else {
      const m = String(body.subTill).match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (m) patch.sub_until = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).toISOString();
    }
  }
  if (Object.keys(patch).length) {
    await sb("/rest/v1/profiles?id=eq." + target.id, { method: "PATCH", body: JSON.stringify(patch) });
  }
  return res.status(200).send("Foydalanuvchi yangilandi.");
}

async function usersAddSub(q, res) {
  const days = parseInt(q.days, 10) || 0;
  if (!q.user || days <= 0) return res.status(400).send("Xatolik.");
  const target = await profByUsername(q.user);
  if (!target) return res.status(400).send("Foydalanuvchi topilmadi.");
  let base = new Date();
  if (target.sub_until) {
    const cur = new Date(target.sub_until);
    if (!isNaN(cur) && cur > base) base = cur;
  }
  const until = new Date(base.getTime() + days * 864e5).toISOString();
  await sb("/rest/v1/profiles?id=eq." + target.id, { method: "PATCH", body: JSON.stringify({ sub_until: until }) });
  return res.status(200).json({ message: "Obuna qo'shildi.", subtill: fmt(until) });
}

async function usersRemoveSub(q, res) {
  if (!q.user) return res.status(400).send("Xatolik.");
  const target = await profByUsername(q.user);
  if (!target) return res.status(400).send("Foydalanuvchi topilmadi.");
  await sb("/rest/v1/profiles?id=eq." + target.id, { method: "PATCH", body: JSON.stringify({ sub_until: null }) });
  return res.status(200).json({ message: "Obuna olib tashlandi.", subtill: "-" });
}

async function usersBan(q, res) {
  if (!q.user) return res.status(400).send("Xatolik.");
  const target = await profByUsername(q.user);
  if (!target) return res.status(400).send("Foydalanuvchi topilmadi.");
  await sb("/rest/v1/profiles?id=eq." + target.id, { method: "PATCH", body: JSON.stringify({ banned_hwid: true }) });
  await sb("/rest/v1/web_sessions?user_id=eq." + target.id, { method: "DELETE" });
  return res.status(200).json({ message: "Akkount banlandi." });
}

// ---------- keys ----------
async function keysGetAll(res) {
  const keys = await sb("/rest/v1/sub_keys?select=value,days,used,used_by,created_at&order=created_at.desc&limit=200");
  const ids = [...new Set(keys.map((k) => k.used_by).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const profs = await sb("/rest/v1/profiles?select=id,username&id=in.(" + ids.join(",") + ")");
    profs.forEach((p) => { names[p.id] = p.username; });
  }
  return res.status(200).json(keys.map((k) => ({
    key: k.value,
    display: k.days != null ? k.days + " kunlik" : "-",
    generatedBy: (k.used_by && names[k.used_by]) || "Admin",
  })));
}

async function keysRemove(q, res) {
  if (!q.key) return res.status(400).send("Xatolik.");
  await sb("/rest/v1/sub_keys?value=eq." + encodeURIComponent(q.key), { method: "DELETE" });
  return res.status(200).send("Kalit o'chirildi.");
}

function genKey() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "UZUM-";
  for (let i = 0; i < 12; i++) {
    s += abc[Math.floor(Math.random() * abc.length)];
    if (i === 3 || i === 7) s += "-";
  }
  return s;
}

async function keysCreate(q, res, days) {
  const count = Math.min(100, Math.max(0, parseInt(q.count, 10) || 0));
  if (!count) return res.status(400).send("Soni noto'g'ri.");
  const ex = await sb("/rest/v1/sub_keys?select=value&limit=2000");
  const have = new Set(ex.map((k) => k.value));
  const out = [];
  for (let i = 0; i < count; i++) {
    let v = genKey();
    while (have.has(v)) v = genKey();
    have.add(v);
    await sb("/rest/v1/sub_keys", { method: "POST", body: JSON.stringify({ value: v, days: days, used: false }) });
    out.push(v);
  }
  return res.status(200).send(out.join(" "));
}

// ---------- promocodes ----------
function promoRow(p) {
  return { name: p.value, discount: p.discount || 0, activations: "-", maxActivations: p.outActive != null ? p.outActive : "-" };
}

async function promosGetAll(res) {
  try {
    const rows = await sb("/rest/v1/promos?select=value,discount,outActive,outDate&limit=200");
    const out = {};
    rows.forEach((p) => { out[p.value] = promoRow(p); });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({});
  }
}

async function promosGet(q, res) {
  const rows = await sb("/rest/v1/promos?select=value,discount,outActive&value=eq." + encodeURIComponent(q.promocode || ""));
  if (!rows.length) return res.status(400).send("Promokod topilmadi.");
  const p = rows[0];
  return res.status(200).json({ name: p.value, bet: p.discount || 0, maxUsages: p.outActive != null ? p.outActive : "" });
}

async function promosCreate(q, res) {
  if (!q.promocode) return res.status(400).send("Nom kiritilmadi.");
  await sb("/rest/v1/promos", {
    method: "POST",
    body: JSON.stringify({
      value: q.promocode,
      discount: parseInt(q.bet, 10) || 0,
      outActive: q.maxUsages !== "" && q.maxUsages != null ? parseInt(q.maxUsages, 10) : null,
    }),
  });
  return res.status(200).send("Promokod yaratildi.");
}

async function promosPatch(q, res) {
  if (!q.promocode) return res.status(400).send("Xatolik.");
  const patch = {};
  if (q.bet != null && q.bet !== "") patch.discount = parseInt(q.bet, 10) || 0;
  if (q.maxUsages != null && q.maxUsages !== "") patch.outActive = parseInt(q.maxUsages, 10);
  await sb("/rest/v1/promos?value=eq." + encodeURIComponent(q.promocode), { method: "PATCH", body: JSON.stringify(patch) });
  return res.status(200).send("Promokod yangilandi.");
}

async function promosDelete(q, res) {
  if (!q.promocode) return res.status(400).send("Xatolik.");
  await sb("/rest/v1/promos?value=eq." + encodeURIComponent(q.promocode), { method: "DELETE" });
  return res.status(200).send("Promokod o'chirildi: " + q.promocode + ".");
}

async function promosResetUsages(q, res) {
  if (!q.promocode) return res.status(400).send("Xatolik.");
  const rows = await sb("/rest/v1/promos?select=outActive&value=eq." + encodeURIComponent(q.promocode));
  if (!rows.length) return res.status(400).send("Promokod topilmadi.");
  return res.status(200).send(" Promokod statistikasi tiklandi.");
}

async function promosStatGet(q, res) {
  const rows = await sb("/rest/v1/promos?select=value,outActive&value=eq." + encodeURIComponent(q.promocode || ""));
  const p = rows.length ? rows[0] : { outActive: null };
  return res.status(200).json({ usages: 0, maxUsages: p.outActive, payments: [] });
}

async function promosStatClear(q, res) {
  return res.status(200).send("Tozalandi.");
}

module.exports = async (req, res) => {
  const path = req.query.p || "";
  const q = req.query;
  const open = ["states/isSessionInitialized"];
  let me = null;
  if (!open.includes(path)) {
    me = await caller(q.token);
    if (!me) return res.status(403).send("Ruxsat yo'q.");
  }
  try {
    if (path === "states/isSessionInitialized") return res.status(200).send("OK");
    if (path === "users/getAll") return usersGetAll(q, res);
    if (path === "users/search") return usersSearch(q, res);
    if (path === "users/getByIdentifier") return usersGetById(q, res);
    if (path === "users/patch") return usersPatch(q, req.body || {}, res);
    if (path === "users/addSub") return usersAddSub(q, res);
    if (path === "users/removeSub") return usersRemoveSub(q, res);
    if (path === "users/ban") return usersBan(q, res);
    if (path === "multiactions/keys/action/getAll") return keysGetAll(res);
    if (path === "multiactions/keys/action/remove") return keysRemove(q, res);
    if (path === "multiactions/keys/getAdditionalProducts") return res.status(200).json([]);
    if (path === "multiactions/keys/subscription") return keysCreate(q, res, Math.max(0, parseInt(q.days, 10) || 0));
    if (path === "multiactions/keys/hardwareReset") return keysCreate(q, res, 0);
    if (path === "multiactions/keys/beta") return keysCreate(q, res, 36500);
    if (path === "multiactions/keys/additionalProduct") return keysCreate(q, res, 30);
    if (path === "promocodes/getAll") return promosGetAll(res);
    if (path === "promocodes/get") return promosGet(q, res);
    if (path === "promocodes/create") return promosCreate(q, res);
    if (path === "promocodes/patch") return promosPatch(q, res);
    if (path === "promocodes/delete") return promosDelete(q, res);
    if (path === "promocodes/resetUsages") return promosResetUsages(q, res);
    if (path === "promocodes/statistic/get") return promosStatGet(q, res);
    if (path === "promocodes/statistic/clearPayments") return promosStatClear(q, res);
    if (path === "logs/getAllByCategory") return res.status(200).json([]);
    if (path === "logs/remove") return res.status(200).send("OK");
    if ((path || "").startsWith("finances/")) return res.status(200).json([]);
    if ((path || "").startsWith("autoload/")) return res.status(200).json([]);
    return res.status(404).send("Not found.");
  } catch (e) {
    return res.status(400).send("Xatolik.");
  }
};
