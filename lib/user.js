// Catlavan-uslub user JSON mapper
function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d) || d <= new Date()) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function roleMap(r) {
  if (!r) return "DEFAULT";
  if (r === "USER") return "DEFAULT";
  return r;
}

// profile: {id, seq, username, email, role, sub_until, hwid, banned_hwid, created_at}
function userJson(profile, token) {
  return {
    id: profile.seq != null ? profile.seq : 0,
    username: profile.username,
    email: profile.email,
    isEmailVerified: false,
    role: roleMap(profile.role),
    prefix: "null",
    banned: !!profile.banned_hwid,
    token: token,
    hwid: profile.hwid || "Not Linked",
    subtill: fmtDate(profile.sub_until),
    regdate: fmtDate(profile.created_at),
    authMessage: "",
    authStatus: true,
  };
}

module.exports = { fmtDate, roleMap, userJson };
