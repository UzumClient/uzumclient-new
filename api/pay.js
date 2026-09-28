// Consolidated payments handler. Routed via vercel.json rewrites:
//   /api/payments/:a                 -> /api/pay?a=:a
//   /api/payments/additional/:a       -> /api/pay?r=additional&a=:a
//   /api/payments/frontend/:a         -> /api/pay?r=frontend&a=:a
//   /api/payments/promocodes/:a       -> /api/pay?r=promocodes&a=:a
const { sb } = require("../lib/sb");
const { TARIFFS, tariffByType } = require("../lib/shop");

const METHODS = [
  { displayName: "Click", enumName: "CLICK" },
  { displayName: "Payme", enumName: "PAYME" },
  { displayName: "Uzum Bank", enumName: "UZUM" },
];

async function getAll(req, res) {
  return res.status(200).json(
    TARIFFS.map((t) => {
      const o = { type: t.type, price: t.price };
      if (t.time != null) o.time = t.time;
      return o;
    })
  );
}

async function getMethods(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(200).json(METHODS);
    const rows = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!rows.length) return res.status(400).send("Sessiya muddati tugagan.");
    return res.status(200).json(METHODS);
  } catch (e) {
    return res.status(400).send("Xatolik.");
  }
}

async function subsGetAdditional(req, res) {
  return res.status(200).json([]);
}

async function additionalGetAll(req, res) {
  return res.status(200).json([]);
}

async function sessionUser(token) {
  const rows = await sb(
    "/rest/v1/web_sessions?select=user_id,profiles(id,email,username)&token=eq." + encodeURIComponent(token)
  );
  if (!rows.length || !rows[0].profiles) return null;
  return rows[0].profiles;
}

async function frontendCreate(req, res) {
  try {
    const { token, id, paymentType, promoCode, inputBoxEmail } = req.query;
    if (!token) return res.status(400).send("Sessiya muddati tugagan.");
    const u = await sessionUser(token);
    if (!u) return res.status(400).send("Sessiya muddati tugagan.");
    const t = tariffByType(id);
    if (!t) return res.status(400).send("Noma'lum mahsulot.");
    let price = t.price;
    let promoTxt = "";
    if (promoCode) {
      const pr = await sb("/rest/v1/promos?select=value,discount,outActive,outDate&value=eq." + encodeURIComponent(promoCode));
      if (pr.length && (pr[0].outActive == null || pr[0].outActive > 0)) {
        const pct = pr[0].discount || 0;
        price = Math.round((price * (100 - pct)) / 100);
        promoTxt = " Promo: " + promoCode + " (-" + pct + "%)";
      }
    }
    await sb("/rest/v1/payments", {
      method: "POST",
      body: JSON.stringify({ user_id: u.id, plan: t.plan, amount: price, check_path: "catlavan-pending" }),
    });
    const msg = "Assalomu alaykum! UZUM CLIENT sotib olmoqchiman." + " Tarif: " + t.plan + " (" + price + ")." + promoTxt + " Email: " + u.email;
    return res.status(200).send("https://t.me/UZUMCLIENTSUPPORT?text=" + encodeURIComponent(msg));
  } catch (e) {
    return res.status(400).send("To'lov yaratishda xatolik.");
  }
}

async function promoApply(req, res) {
  try {
    const { token, code } = req.query;
    if (!token || !code) return res.status(404).send("PROMO_CODE_NOT_FOUND");
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(404).send("PROMO_CODE_NOT_FOUND");
    const pr = await sb("/rest/v1/promos?select=value,discount,outActive,outDate&value=eq." + encodeURIComponent(code));
    if (!pr.length) return res.status(404).send("PROMO_CODE_NOT_FOUND");
    const p = pr[0];
    if ((p.outActive != null && p.outActive <= 0) || (p.outDate && new Date(p.outDate) <= new Date())) {
      return res.status(404).send("PROMO_CODE_NOT_FOUND");
    }
    return res.status(200).send("Promokod qo'llanildi: -" + (p.discount || 0) + "%.");
  } catch (e) {
    return res.status(404).send("PROMO_CODE_NOT_FOUND");
  }
}

module.exports = async (req, res) => {
  const r = req.query.r || "";
  const a = req.query.a;
  if (!r && a === "getAll") return getAll(req, res);
  if (!r && a === "getMethods") return getMethods(req, res);
  if (r === "additional" && a === "getAll") return additionalGetAll(req, res);
  if (r === "frontend" && a === "create") return frontendCreate(req, res);
  if (r === "promocodes" && a === "apply") return promoApply(req, res);
  if (r === "subs" && a === "getAdditional") return subsGetAdditional(req, res);
  return res.status(404).send("Not found.");
};
