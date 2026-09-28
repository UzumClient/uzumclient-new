// Consolidated user-actions handler:
//   /api/users/actions/:a  ->  /api/key?a=:a   (a = activateDigitalKey)
const { sb } = require("../lib/sb");

async function activateDigitalKey(req, res) {
  try {
    const { token, key } = req.query;
    if (!token || !key) return res.status(400).send("The entered key is invalid.");
    const s = await sb("/rest/v1/web_sessions?select=user_id&token=eq." + encodeURIComponent(token));
    if (!s.length) return res.status(400).send("The entered key is invalid.");
    const uid = s[0].user_id;
    const keys = await sb("/rest/v1/sub_keys?select=id,days,used&value=eq." + encodeURIComponent(key));
    if (!keys.length || keys[0].used) return res.status(400).send("The entered key is invalid or already used.");
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
    return res.status(200).send("Key activated: +" + k.days + " days.");
  } catch (e) {
    return res.status(400).send("The entered key is invalid.");
  }
}

module.exports = async (req, res) => {
  if (req.query.a === "activateDigitalKey") return activateDigitalKey(req, res);
  return res.status(404).send("Not found.");
};
