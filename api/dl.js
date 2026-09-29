// GET /api/resources/downloadLauncher?token= — mod jar yuklash.
// Sessiya + faol obuna (yoki ADMIN) tekshiriladi, keyin Storage'ga
// foydalanuvchi emaili bilan redirect qilinadi (jar binding uchun).
const { sb } = require("../lib/sb");

const SB = process.env.SUPABASE_URL || "https://zuezpltfsjhoqqkcthmh.supabase.co";

module.exports = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Avval kiring.");
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(400).send("Sessiya muddati tugagan.");
    const p = await sb("/rest/v1/profiles?select=email,role,sub_until&id=eq." + s[0].user_id);
    if (!p.length) return res.status(400).send("Foydalanuvchi topilmadi.");
    const u = p[0];
    const active = u.role === "ADMIN" || (u.sub_until && new Date(u.sub_until) > new Date());
    if (!active) return res.status(400).send("Faol obuna yo'q. Obuna sotib oling.");
    const url =
      SB + "/storage/v1/object/public/mods/UzumClient-1.0.0.jar?download=" +
      encodeURIComponent("UzumClient-" + u.email + ".jar");
    res.writeHead(302, { Location: url });
    return res.end();
  } catch (e) {
    return res.status(400).send("Xatolik.");
  }
};
