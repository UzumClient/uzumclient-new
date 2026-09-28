// Supabase helper (service_role — faqat serverda!)
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, opts = {}, anon = false) {
  const key = anon ? ANON_KEY : SB_KEY;
  const r = await fetch(SB_URL + path, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const t = await r.text();
  let b;
  try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  if (!r.ok) {
    const e = new Error((b && (b.msg || b.message)) || ("Supabase " + r.status));
    e.status = r.status;
    e.body = b;
    throw e;
  }
  return b;
}

module.exports = { sb, SB_URL };
