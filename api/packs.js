// ResursPack API: /api/packs/:a -> /api/packs?a=:a
// presign/create/delete — admin; list — login bo'lgan user.
const { sb } = require("../lib/sb");

const SB = process.env.SUPABASE_URL || "https://zuezpltfsjhoqqkcthmh.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function me(token, adminOnly) {
  if (!token) return null;
  try {
    const s = await sb(
      "/rest/v1/web_sessions?select=user_id,profiles(id,username,email,role)&token=eq." + encodeURIComponent(token)
    );
    if (!s.length || !s[0].profiles) return null;
    if (adminOnly && s[0].profiles.role !== "ADMIN") return null;
    return s[0].profiles;
  } catch (e) {
    return null;
  }
}

function pub(path) {
  return SB + "/storage/v1/object/public/packs/" + path;
}

// POST /api/packs/presign?token=&names=a.png,b.zip  -> {urls:{name: putUrl}}
async function presign(req, res) {
  const u = await me(req.query.token, true);
  if (!u) return res.status(403).send("Ruxsat yo'q.");
  const names = String(req.query.names || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (!names.length) return res.status(400).send("Fayl nomi yo'q.");
  const out = {};
  const stamp = Date.now().toString(36);
  for (const n of names) {
    const safe = n.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);
    const path = stamp + "-" + Math.floor(Math.random() * 1e6) + "-" + safe;
    const r = await fetch(SB + "/storage/v1/object/upload/sign/packs/" + path, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const b = await r.json();
    if (!r.ok || !b.url) throw new Error("presign");
    out[n] = { put: SB + b.url, path };
  }
  return res.status(200).json({ urls: out });
}

// POST /api/packs/create?token=&name=&images=p1,p2&file=p.zip
async function create(req, res) {
  const u = await me(req.query.token, true);
  if (!u) return res.status(403).send("Ruxsat yo'q.");
  const name = String(req.query.name || "").slice(0, 80);
  const images = String(req.query.images || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const file = String(req.query.file || "");
  if (!name || !images.length || !file) return res.status(400).send("Ma'lumot to'liq emas.");
  await sb("/rest/v1/packs", {
    method: "POST",
    body: JSON.stringify({ name, images, file_path: file }),
  });
  return res.status(200).send("Qo'shildi.");
}

// GET /api/packs/list?token=
async function list(req, res) {
  const u = await me(req.query.token, false);
  if (!u) return res.status(400).send("Avval kiring.");
  const rows = await sb("/rest/v1/packs?select=id,name,images,file_path,created_at&order=created_at.desc&limit=100");
  return res.status(200).json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      images: (p.images || []).map(pub),
      file: pub(p.file_path) + "?download=" + encodeURIComponent(p.name + ".zip"),
    }))
  );
}

// POST /api/packs/remove?token=&id=
async function remove(req, res) {
  const u = await me(req.query.token, true);
  if (!u) return res.status(403).send("Ruxsat yo'q.");
  const rows = await sb("/rest/v1/packs?select=images,file_path&id=eq." + encodeURIComponent(req.query.id || ""));
  if (!rows.length) return res.status(400).send("Topilmadi.");
  const files = [...(rows[0].images || []), rows[0].file_path].filter(Boolean);
  for (const f of files) {
    try {
      await fetch(SB + "/storage/v1/object/packs/" + f, {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      });
    } catch (e) { /* e'tibor bermaymiz */ }
  }
  await sb("/rest/v1/packs?id=eq." + encodeURIComponent(req.query.id || ""), { method: "DELETE" });
  return res.status(200).send("O'chirildi.");
}

module.exports = async (req, res) => {
  const a = req.query.a;
  try {
    if (a === "presign") return presign(req, res);
    if (a === "create") return create(req, res);
    if (a === "list") return list(req, res);
    if (a === "remove") return remove(req, res);
    return res.status(404).send("Not found.");
  } catch (e) {
    return res.status(400).send("Xatolik.");
  }
};
