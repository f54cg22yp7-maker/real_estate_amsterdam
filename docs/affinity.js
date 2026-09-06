/* Affinity 0..100: mirrors pipeline/affinity.py exactly. Keep in sync. */
window.Affinity = (function () {
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const hasOutdoor = (l) => { const o = (l.outdoor || "").toLowerCase(); return !!o && !["none", "no outdoor space", "—"].includes(o); };
  const ownGood = (l) => { const o = (l.ownership || "").toLowerCase(); if (o.startsWith("freehold")) return true; return Object.values(l.leasehold || {}).some((v) => /eeuwig/i.test(String(v))); };
  const labelGood = (l) => /^[AB]/.test((l.energy_label || "").toUpperCase());
  function profile(liked) {
    liked = liked.filter(Boolean); if (!liked.length) return null;
    const pc4 = {}; liked.forEach((l) => { const k = (l.postcode || "").slice(0, 4); if (k) pc4[k] = (pc4[k] || 0) + 1; });
    const n = liked.length;
    return { n, pc4, m2: median(liked.filter((l) => l.m2).map((l) => l.m2)), ppm: median(liked.filter((l) => l.price_per_m2).map((l) => l.price_per_m2)),
      beds: median(liked.filter((l) => l.bedrooms != null).map((l) => l.bedrooms)),
      outdoor: liked.filter(hasOutdoor).length / n, own: liked.filter(ownGood).length / n, label: liked.filter(labelGood).length / n };
  }
  function score(l, p) {
    if (!p) return null; let s = 0;
    const k4 = (l.postcode || "").slice(0, 4); const same = p.pc4[k4] || 0;
    const near = Object.entries(p.pc4).filter(([k]) => k.slice(0, 3) === k4.slice(0, 3)).reduce((a, [, v]) => a + v, 0) - same;
    s += 25 * Math.min(1, (same + near * 0.4) / Math.max(1, p.n * 0.25));
    s += 20 * (ownGood(l) ? 1 : 1 - p.own);
    if (p.m2 && l.m2) s += 15 * Math.max(0, 1 - Math.abs(l.m2 - p.m2) / Math.max(20, p.m2 * 0.35));
    if (p.ppm && l.price_per_m2) s += 10 * Math.max(0, 1 - Math.abs(l.price_per_m2 - p.ppm) / Math.max(500, p.ppm * 0.25));
    s += 15 * (hasOutdoor(l) ? 1 : 1 - p.outdoor);
    s += 10 * (labelGood(l) ? 1 : 1 - p.label);
    if (p.beds != null && l.bedrooms != null) s += 5 * (l.bedrooms >= p.beds ? 1 : 0.5);
    return Math.round(Math.min(100, s));
  }
  return { profile, score, hasOutdoor, ownGood };
})();
