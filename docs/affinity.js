/* Affinity 0..100. Mirrors pipeline/affinity.py exactly; keep the two in sync.
   Two signals: explicit couple preferences (the questionnaire in settings) and a profile learned from likes.
   final = prefs ? (likes >= 5 ? 0.6 * explicit + 0.4 * learned : explicit) : learned */
window.Affinity = (function () {
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const hasOutdoor = (l) => { const o = (l.outdoor || "").toLowerCase(); return !!o && !["none", "no outdoor space", "—"].includes(o); };
  const ownGood = (l) => { const o = (l.ownership || "").toLowerCase(); if (o.startsWith("freehold")) return true; return Object.values(l.leasehold || {}).some((v) => /eeuwig/i.test(String(v))); };
  const labelRank = (l) => { const x = (l.energy_label || "").toUpperCase(); return x.startsWith("A") ? 1 : x.startsWith("B") ? 2 : x.startsWith("C") ? 3 : x ? 4 : 0; };
  const isGround = (l) => /ground|begane|garden|tuin|benedenwoning/i.test(`${l.type || ""} ${l.floor || ""}`);
  const isTop = (l) => /penthouse|top|bovenste/i.test(`${l.type || ""} ${l.floor || ""}`);
  const district = (name) => (name || "").split(/ \(|\//)[0].trim();
  const areaOf = (l) => (window.areaFor && window.areaFor(l.postcode)) || "";

  function profile(liked) {
    liked = liked.filter(Boolean); if (!liked.length) return null;
    const pc4 = {}; liked.forEach((l) => { const k = (l.postcode || "").slice(0, 4); if (k) pc4[k] = (pc4[k] || 0) + 1; });
    const n = liked.length;
    return { n, pc4, m2: median(liked.filter((l) => l.m2).map((l) => l.m2)), ppm: median(liked.filter((l) => l.price_per_m2).map((l) => l.price_per_m2)),
      beds: median(liked.filter((l) => l.bedrooms != null).map((l) => l.bedrooms)),
      outdoor: liked.filter(hasOutdoor).length / n, own: liked.filter(ownGood).length / n, label: liked.filter((l) => labelRank(l) && labelRank(l) <= 2).length / n };
  }
  function learned(l, p) {
    if (!p) return null; let s = 0;
    const k4 = (l.postcode || "").slice(0, 4); const same = p.pc4[k4] || 0;
    const near = Object.entries(p.pc4).filter(([k]) => k.slice(0, 3) === k4.slice(0, 3)).reduce((a, [, v]) => a + v, 0) - same;
    s += 25 * Math.min(1, (same + near * 0.4) / Math.max(1, p.n * 0.25));
    s += 20 * (ownGood(l) ? 1 : 1 - p.own);
    if (p.m2 && l.m2) s += 15 * Math.max(0, 1 - Math.abs(l.m2 - p.m2) / Math.max(20, p.m2 * 0.35));
    if (p.ppm && l.price_per_m2) s += 10 * Math.max(0, 1 - Math.abs(l.price_per_m2 - p.ppm) / Math.max(500, p.ppm * 0.25));
    s += 15 * (hasOutdoor(l) ? 1 : 1 - p.outdoor);
    s += 10 * (labelRank(l) && labelRank(l) <= 2 ? 1 : 1 - p.label);
    if (p.beds != null && l.bedrooms != null) s += 5 * (l.bedrooms >= p.beds ? 1 : 0.5);
    return Math.min(100, s);
  }
  const BASE = { location: 25, price: 15, size: 15, outdoor: 15, ownership: 10, energy: 8, bedrooms: 6, floor: 3, era: 3 };
  function explicit(l, q) {
    if (!q) return null;
    const c = {};
    const area = areaOf(l), areas = q.areas || [];
    c.location = !areas.length ? 0.7 : areas.includes(area) ? 1 : areas.some((a) => district(a) === district(area)) ? 0.55 : 0.2;
    c.price = !q.budget || !l.price ? 0.7 : l.price <= q.budget ? 1 : Math.max(0, 1 - (l.price / q.budget - 1) / 0.15);
    c.size = !q.min_m2 || !l.m2 ? 0.7 : l.m2 >= q.min_m2 ? 1 : Math.max(0, 1 - (q.min_m2 - l.m2) / (0.3 * q.min_m2));
    c.outdoor = q.outdoor === "must" ? (hasOutdoor(l) ? 1 : 0) : q.outdoor === "nice" ? (hasOutdoor(l) ? 1 : 0.5) : 0.8;
    c.ownership = q.ownership === "only" ? (ownGood(l) ? 1 : 0.1) : q.ownership === "prefer" ? (ownGood(l) ? 1 : 0.5) : 0.8;
    const r = labelRank(l);
    c.energy = q.energy === "AB" ? (r && r <= 2 ? 1 : r === 3 ? 0.5 : 0.2) : q.energy === "C" ? (r && r <= 3 ? 1 : 0.4) : 0.8;
    c.bedrooms = !q.min_bedrooms || l.bedrooms == null ? 0.7 : l.bedrooms >= q.min_bedrooms ? 1 : 0.3;
    c.floor = q.floor === "ground" ? (isGround(l) ? 1 : 0.4) : q.floor === "upper" ? (isGround(l) ? 0.4 : 1) : q.floor === "top" ? (isTop(l) ? 1 : 0.6) : 0.8;
    const y = +l.build_year || 0;
    c.era = q.era === "prewar" ? (y && y < 1945 ? 1 : 0.5) : q.era === "modern" ? (y >= 1990 ? 1 : 0.5) : 0.8;
    const w = { ...BASE }; const boost = [1.6, 1.35, 1.15];
    (q.priorities || []).slice(0, 3).forEach((k, i) => { if (w[k] != null) w[k] *= boost[i]; });
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    let s = Object.keys(w).reduce((a, k) => a + w[k] * c[k], 0) / tot * 100;
    if (q.max_vve && l.vve_monthly && l.vve_monthly > q.max_vve) s *= 0.85;
    return s;
  }
  function hasPrefs(q) { return !!q && Object.keys(q).some((k) => q[k] != null && q[k] !== "" && q[k] !== "any" && !(Array.isArray(q[k]) && !q[k].length)); }
  function score(l, p, q) {
    const e = hasPrefs(q) ? explicit(l, q) : null; const g = learned(l, p);
    if (e == null && g == null) return null;
    if (e == null) return Math.round(g);
    if (g == null || !p || p.n < 5) return Math.round(e);
    return Math.round(0.6 * e + 0.4 * g);
  }
  return { profile, score, explicit, learned, hasOutdoor, ownGood, hasPrefs };
})();
