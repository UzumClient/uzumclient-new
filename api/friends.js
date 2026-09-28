// Consolidated friends handler:
//   /api/friends/:a  ->  /api/friends?a=:a   (getAll|request|add|remove|accept)
module.exports = async (req, res) => {
  const a = req.query.a;
  if (a === "getAll") return res.status(200).json([]);
  if (a === "request" || a === "add" || a === "remove" || a === "accept") return res.status(200).send("OK");
  return res.status(404).send("Not found.");
};
