/* Amsterdam Swipe: two people, one deck, independent votes, match on mutual like. */
(function () {
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const $ = (s) => document.querySelector(s);
  const state = { listings: [], votes: [], me: localStorage.getItem("who") || CFG.people[0].id, view: "swipe", lastVote: null, bigmap: null, minimaps: {} };
  const other = () => CFG.people.find((p) => p.id !== state.me).id;
  const nameOf = (id) => (CFG.people.find((p) => p.id === id) || {}).name || id;
  const eur = (n) => (n == null ? "" : "€ " + Math.round(n).toLocaleString("nl-NL"));
  const HIDDEN = new Set(["sold", "withdrawn", "rented", "sold subject to conditions"]);

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 1800); }
  function voteOf(listingId, who) { return state.votes.find((v) => v.listing_id === listingId && v.who === who); }
  function isMatch(l) { return CFG.people.every((p) => (voteOf(l.id, p.id) || {}).vote === "yes"); }
  function queue() {
    return state.listings.filter((l) => !HIDDEN.has(l.status) && !voteOf(l.id, state.me));
  }
  function statusBadge(l) {
    if (!l.status || l.status === "available") return `<div class="badge">Available</div>`;
    const cls = HIDDEN.has(l.status) ? "bad" : "warn";
    return `<div class="badge ${cls}">${l.status[0].toUpperCase() + l.status.slice(1)}</div>`;
  }
  function ownershipText(l) {
    if (!l.ownership) return ["Unknown", ""];
    if (l.ownership.startsWith("freehold")) return ["Freehold", "good"];
    const until = l.leasehold && (l.leasehold["Kadastrale gegevens / Afgekocht tot"] || l.leasehold["Afgekocht tot"]);
    if (until) {
      const u = String(until);
      if (/eeuwig/i.test(u)) return ["Leasehold, bought off forever", "good"];
      const y = (u.match(/(\d{4})/) || [])[1];
      return [`Leasehold, paid until ${y || u}`, y && +y < 2040 ? "warn" : ""];
    }
    return ["Leasehold (erfpacht)", "warn"];
  }

  function cardHtml(l) {
    const [own, ownCls] = ownershipText(l);
    const chips = [
      l.m2 && `${l.m2} m²`, l.rooms && `${l.rooms} rooms`, l.bedrooms != null && `${l.bedrooms} bed`,
      l.floor && l.floor.replace("floor", "fl."), l.build_year && `Built ${l.build_year}`,
    ].filter(Boolean).map((c) => `<span class="chip">${c}</span>`).join("");
    const label = l.energy_label ? `<span class="chip label-${l.energy_label}">Label ${l.energy_label}</span>` : "";
    return `
      <div class="photo" style="background-image:url('${l.photo || ""}')">
        ${statusBadge(l)}
        <div class="stamp yes">LIKE</div><div class="stamp no">NOPE</div>
        <div class="grad"></div>
        <div class="headline">
          <div class="price">${eur(l.price)}<small>${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""}</small></div>
          <div class="addr">${l.street || l.address || ""}</div>
          <div class="area">${window.areaFor(l.postcode)} · ${l.postcode ? l.postcode.slice(0, 4) + " " + l.postcode.slice(4) : ""}</div>
        </div>
      </div>
      <div class="body">
        <div class="chips">${chips}${label}</div>
        <div class="kv">
          <div><span>Ownership</span><b class="${ownCls}">${own}</b></div>
          <div><span>VvE / month</span><b>${l.vve_monthly != null ? eur(l.vve_monthly) : "—"}</b></div>
          <div><span>Outdoor</span><b>${l.outdoor || "—"}</b></div>
          <div><span>Type</span><b>${l.type || "—"}</b></div>
          <div><span>Listed</span><b>${l.listed_since || (l.first_seen || "").slice(0, 10)}</b></div>
          <div><span>Status</span><b>${l.status || "available"}</b></div>
        </div>
        <div class="summary">${l.summary || (l.description_en || "").slice(0, 220) || ""}</div>
        <div class="minimap" id="mm-${l.id}"></div>
        <div class="links">
          <a href="${l.url}" target="_blank" rel="noopener">Full listing</a>
          <a href="https://maps.apple.com/?q=${encodeURIComponent(l.address || "")}&ll=${l.lat},${l.lng}" target="_blank" rel="noopener">Open in Maps</a>
        </div>
      </div>`;
  }

  function mountMinimap(l) {
    if (!l.lat || !l.lng || !window.L) return;
    const el = document.getElementById(`mm-${l.id}`);
    if (!el || el._map) return;
    const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#ff4d6d", fillOpacity: 1 }).addTo(m);
    m.setView([l.lat, l.lng], 14);
    el._map = m;
    setTimeout(() => m.invalidateSize(), 50);
  }

  function renderDeck() {
    const deck = $("#deck");
    const q = queue();
    $("#count").textContent = q.length ? `${q.length} to review` : "";
    deck.innerHTML = "";
    if (!q.length) {
      deck.innerHTML = `<div class="empty"><h2>All caught up</h2><div>New listings arrive every few hours. Check Likes and Matches meanwhile.</div></div>`;
      $("#actions").style.visibility = "hidden";
      return;
    }
    $("#actions").style.visibility = "visible";
    q.slice(0, 2).reverse().forEach((l, i, arr) => {
      const c = document.createElement("div");
      c.className = "card" + (i < arr.length - 1 ? " behind" : "");
      c.dataset.id = l.id;
      c.innerHTML = cardHtml(l);
      deck.appendChild(c);
      if (i === arr.length - 1) { attachDrag(c, l); mountMinimap(l); }
    });
  }

  function attachDrag(card, l) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, decided = null;
    const yes = card.querySelector(".stamp.yes"), no = card.querySelector(".stamp.no");
    const onDown = (e) => { const p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; dx = dy = 0; dragging = true; decided = null; card.style.transition = "none"; };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e; dx = p.clientX - sx; dy = p.clientY - sy;
      if (decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) decided = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (decided !== "h") return;
      if (e.cancelable) e.preventDefault();
      card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = Math.min(1, Math.max(0, dx / 90)); no.style.opacity = Math.min(1, Math.max(0, -dx / 90));
    };
    const onUp = () => {
      if (!dragging) return; dragging = false;
      if (decided === "h" && Math.abs(dx) > 100) return fly(card, dx > 0 ? "yes" : "no", l);
      card.style.transition = "transform .25s"; card.style.transform = ""; yes.style.opacity = no.style.opacity = 0;
    };
    card.addEventListener("touchstart", onDown, { passive: true });
    card.addEventListener("touchmove", onMove, { passive: false });
    card.addEventListener("touchend", onUp);
    card.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function fly(card, vote, l) {
    card.style.transition = "transform .35s ease-in";
    card.style.transform = `translate(${vote === "yes" ? 600 : -600}px, -40px) rotate(${vote === "yes" ? 30 : -30}deg)`;
    setTimeout(() => castVote(l, vote), 250);
  }

  async function castVote(l, vote) {
    const row = { listing_id: l.id, who: state.me, vote, at: new Date().toISOString() };
    const prev = state.votes.findIndex((v) => v.listing_id === l.id && v.who === state.me);
    if (prev >= 0) state.votes[prev] = row; else state.votes.push(row);
    state.lastVote = { listing: l, vote };
    renderAll();
    const { error } = await sb.from("votes").upsert(row, { onConflict: "listing_id,who" });
    if (error) { toast("Could not save, retrying"); console.error(error); setTimeout(() => sb.from("votes").upsert(row, { onConflict: "listing_id,who" }), 2000); }
    else if (vote === "yes" && isMatch(l)) toast(`Match with ${nameOf(other())}!`);
  }

  async function undo() {
    if (!state.lastVote) return toast("Nothing to undo");
    const { listing } = state.lastVote;
    state.votes = state.votes.filter((v) => !(v.listing_id === listing.id && v.who === state.me));
    state.lastVote = null;
    renderAll();
    const { error } = await sb.from("votes").delete().match({ listing_id: listing.id, who: state.me });
    if (error) toast("Undo failed");
  }

  function rowHtml(l, note, cls) {
    return `<a class="row" href="${l.url}" target="_blank" rel="noopener">
      <div class="thumb" style="background-image:url('${l.photo || ""}')"></div>
      <div class="info"><div class="t1"><span>${l.street || ""}</span><span>${eur(l.price)}</span></div>
      <div class="t2">${window.areaFor(l.postcode)} · ${l.m2 || "?"} m² · ${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""} · ${ownershipText(l)[0]}</div>
      <div class="t3 ${cls}">${note}</div></div></a>`;
  }
  function renderLists() {
    const mine = state.listings.filter((l) => (voteOf(l.id, state.me) || {}).vote === "yes");
    const matches = state.listings.filter(isMatch);
    $("#n-likes").textContent = mine.length || ""; $("#n-matches").textContent = matches.length || "";
    $("#likes").innerHTML = mine.map((l) => {
      const th = voteOf(l.id, other());
      if (!th) return rowHtml(l, `Waiting for ${nameOf(other())}`, "wait");
      return th.vote === "yes" ? rowHtml(l, "♥ Match", "match") : rowHtml(l, `${nameOf(other())} passed`, "passed");
    }).join("") || `<div class="empty"><h2>No likes yet</h2><div>Swipe right on what you would view.</div></div>`;
    $("#matches").innerHTML = matches.map((l) => rowHtml(l, `Both liked · ${l.status || "available"}`, "match")).join("")
      || `<div class="empty"><h2>No matches yet</h2><div>A match appears when you both like the same place.</div></div>`;
  }

  function renderBigMap() {
    if (!window.L) return;
    if (!state.bigmap) {
      state.bigmap = L.map("bigmap", { zoomControl: false }).setView([52.3676, 4.9041], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.bigmap);
      state.bigmap._layer = L.layerGroup().addTo(state.bigmap);
    }
    const g = state.bigmap._layer; g.clearLayers();
    state.listings.filter((l) => l.lat && l.lng && !HIDDEN.has(l.status)).forEach((l) => {
      const me = (voteOf(l.id, state.me) || {}).vote, th = (voteOf(l.id, other()) || {}).vote;
      let color = "#6b7280";
      if (me === "yes" && th === "yes") color = "#ffb020"; else if (me === "yes") color = "#ff4d6d"; else if (th === "yes") color = "#4f8cff"; else if (me === "no") return;
      L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: .95 })
        .bindPopup(`<b>${l.street}</b><br>${eur(l.price)} · ${l.m2} m²<br><a href="${l.url}" target="_blank">Open listing</a>`).addTo(g);
    });
    setTimeout(() => state.bigmap.invalidateSize(), 50);
  }

  function renderWho() {
    $("#who").innerHTML = CFG.people.map((p) => `<button data-who="${p.id}" class="${p.id === state.me ? "active" : ""}">${p.name}</button>`).join("");
  }
  function renderAll() { renderWho(); renderDeck(); renderLists(); if (state.view === "map") renderBigMap(); }

  async function load() {
    const [{ data: ls, error: e1 }, { data: vs, error: e2 }] = await Promise.all([
      sb.from("listings").select("*").order("first_seen", { ascending: false }),
      sb.from("votes").select("*"),
    ]);
    if (e1 || e2) { toast("Cannot reach database"); console.error(e1 || e2); return; }
    state.listings = ls || []; state.votes = vs || [];
    renderAll();
  }

  document.body.addEventListener("click", (e) => {
    const w = e.target.closest("[data-who]"); if (w) { state.me = w.dataset.who; localStorage.setItem("who", state.me); state.lastVote = null; renderAll(); return; }
    const t = e.target.closest("[data-view]"); if (t) {
      state.view = t.dataset.view;
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === t));
      document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + state.view));
      if (state.view === "map") renderBigMap(); if (state.view === "swipe") renderDeck();
    }
  });
  $("#btn-yes").onclick = () => { const c = $("#deck .card:not(.behind)"); const l = c && state.listings.find((x) => x.id === c.dataset.id); if (l) fly(c, "yes", l); };
  $("#btn-no").onclick = () => { const c = $("#deck .card:not(.behind)"); const l = c && state.listings.find((x) => x.id === c.dataset.id); if (l) fly(c, "no", l); };
  $("#btn-undo").onclick = undo;
  document.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") $("#btn-yes").click(); if (e.key === "ArrowLeft") $("#btn-no").click(); });

  sb.channel("live").on("postgres_changes", { event: "*", schema: "public", table: "votes" }, load)
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, load).subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  renderWho();
  load();
})();
