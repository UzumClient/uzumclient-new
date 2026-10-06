// Shared shop data: single source of truth for tariffs.
// type: 1=lifetime, 2=90 days, 3=30 days, 4=HWID reset (no time field!)
const TARIFFS = [
  { type: 1, price: 160000, time: 999, plan: "lifetime", days: 36500 },
  { type: 2, price: 100000, time: 90, plan: "90d", days: 90 },
  { type: 3, price: 40000, time: 30, plan: "30d", days: 30 },
  { type: 4, price: 20000, plan: "hwid", days: 0 },
];

function tariffByType(t) {
  t = parseInt(t, 10);
  return TARIFFS.find((x) => x.type === t) || null;
}

module.exports = { TARIFFS, tariffByType };
