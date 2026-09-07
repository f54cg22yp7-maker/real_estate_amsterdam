/* Pand v3: two people, one deck, independent votes, match on mutual like, weekly viewing pick,
   in-viewing evaluation, Supabase login + profiles, theme, neighbourhood-first maps. */
(function () {
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
  const $ = (s) => document.querySelector(s);
  const state = { listings: [], votes: [], viewings: {}, evals: {}, photos: {}, requests: [], me: localStorage.getItem("who") || CFG.people[0].id,
    view: "swipe", savedTab: "likes", lastVote: null, bigmap: null, profile: null, sheetId: null, evalId: null, picks: new Set(),
    session: null, user: null, prof: null, prefs: null, theme: localStorage.getItem("theme") || "system", weeklyTarget: +localStorage.getItem("weeklyTarget") || CFG.weeklyTarget, authEmail: "" };
  const other = () => CFG.people.find((p) => p.id !== state.me).id;
  const person = (id) => CFG.people.find((p) => p.id === id) || { id, name: id, avatar: "" };
  const nameOf = (id) => person(id).name;
  const eur = (n) => (n == null ? "" : "€ " + Math.round(n).toLocaleString("nl-NL"));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const HIDDEN = new Set(["sold", "withdrawn", "rented", "sold subject to conditions"]);
  const byId = (id) => state.listings.find((l) => l.id === id);
  const CATS = [["light", "Light & orientation"], ["layout", "Layout & space"], ["condition", "Condition & finish"], ["kitchen_bath", "Kitchen & bathroom"],
    ["noise", "Quiet & privacy"], ["street", "Street & neighbourhood"], ["outdoor", "Outdoor space"], ["building", "Building & VvE"], ["storage", "Storage & bikes"], ["gut", "Gut feeling"]];
  const CHECKS = [["foundation", "Foundation report seen or asked"], ["damp", "Damp, mould, cracks checked"], ["windows", "Window frames and glazing OK"],
    ["heating", "Boiler / heating age asked"], ["vve", "VvE minutes and reserve fund asked"], ["sound", "Sound from neighbours / street"], ["sun", "Sun on outdoor space at this hour"],
    ["bikes", "Bike and storage situation"], ["lease", "Erfpacht canon and end date confirmed"], ["signal", "Phone signal and internet"]];
  const STAGES = ["selected", "requested", "scheduled", "viewed"];
  const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const TILES = () => isDark() ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png";
  const ATTR = "&copy; OpenStreetMap &copy; CARTO";
  const gmaps = (l) => `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
  const amaps = (l) => `https://maps.apple.com/?q=${encodeURIComponent(l.address || "")}&ll=${l.lat},${l.lng}`;
  const photosOf = (l, n) => { const a = (l.photos && l.photos.length ? l.photos : [l.photo]).filter(Boolean); return n ? a.slice(0, n) : a; };

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2200); }
  function voteOf(id, who) { return state.votes.find((v) => v.listing_id === id && v.who === who); }
  function isMatch(l) { return CFG.people.every((p) => (voteOf(l.id, p.id) || {}).vote === "yes"); }
  function viewing(id) { return state.viewings[id]; }
  function evalOf(id, who) { return state.evals[id + ":" + who]; }
  function fit(l) { return window.Affinity.score(l, state.profile, state.prefs); }
  const img = (u, w, h) => (u || "").replace(/width=\d+/, "width=" + w).replace(/height=\d+/, "height=" + h);
  function queue() { return state.listings.filter((l) => !HIDDEN.has(l.status) && !voteOf(l.id, state.me)); }
  function isoWeek(d) { d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${String(Math.ceil((((d - y0) / 864e5) + 1) / 7)).padStart(2, "0")}`; }
  function statusBadge(l) {
    if (!l.status || l.status === "available") return `<div class="badge">Available</div>`;
    const cls = HIDDEN.has(l.status) ? "bad" : "warn";
    return `<div class="badge ${cls}">${esc(l.status[0].toUpperCase() + l.status.slice(1))}</div>`;
  }
  function leaseUntil(l) { const lease = l.leasehold || {}; const k = Object.keys(lease).find((k) => /afgekocht/i.test(k)); return k ? String(lease[k]) : ""; }
  function ownershipText(l) {
    if (!l.ownership) return ["Unknown", ""];
    if (l.ownership.startsWith("freehold")) return ["Freehold", "good"];
    const u = leaseUntil(l);
    if (u) { if (/eeuwig/i.test(u)) return ["Leasehold · paid off", "good"]; const y = (u.match(/(\d{4})/) || [])[1]; return [`Leasehold · until ${y || u}`, y && +y < 2040 ? "warn" : ""]; }
    return ["Leasehold (erfpacht)", "warn"];
  }
  function ownershipLine(l) {
    const o = (l.ownership || "").toLowerCase();
    if (o.startsWith("freehold")) return "Eigen grond (freehold, no ground lease)";
    if (o.startsWith("leasehold")) { const u = leaseUntil(l); if (/eeuwig/i.test(u)) return "Erfpacht (leasehold), bought off in perpetuity"; return u ? `Erfpacht (leasehold), paid until ${u.slice(0, 4)}` : "Erfpacht (leasehold), terms to confirm"; }
    return "Ownership to confirm";
  }
  const area = (l) => window.areaFor(l.postcode) || "Amsterdam";
  const chipsHtml = (l) => [l.m2 && `${l.m2} m²`, l.rooms && `${l.rooms} rooms`, l.bedrooms != null && `${l.bedrooms} bed`, l.floor && l.floor.replace("floor", "fl."), l.build_year && `Built ${l.build_year}`]
    .filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join("") + (l.energy_label ? `<span class="chip label-${esc(l.energy_label)}">Label ${esc(l.energy_label)}</span>` : "");
  function kvHtml(l) {
    const [own, ownCls] = ownershipText(l);
    return `<div class="kv">
      <div><span>Ownership</span><b class="${ownCls}">${esc(own)}</b></div>
      <div><span>VvE / month</span><b>${l.vve_monthly != null ? eur(l.vve_monthly) : "—"}</b></div>
      <div><span>Outdoor</span><b>${esc(l.outdoor || "—")}</b></div>
      <div><span>Type</span><b>${esc(l.type || "—")}</b></div>
      <div><span>Listed</span><b>${esc(l.listed_since || (l.first_seen || "").slice(0, 10))}</b></div>
      <div><span>Status</span><b>${esc(l.status || "available")}</b></div></div>`;
  }

  /* ---------- Maps ---------- */
  function mountMap(el, l, opts) {
    if (!l.lat || !l.lng || !window.L || !el || el._map) return;
    opts = opts || {};
    const m = L.map(el, { zoomControl: !!opts.interactive, attributionControl: true, dragging: !!opts.interactive, scrollWheelZoom: !!opts.interactive,
      touchZoom: !!opts.interactive, doubleClickZoom: !!opts.interactive, tap: !!opts.interactive });
    L.tileLayer(TILES(), { maxZoom: 19, attribution: ATTR, subdomains: "abcd" }).addTo(m);
    L.circle([l.lat, l.lng], { radius: opts.radius || 350, color: "#D8F36A", weight: 2, fillColor: "#D8F36A", fillOpacity: .18 }).addTo(m);
    L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="arealabel">${esc(area(l).split(" / ")[0])}</div>`, iconSize: [0, 0] }), interactive: false }).addTo(m);
    L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2.5, fillColor: "#121212", fillOpacity: 1 }).addTo(m);
    m.setView([l.lat, l.lng], opts.zoom || 14); el._map = m; setTimeout(() => m.invalidateSize(), 60);
  }

  /* ---------- Swipe deck ---------- */
  function cardHtml(l) {
    const f = fit(l); const ph = photosOf(l, 4);
    return `
      <div class="hero">
        <div class="slides" data-n="${ph.length}">${ph.map((p) => `<img src="${esc(img(p, 1200, 800))}" alt="" draggable="false">`).join("")}</div>
        ${ph.length > 1 ? `<div class="dots">${ph.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>` : ""}
        ${statusBadge(l)}${f != null ? `<div class="fit">${f}% fit</div>` : ""}
        <div class="stamp yes">LIKE</div><div class="stamp no">PASS</div>
        <div class="grad"></div>
        <div class="headline">
          <div class="price">${eur(l.price)}<small>${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""}</small></div>
          <div class="addr">${esc(l.street || l.address || "")}</div>
          <div class="area">${esc(area(l))} · ${l.postcode ? esc(l.postcode.slice(0, 4) + " " + l.postcode.slice(4)) : ""}</div>
        </div>
      </div>
      <div class="body">
        <div class="hint"><span>Swipe right to like, left to pass · scroll for more · tap for the full profile</span></div>
        <div class="chips">${chipsHtml(l)}</div>
        <div class="minimap" id="mm-${l.id}"></div>
        ${kvHtml(l)}
        <div class="summary">${esc(l.summary || (l.description_en || "").slice(0, 220) || "")}</div>
        <div class="links"><button class="dark" data-open="${l.id}">Full profile & photos</button><a href="${esc(l.url)}" target="_blank" rel="noopener">move.nl listing</a></div>
      </div>`;
  }
  function attachSlides(root, onTap) {
    const sl = root.querySelector(".slides"); if (!sl) return;
    const dots = root.querySelectorAll(".dots i");
    sl.addEventListener("scroll", () => { const i = Math.round(sl.scrollLeft / sl.clientWidth); dots.forEach((d, k) => d.classList.toggle("on", k === i)); }, { passive: true });
    let x0 = 0, y0 = 0, down = false;
    sl.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; down = true; });
    sl.addEventListener("pointercancel", () => (down = false));
    sl.addEventListener("pointerup", (e) => { const tap = down && Math.abs(e.clientX - x0) < 8 && Math.abs(e.clientY - y0) < 8; down = false; if (tap && onTap) onTap(Math.round(sl.scrollLeft / sl.clientWidth)); });
  }
  function renderDeck() {
    const deck = $("#deck"), q = queue();
    $("#count").textContent = q.length ? `${q.length} to go` : "";
    deck.innerHTML = "";
    if (!q.length) { deck.innerHTML = `<div class="empty"><h2>All caught up</h2><div>New places land every few hours. Check Saved and Viewings meanwhile.</div>${window.Affinity.hasPrefs(state.prefs) ? "" : `<button class="pill ink" data-prefs="1" style="border:0;padding:10px 16px;margin-top:14px">Tune the % fit</button>`}</div>`; $("#actions").style.visibility = "hidden"; return; }
    $("#actions").style.visibility = "visible";
    q.slice(0, 2).reverse().forEach((l, i, arr) => {
      const c = document.createElement("div"); c.className = "card" + (i < arr.length - 1 ? " behind" : ""); c.dataset.id = l.id; c.innerHTML = cardHtml(l); deck.appendChild(c);
      if (i === arr.length - 1) { attachDrag(c, l); attachSlides(c, () => openSheet(l.id)); mountMap(document.getElementById(`mm-${l.id}`), l, { zoom: 14, radius: 350, interactive: true }); }
    });
  }
  function attachDrag(card, l) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, decided = null, t0 = 0, target = null;
    const yes = card.querySelector(".stamp.yes"), no = card.querySelector(".stamp.no");
    const onDown = (e) => { if (e.target.closest("button,a,.leaflet-container,.slides")) return; const p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; dx = dy = 0; dragging = true; decided = null; t0 = Date.now(); target = e.target; card.style.transition = "none"; };
    const onMove = (e) => {
      if (!dragging) return; const p = e.touches ? e.touches[0] : e; dx = p.clientX - sx; dy = p.clientY - sy;
      if (decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) decided = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (decided !== "h") return; if (e.cancelable) e.preventDefault();
      card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = Math.min(1, Math.max(0, dx / 90)); no.style.opacity = Math.min(1, Math.max(0, -dx / 90));
    };
    const onUp = () => {
      if (!dragging) return; dragging = false;
      if (decided === "h" && Math.abs(dx) > 100) return fly(card, dx > 0 ? "yes" : "no", l);
      card.style.transition = "transform .25s"; card.style.transform = ""; yes.style.opacity = no.style.opacity = 0;
      if (decided === null && Date.now() - t0 < 400 && target && target.closest(".body")) openSheet(l.id);   // a tap
    };
    card.addEventListener("touchstart", onDown, { passive: true }); card.addEventListener("touchmove", onMove, { passive: false }); card.addEventListener("touchend", onUp);
    card.addEventListener("mousedown", onDown); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
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
    state.lastVote = { listing: l, vote }; recomputeProfile(); renderAll();
    const { error } = await sb.from("votes").upsert(row, { onConflict: "listing_id,who" });
    if (error) { toast("Could not save, retrying"); console.error(error); setTimeout(() => sb.from("votes").upsert(row, { onConflict: "listing_id,who" }), 2000); }
    else if (vote === "yes" && isMatch(l)) toast(`It's a match with ${nameOf(other())}`);
  }
  async function undo() {
    if (!state.lastVote) return toast("Nothing to undo");
    const { listing } = state.lastVote;
    state.votes = state.votes.filter((v) => !(v.listing_id === listing.id && v.who === state.me)); state.lastVote = null; recomputeProfile(); renderAll();
    const { error } = await sb.from("votes").delete().match({ listing_id: listing.id, who: state.me }); if (error) toast("Undo failed");
  }
  function recomputeProfile() {
    const liked = state.listings.filter((l) => state.votes.some((v) => v.listing_id === l.id && v.vote === "yes"));
    state.profile = window.Affinity.profile(liked);
  }

  /* ---------- Lists ---------- */
  function requestSent(v) { const r = state.requests.find((r) => r.id === v.request_id); return !!(r && r.sent_at); }
  function fmtDate(iso) { if (!iso) return "date tbd"; const d = new Date(iso); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (iso.length > 10 ? " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""); }
  function stagePill(id) {
    const v = viewing(id); if (!v || v.stage === "dropped") return "";
    const map = { selected: ["lilac", "On the viewing list"], requested: ["peach", requestSent(v) ? "Viewing requested" : "Request pending"], scheduled: ["ink", "Viewing " + fmtDate(v.scheduled_at)], viewed: ["good", "Viewed"] };
    const [cls, txt] = map[v.stage] || ["", v.stage]; return `<span class="pill ${cls}">${esc(txt)}</span>`;
  }
  function rowHtml(l, note, cls) {
    const f = fit(l);
    return `<button class="row" data-open="${l.id}">
      <div class="thumb" style="background-image:url('${esc(l.photo || "")}')"></div>
      <div class="info"><div class="t1"><span>${esc(l.street || "")}</span><span>${eur(l.price)}</span></div>
      <div class="t2">${esc(area(l))} · ${l.m2 || "?"} m² · ${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""} · ${esc(ownershipText(l)[0])}</div>
      <div class="t3 ${cls}">${note}${f != null ? `<span class="pill fit">${f}% fit</span>` : ""}${stagePill(l.id)}</div></div></button>`;
  }
  function renderSaved() {
    const mine = state.listings.filter((l) => (voteOf(l.id, state.me) || {}).vote === "yes");
    const matches = state.listings.filter(isMatch);
    const passed = state.listings.filter((l) => (voteOf(l.id, state.me) || {}).vote === "no");
    $("#n-likes").textContent = mine.length || ""; $("#n-matches").textContent = matches.length || "";
    const sortFit = (a) => a.slice().sort((x, y) => (fit(y) || 0) - (fit(x) || 0));
    let html = "";
    if (state.savedTab === "likes") html = sortFit(mine).map((l) => { const th = voteOf(l.id, other());
      if (!th) return rowHtml(l, `Waiting for ${nameOf(other())}`, "wait"); return th.vote === "yes" ? rowHtml(l, "♥ Match", "match") : rowHtml(l, `${nameOf(other())} passed`, "passed"); }).join("")
      || `<div class="empty"><h2>No likes yet</h2><div>Swipe right on anything you would actually visit.</div></div>`;
    else if (state.savedTab === "matches") html = sortFit(matches).map((l) => rowHtml(l, `Both liked · ${esc(l.status || "available")}`, "match")).join("")
      || `<div class="empty"><h2>No matches yet</h2><div>A match appears when you both like the same place.</div></div>`;
    else html = passed.map((l) => rowHtml(l, "You passed · tap to reconsider", "wait")).join("") || `<div class="empty"><h2>Nothing passed</h2></div>`;
    $("#saved-list").innerHTML = html;
  }

  /* ---------- Weekly pick and viewings ---------- */
  function weekCandidates() {
    const since = Date.now() - 7 * 864e5;
    return state.listings.filter((l) => {
      if (HIDDEN.has(l.status)) return false;
      const v = viewing(l.id); if (v && ["requested", "scheduled", "viewed", "dropped"].includes(v.stage)) return false;
      if (v && v.stage === "selected") return true;
      return state.votes.some((x) => x.listing_id === l.id && x.vote === "yes" && new Date(x.at).getTime() >= since);
    }).sort((a, b) => (isMatch(b) - isMatch(a)) || ((fit(b) || 0) - (fit(a) || 0)));
  }
  function renderViewings() {
    const cands = weekCandidates();
    const inPipe = Object.values(state.viewings).filter((v) => v.stage !== "dropped" && v.stage !== "selected" && byId(v.listing_id));
    $("#n-viewings").textContent = cands.length || "";
    const sec = (stage, title, note) => { const rows = inPipe.filter((v) => v.stage === stage).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));
      return rows.length ? `<div class="section-h">${title}</div>` + rows.map((v) => rowHtml(byId(v.listing_id), note(v), "wait")).join("") : ""; };
    const nm = cands.filter(isMatch).length;
    $("#viewings-list").innerHTML = `
      <div class="weekly-card"><h3>Weekly pick</h3>
        <p>${cands.length ? `${cands.length} liked this week, ${nm} match${nm === 1 ? "" : "es"}. Pick about ${state.weeklyTarget} and Pand emails the agent.` : "Nothing liked this week yet. The pick opens every Saturday."}</p>
        <button data-weekly="1" ${cands.length ? "" : "disabled"}>Choose viewings</button></div>
      ${sec("requested", "Requested", (v) => requestSent(v) ? `Email sent · waiting for the agent` : `Email goes out at the next job run`)}
      ${sec("scheduled", "Scheduled", (v) => `Viewing on ${esc(fmtDate(v.scheduled_at))} · open to evaluate`)}
      ${sec("viewed", "Viewed", (v) => verdictLine(v.listing_id))}
      ${inPipe.length ? "" : `<div class="section-h">Pipeline</div><div class="card-block" style="color:var(--muted)">Requested, scheduled and viewed places show up here.</div>`}`;
  }
  function verdictLine(id) {
    return CFG.people.map((p) => { const e = evalOf(id, p.id); const sc = e ? Object.values(e.scores || {}).filter((n) => typeof n === "number") : [];
      const avg = sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1) : "–"; return `<span class="pill ${e && e.verdict === "yes" ? "good" : e && e.verdict === "no" ? "bad" : ""}">${esc(p.name)} ${e && e.verdict ? esc(e.verdict) : "?"} · ${avg}</span>`; }).join("");
  }
  function openWeekly() {
    const cands = weekCandidates(); if (!cands.length) return toast("Nothing to pick this week");
    if (!state.picks.size) cands.forEach((l) => { if (isMatch(l) || (viewing(l.id) || {}).stage === "selected") state.picks.add(l.id); });
    renderWeekly(); $("#weekly").hidden = false;
  }
  function renderWeekly() {
    const cands = weekCandidates(); state.picks.forEach((id) => { if (!cands.some((l) => l.id === id)) state.picks.delete(id); });
    const n = state.picks.size;
    $("#weekly-body").innerHTML = `
      <p style="margin:6px 2px 12px;color:var(--muted);font-size:13.5px">Everything liked in the last 7 days. Matches are pre-selected. Tap to include or exclude, then send the request to Dames van Vermeer.</p>
      <div class="stack">${cands.map((l) => { const th = voteOf(l.id, other()), me = voteOf(l.id, state.me);
        const who = isMatch(l) ? "♥ Match" : me && me.vote === "yes" ? `You liked · ${th ? nameOf(other()) + " passed" : "waiting for " + nameOf(other())}` : `${nameOf(other())} liked`;
        return `<div class="pick ${state.picks.has(l.id) ? "on" : ""}" data-pick="${l.id}"><div class="box"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div>
          <div class="thumb" style="background-image:url('${esc(l.photo || "")}')"></div>
          <div class="info"><div class="t1">${esc(l.street)} · ${eur(l.price)}</div><div class="t2">${esc(who)} · ${l.m2} m² · ${esc(ownershipText(l)[0])}${fit(l) != null ? " · " + fit(l) + "% fit" : ""}</div></div></div>`; }).join("")}</div>
      <div class="counter"><span>Selected</span><span><b>${n}</b> / about ${state.weeklyTarget} per week</span></div>
      <div class="card-block"><h4>Availability (optional, replaces the default sentence)</h4><textarea id="avail" placeholder="${esc(defaultAvailability())}"></textarea></div>
      <div class="card-block"><h4>Email preview</h4><div class="preview" id="preview">${esc(emailBody([...state.picks].map(byId).filter(Boolean), ""))}</div></div>
      <div class="stack" style="margin-top:12px">
        <button class="primary accent" id="send-job" ${n ? "" : "disabled"}>Send request from Pand</button>
        <button class="primary secondary" id="send-phone" ${n ? "" : "disabled"}>Send from my phone (Mail app)</button>
        <button class="primary danger" data-close="weekly">Not this week</button></div>`;
    $("#avail").addEventListener("input", () => { $("#preview").textContent = emailBody([...state.picks].map(byId).filter(Boolean), $("#avail").value); });
  }
  function nextWeekSlots() {
    const today = new Date(); const mon = new Date(today); mon.setDate(today.getDate() + (7 - ((today.getDay() + 6) % 7)));
    const f = (d) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const wed = new Date(mon); wed.setDate(mon.getDate() + 2); const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    return `${f(wed)} in the afternoon, or ${f(fri)} in the morning or afternoon`;
  }
  function defaultAvailability() { return `For viewings we are available ${nextWeekSlots()}. If none of those work we can usually be flexible, just let us know what is possible.`; }
  function emailBody(ls, avail) {
    const lines = ls.map((l) => `${l.address}\n${l.url}\n${eur(l.price)},- k.k. · ${l.m2} m² · ${ownershipLine(l)}`);
    return `${CFG.agent.greeting}\n\nHope all is well! We went through this week's listings and would like to view the following ${ls.length === 1 ? "one" : ls.length}:\n\n${lines.join("\n\n")}\n\n${(avail || "").trim() || defaultAvailability()}\n\nThanks in advance!\n\nBest,\nDavit & Luis`;
  }
  async function sendRequest(via) {
    const ids = [...state.picks]; if (!ids.length) return;
    const id = `req-${Date.now()}`; const now = new Date().toISOString(); const avail = ($("#avail").value || "").trim();
    const req = { id, listing_ids: ids, created_by: state.me, created_at: now, availability: avail || null, sent_at: via === "phone" ? now : null, sent_via: via === "phone" ? "phone" : null };
    const rows = ids.map((lid) => ({ listing_id: lid, stage: "requested", selected_by: state.me, request_id: id, updated_at: now }));
    const r1 = await sb.from("viewing_requests").insert(req); if (r1.error) { console.error(r1.error); return toast("Could not save the request"); }
    const r2 = await sb.from("viewings").upsert(rows, { onConflict: "listing_id" }); if (r2.error) { console.error(r2.error); return toast("Saved request, but viewings failed"); }
    state.requests.push(req); rows.forEach((r) => (state.viewings[r.listing_id] = r)); state.picks.clear();
    if (via === "phone") {
      const week = isoWeek(new Date()).split("-W")[1];
      window.location.href = `mailto:${CFG.agent.to.join(",")}?cc=${encodeURIComponent(CFG.agent.cc.join(","))}&subject=${encodeURIComponent(`Week ${+week} listings: viewing request`)}&body=${encodeURIComponent(emailBody(ids.map(byId).filter(Boolean), avail))}`;
      toast("Opening Mail with the request");
    } else toast("Queued. Pand emails the agent within 3 hours.");
    $("#weekly").hidden = true; renderAll();
  }

  /* ---------- Detail sheet ---------- */
  function openSheet(id) {
    const l = byId(id); if (!l) return; state.sheetId = id;
    $("#sheet-title").textContent = l.street || l.address || ""; renderSheet(); $("#sheet").hidden = false; $("#sheet-body").scrollTop = 0;
  }
  function renderSheet() {
    const l = byId(state.sheetId); if (!l) return;
    const me = (voteOf(l.id, state.me) || {}).vote, th = voteOf(l.id, other()); const v = viewing(l.id); const stage = v && v.stage !== "dropped" ? v.stage : null;
    const stepIdx = stage ? STAGES.indexOf(stage) : -1;
    $("#sheet-body").innerHTML = `
      <div class="galwrap"><div class="gallery slides" data-n="${photosOf(l).length}">${photosOf(l).map((p, i) => `<img src="${esc(img(p, 1200, 800))}" ${i > 2 ? 'loading="lazy"' : ""} alt="">`).join("")}</div>
        <div class="galhint">Tap to view full screen</div><div class="galcount" id="galcount">1 / ${photosOf(l).length}</div></div>
      <div class="detail-price">${eur(l.price)}<small>${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""}${fit(l) != null ? " · " + fit(l) + "% fit" : ""}</small></div>
      <div class="detail-addr">${esc(l.address || "")}</div>
      <div class="detail-area">${esc(area(l))} · ${esc(l.status || "available")}${l.listed_since ? " · listed " + esc(l.listed_since) : ""}</div>
      <div class="chips">${chipsHtml(l)}</div>
      <div class="stack">
        <div class="card-block"><h4>Neighbourhood · ${esc(area(l))}</h4><div class="minimap tall" id="sheet-map"></div>
          <div class="links"><a class="dark" href="${gmaps(l)}" target="_blank" rel="noopener">Google Maps</a><a href="${amaps(l)}" target="_blank" rel="noopener">Apple Maps</a></div></div>
        <div class="card-block"><h4>Your vote</h4><div class="vote-row">
          <button class="yes ${me === "yes" ? "on" : ""}" data-vote="yes">♥ Like</button><button class="no ${me === "no" ? "on" : ""}" data-vote="no">✕ Pass</button></div>
          <div class="people-scores"><span><img src="${esc(person(other()).avatar)}" alt="">${esc(nameOf(other()))}: ${th ? (th.vote === "yes" ? "liked" : "passed") : "not yet"}</span>${isMatch(l) ? `<span class="pill fit">♥ Match</span>` : ""}</div></div>
        <div class="card-block"><h4>Viewing</h4>
          ${stage ? `<div class="stage"><span style="font-weight:700">${esc({ selected: "On the viewing list", requested: requestSent(v) ? "Requested, waiting for the agent" : "Request queued for the next email", scheduled: "Scheduled " + fmtDate(v.scheduled_at), viewed: "Viewed" }[stage])}</span><span class="steps">${STAGES.map((s, i) => `<i class="${i <= stepIdx ? "on" : ""}"></i>`).join("")}</span></div>` : `<div style="color:var(--muted);font-size:13.5px;margin-bottom:8px">Not on the viewing list. Add it and it appears in the weekly pick.</div>`}
          <div class="stack" style="margin-top:10px">
            ${!stage ? `<button class="primary" data-stage="selected">Add to viewing list</button>` : ""}
            ${stage && stage !== "viewed" ? `<label style="font-size:13px;color:var(--muted)">Viewing date and time</label><input type="datetime-local" id="sched" value="${v.scheduled_at ? esc(v.scheduled_at.slice(0, 16)) : ""}"><button class="primary secondary" data-stage="scheduled">Save date</button>` : ""}
            ${stage ? `<button class="primary accent" data-eval="${l.id}">${stage === "viewed" ? "Open evaluation" : "Start viewing evaluation"}</button>` : ""}
            ${stage ? `<button class="primary danger" data-stage="dropped">Remove from viewings</button>` : ""}
          </div>
          ${stage === "viewed" ? `<div class="people-scores" style="margin-top:10px">${verdictLine(l.id)}</div>` : ""}
        </div>
        <div class="card-block"><h4>Facts</h4>${kvHtml(l)}<div class="summary" style="margin:0">${esc(l.summary || "")}</div></div>
        ${l.description_en ? `<div class="card-block"><h4>Description</h4><div class="desc clamp" id="desc">${esc(l.description_en)}</div><button class="linkbtn" id="desc-more">Read more</button></div>` : ""}
        ${l.features && Object.keys(l.features).length ? `<div class="card-block"><h4>All features</h4><div class="kv">${Object.entries(l.features).slice(0, 40).map(([k, val]) => `<div><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join("")}</div></div>` : ""}
        <div class="links"><a class="dark" href="${esc(l.url)}" target="_blank" rel="noopener">Open on move.nl</a></div>
      </div>`;
    mountMap($("#sheet-map"), l, { zoom: 14, interactive: true, radius: 350 });
    const gal = $("#sheet-body .gallery"); if (gal) { gal.addEventListener("scroll", () => { $("#galcount").textContent = `${Math.round(gal.scrollLeft / gal.clientWidth) + 1} / ${photosOf(l).length}`; }, { passive: true }); attachSlides($("#sheet-body .galwrap"), (i) => openLightbox(photosOf(l), i)); }
    const more = $("#desc-more"); if (more) more.onclick = () => { $("#desc").classList.toggle("clamp"); more.textContent = $("#desc").classList.contains("clamp") ? "Read more" : "Show less"; };
  }
  function openLightbox(photos, idx) {
    const lb = $("#lightbox"), tr = $("#lb-track");
    tr.innerHTML = photos.map((p) => `<img src="${esc(img(p, 1920, 1280))}" alt="">`).join("");
    lb.hidden = false; tr.scrollLeft = idx * tr.clientWidth; $("#lb-count").textContent = `${idx + 1} / ${photos.length}`;
    tr.onscroll = () => { $("#lb-count").textContent = `${Math.round(tr.scrollLeft / tr.clientWidth) + 1} / ${photos.length}`; };
    attachSlides({ querySelector: (q) => (q === ".slides" ? tr : null), querySelectorAll: () => [] }, () => (lb.hidden = true));
  }
  async function setStage(id, stage) {
    const now = new Date().toISOString(); const prev = viewing(id) || {};
    const row = { listing_id: id, stage, selected_by: prev.selected_by || state.me, request_id: prev.request_id || null, scheduled_at: prev.scheduled_at || null, notes: prev.notes || null, updated_at: now };
    if (stage === "scheduled") { const val = ($("#sched") || {}).value; if (!val) return toast("Pick a date first"); row.scheduled_at = new Date(val).toISOString(); }
    if (stage === "selected") row.selected_at = now;
    state.viewings[id] = row; renderAll(); if (!$("#sheet").hidden) renderSheet();
    const { error } = await sb.from("viewings").upsert(row, { onConflict: "listing_id" });
    if (error) { console.error(error); toast("Could not save"); } else toast({ selected: "Added to the viewing list", scheduled: "Viewing scheduled", dropped: "Removed", viewed: "Marked as viewed" }[stage] || "Saved");
  }

  /* ---------- Evaluation ---------- */
  function openEval(id) { const l = byId(id); if (!l) return; state.evalId = id; $("#eval-title").textContent = `Viewing · ${l.street || ""}`; renderEval(); $("#eval").hidden = false; }
  function renderEval() {
    const id = state.evalId, l = byId(id); const mine = evalOf(id, state.me) || { scores: {}, checks: {}, verdict: null, notes: "" }; const theirs = evalOf(id, other());
    const photos = state.photos[id] || [];
    $("#eval-body").innerHTML = `
      <div class="detail-addr" style="margin:4px 0 2px">${esc(l.address || "")}</div>
      <div class="detail-area">${eur(l.price)} · ${l.m2} m² · ${esc(ownershipText(l)[0])}</div>
      <div class="stack">
        <div class="card-block"><h4>Scores · you as ${esc(nameOf(state.me))}${theirs ? ` · <span style="color:#8F7AD9">●</span> ${esc(nameOf(other()))}` : ""}</h4>
          ${CATS.map(([k, label]) => `<div class="cat"><div class="lab"><span>${label}</span><small>${mine.scores[k] ? ["", "Poor", "Weak", "OK", "Good", "Great"][mine.scores[k]] : ""}</small></div>
            <div class="seg" data-cat="${k}">${[1, 2, 3, 4, 5].map((n) => `<i class="${mine.scores[k] >= n ? "on" : ""} ${theirs && theirs.scores && theirs.scores[k] === n ? "them" : ""}" data-n="${n}"></i>`).join("")}</div></div>`).join("")}
          <div class="seg-scale"><span>Poor</span><span>Great</span></div></div>
        <div class="card-block"><h4>Checklist</h4>${CHECKS.map(([k, label]) => `<div class="check ${mine.checks[k] ? "on" : ""}" data-check="${k}"><div class="box"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div><span>${label}</span></div>`).join("")}</div>
        <div class="card-block"><h4>Verdict</h4><div class="verdict">${["yes", "maybe", "no"].map((v) => `<button data-v="${v}" class="${mine.verdict === v ? "on" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
          ${theirs && theirs.verdict ? `<div class="people-scores"><span><img src="${esc(person(other()).avatar)}" alt="">${esc(nameOf(other()))}: ${esc(theirs.verdict)}</span></div>` : ""}</div>
        <div class="card-block"><h4>Notes</h4><textarea id="eval-notes" placeholder="What stood out, what to ask the agent, what to check again">${esc(mine.notes || "")}</textarea>
          ${theirs && theirs.notes ? `<div style="margin-top:8px;font-size:13px;color:var(--muted)"><b>${esc(nameOf(other()))}:</b> ${esc(theirs.notes)}</div>` : ""}</div>
        <div class="card-block"><h4>Photos</h4><div class="photos">${photos.map((p) => `<img src="${esc(photoUrl(p.path))}" loading="lazy" alt="">`).join("")}<button id="add-photo">+ Photo</button></div></div>
      </div>`;
    $("#eval-notes").addEventListener("input", () => saveEval({ notes: $("#eval-notes").value }));
    attachSegs();
  }
  function attachSegs() {
    $("#eval-body").querySelectorAll(".seg").forEach((seg) => {
      const set = (x) => { const r = seg.getBoundingClientRect(); const n = Math.max(1, Math.min(5, Math.ceil(((x - r.left) / r.width) * 5))); saveEval({ scores: { [seg.dataset.cat]: n } }); };
      let down = false;
      seg.addEventListener("pointerdown", (e) => { down = true; seg.setPointerCapture(e.pointerId); set(e.clientX); });
      seg.addEventListener("pointermove", (e) => { if (down) set(e.clientX); });
      seg.addEventListener("pointerup", () => (down = false)); seg.addEventListener("pointercancel", () => (down = false));
    });
  }
  let evalTimer = null;
  function saveEval(patch) {
    const id = state.evalId; const key = id + ":" + state.me;
    const cur = state.evals[key] || { listing_id: id, who: state.me, scores: {}, checks: {}, verdict: null, notes: "" };
    const next = { ...cur, scores: { ...cur.scores, ...(patch.scores || {}) }, checks: { ...cur.checks, ...(patch.checks || {}) }, verdict: patch.verdict !== undefined ? patch.verdict : cur.verdict,
      notes: patch.notes !== undefined ? patch.notes : cur.notes, at: new Date().toISOString() };
    if (JSON.stringify(next.scores) === JSON.stringify(cur.scores) && next.verdict === cur.verdict && JSON.stringify(next.checks) === JSON.stringify(cur.checks) && next.notes === cur.notes) return;
    state.evals[key] = next;
    if (patch.notes === undefined) { const top = $("#eval-body").scrollTop; renderEval(); $("#eval-body").scrollTop = top; }
    $("#eval-saved").textContent = "Saving…"; clearTimeout(evalTimer);
    evalTimer = setTimeout(async () => {
      const { error } = await sb.from("evaluations").upsert(next, { onConflict: "listing_id,who" });
      $("#eval-saved").textContent = error ? "Not saved" : "Saved"; if (error) console.error(error);
      const v = viewing(id); if (!error && (!v || v.stage !== "viewed")) { const now = new Date().toISOString(); const row = { ...(v || { listing_id: id, selected_by: state.me }), listing_id: id, stage: "viewed", updated_at: now }; state.viewings[id] = row; await sb.from("viewings").upsert(row, { onConflict: "listing_id" }); renderViewings(); }
    }, 500);
  }
  function photoUrl(path) { return sb.storage.from("viewing-photos").getPublicUrl(path).data.publicUrl; }
  async function addPhoto(file) {
    if (!file) return; toast("Uploading photo…");
    const blob = await downscale(file, 1600); const id = state.evalId; const path = `${id}/${Date.now()}-${state.me}.jpg`;
    const up = await sb.storage.from("viewing-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) { console.error(up.error); return toast("Upload failed"); }
    const row = { id: path.replace(/\W/g, "_"), listing_id: id, who: state.me, path, at: new Date().toISOString() };
    const ins = await sb.from("viewing_photos").insert(row); if (ins.error) { console.error(ins.error); return toast("Photo stored but not registered"); }
    (state.photos[id] = state.photos[id] || []).push(row); renderEval(); toast("Photo added");
  }
  function downscale(file, max) {
    return new Promise((res) => { const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob((b) => res(b || file), "image/jpeg", 0.82); };
      img.onerror = () => res(file); img.src = url; });
  }

  /* ---------- Map tab ---------- */
  function renderBigMap() {
    if (!window.L) return;
    if (!state.bigmap) { state.bigmap = L.map("bigmap", { zoomControl: false, attributionControl: true }).setView([52.3676, 4.9041], 12);
      state.bigmap._tiles = L.tileLayer(TILES(), { maxZoom: 19, attribution: ATTR, subdomains: "abcd" }).addTo(state.bigmap); state.bigmap._layer = L.layerGroup().addTo(state.bigmap);
      state.bigmap.on("click", () => ($("#peek").hidden = true)); }
    if (state.bigmap._tilesDark !== isDark()) { state.bigmap._tiles.setUrl(TILES()); state.bigmap._tilesDark = isDark(); }
    const g = state.bigmap._layer; g.clearLayers();
    state.listings.filter((l) => l.lat && l.lng && !HIDDEN.has(l.status)).forEach((l) => {
      const me = (voteOf(l.id, state.me) || {}).vote, th = (voteOf(l.id, other()) || {}).vote; let color = "#B8B8B2", big = false;
      if (me === "yes" && th === "yes") { color = "#D8F36A"; big = true; } else if (me === "yes") color = "#121212"; else if (th === "yes") color = "#CDBDFF"; else if (me === "no") return;
      L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="pin ${big ? "big" : ""}" style="background:${color}"></div>`, iconSize: big ? [26, 26] : [18, 18], iconAnchor: big ? [13, 13] : [9, 9] }) })
        .on("click", () => showPeek(l)).addTo(g);
    });
    setTimeout(() => state.bigmap.invalidateSize(), 60);
  }
  function showPeek(l) {
    const p = $("#peek"); p.hidden = false;
    p.innerHTML = `<div class="thumb" style="background-image:url('${esc(l.photo || "")}')"></div><div class="info"><div class="t1">${esc(l.street)} · ${eur(l.price)}</div>
      <div class="t2">${esc(area(l))} · ${l.m2} m² · ${esc(ownershipText(l)[0])}${fit(l) != null ? " · " + fit(l) + "% fit" : ""}</div>
      <div class="acts"><button class="dark" data-open="${l.id}">Open profile</button><a href="${gmaps(l)}" target="_blank" rel="noopener">Google Maps</a></div></div>`;
  }

  /* ---------- Theme, auth, profile ---------- */
  function applyTheme(t) {
    state.theme = t; localStorage.setItem("theme", t);
    if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    document.querySelectorAll(".leaflet-container").forEach((el) => { if (el._map) el._map.eachLayer((ly) => { if (ly.setUrl) ly.setUrl(TILES()); }); });
    if (state.bigmap) state.bigmap._tilesDark = null;
  }
  function personFromEmail(email) { email = (email || "").toLowerCase(); return (CFG.people.find((p) => (p.emails || []).includes(email)) || {}).id || null; }
  async function loadProfile() {
    const u = state.user; if (!u) return;
    let { data } = await sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
    if (!data) {
      data = { id: u.id, email: u.email, person: personFromEmail(u.email), display_name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || null,
        avatar_url: (u.user_metadata && (u.user_metadata.avatar_url || u.user_metadata.picture)) || null, theme: state.theme, prefs: { weeklyTarget: state.weeklyTarget } };
      const r = await sb.from("profiles").insert(data); if (r.error) console.warn("profile insert", r.error);
    }
    state.prof = data;
    if (data.person) { state.me = data.person; localStorage.setItem("who", state.me); }
    if (data.theme && data.theme !== state.theme) applyTheme(data.theme);
    if (data.prefs && data.prefs.weeklyTarget) { state.weeklyTarget = data.prefs.weeklyTarget; localStorage.setItem("weeklyTarget", state.weeklyTarget); }
    if (!data.person) { openProfile(); toast("Tell Pand who you are"); }
  }
  async function saveProfile(patch) {
    if (!state.prof) return;
    state.prof = { ...state.prof, ...patch, updated_at: new Date().toISOString() };
    const { error } = await sb.from("profiles").upsert(state.prof, { onConflict: "id" }); if (error) { console.error(error); toast("Profile not saved"); }
  }
  async function initAuth() {
    const { data: { session } } = await sb.auth.getSession();
    state.session = session; state.user = session && session.user;
    if (state.user) await loadProfile(); else if (localStorage.getItem("guest") !== "1") showAuth();
    sb.auth.onAuthStateChange(async (ev, s) => {
      state.session = s; state.user = s && s.user;
      if (ev === "SIGNED_IN" && state.user) { $("#auth").hidden = true; localStorage.removeItem("guest"); await loadProfile(); renderAll(); if (!$("#profile").hidden) renderProfile(); }
      if (ev === "SIGNED_OUT") { state.prof = null; showAuth(); }
    });
  }
  let providers = null;   // which sign-in methods the Supabase project has enabled
  async function loadProviders() {
    if (providers) return providers;
    try { const r = await fetch(`${CFG.supabaseUrl}/auth/v1/settings`, { headers: { apikey: CFG.supabaseKey } }); const j = await r.json(); providers = j.external || {}; }
    catch (e) { providers = {}; }
    return providers;
  }
  function showAuth(step) {
    $("#auth").hidden = false;
    if (!providers) { loadProviders().then(() => { if (!$("#auth").hidden) showAuth(step); }); }
    const pv = providers || {};
    const g = `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10c.8-2.3 3-4 5.6-4z"/></svg>`;
    const a = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.8 1.3 10.3.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.4-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1-2.8-4.2zM13.9 5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.2 1.2.1 2.4-.6 3.1-1.5z"/></svg>`;
    $("#auth-body").innerHTML = `
      <img class="logo-big" src="icon-192.png" alt="">
      <h1>Hi, it's Pand</h1><p>Sign in once. Your swipes, viewings and settings follow you on every phone.</p>
      ${pv.google || pv.apple ? `<div class="oauth">${pv.google ? `<button data-oauth="google">${g} Google</button>` : ""}${pv.apple ? `<button data-oauth="apple">${a} Apple</button>` : ""}</div><div class="or">or with your email</div>` : ""}
      ${step === "code" ? `<p style="margin:0 0 8px">We sent a code to <b>${esc(state.authEmail)}</b>. Tapping the link in that email also works.</p>
        <input type="text" class="code" id="auth-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Code from the email">
        <button class="primary accent" id="auth-verify" style="margin-top:10px">Sign in</button>
        <button class="primary secondary" id="auth-back" style="margin-top:8px">Use another email</button>`
      : `<input type="email" id="auth-email" placeholder="you@example.com" autocomplete="email" value="${esc(state.authEmail)}">
        <button class="primary" id="auth-send" style="margin-top:10px">Send me a code</button>`}
      <div class="guest"><button id="auth-guest">Continue without an account</button></div>`;
  }
  async function authSend() {
    const email = ($("#auth-email").value || "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email");
    state.authEmail = email; $("#auth-send").disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
    if (error) { console.error(error); $("#auth-send").disabled = false; return toast(error.message); }
    showAuth("code");
  }
  async function authVerify() {
    const token = ($("#auth-code").value || "").trim(); if (token.length < 6) return toast("Enter the code from the email");
    $("#auth-verify").disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: state.authEmail, token, type: "email" });
    if (error) { console.error(error); $("#auth-verify").disabled = false; return toast(error.message); }
  }
  async function authOAuth(provider) {
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
    if (error) { console.error(error); toast(`${provider} sign-in is not enabled yet`); }
  }
  /* ---------- Preferences questionnaire (shared by both) ---------- */
  const PRIOS = [["location", "Neighbourhood"], ["outdoor", "Outdoor space"], ["size", "Size"], ["price", "Price"], ["energy", "Energy label"], ["ownership", "Freehold / paid-off lease"]];
  function allAreas() { const seen = [...new Set(Object.values(window.AREAS || {}))]; const groups = {}; seen.forEach((a) => { const d = a.split(/ \(|\//)[0].trim(); (groups[d] = groups[d] || []).push(a); }); return groups; }
  async function openPrefs() {
    const cur = await sb.from("app_events").select("data").eq("key", "couple_prefs").maybeSingle();   // always start from the latest shared answers
    if (cur.data && cur.data.data) state.prefs = cur.data.data;
    renderPrefs(); $("#prefs").hidden = false;
  }
  function renderPrefs() {
    const q = state.prefs || {}; const opt = (key, vals) => `<div class="opts">${vals.map(([v, lab]) => `<button data-pref-key="${key}" data-pref-val="${v}" class="${String(q[key] == null ? (key === "max_km" ? "5" : "any") : q[key]) === v ? "on" : ""}">${lab}</button>`).join("")}</div>`;
    const groups = allAreas(); const pr = q.priorities || [];
    $("#prefs-body").innerHTML = `
      <p style="margin:6px 2px 12px;color:var(--muted);font-size:13.5px">Fourteen quick questions. One shared answer set for both of you: whoever changes something changes it for both, and every card re-scores on both phones within seconds.${q.updated_by ? ` Last changed by ${esc(nameOf(q.updated_by))}${q.updated_at ? " · " + esc(fmtDate(q.updated_at)) : ""}.` : ""}</p>
      <div class="stack">
        <div class="q"><h4>1. Budget <span class="val" id="v-budget">${q.budget ? eur(q.budget) : "no limit"}</span></h4><p>Maximum asking price you would consider.</p><input type="range" id="r-budget" min="400000" max="1500000" step="25000" value="${q.budget || 1500000}"></div>
        <div class="q"><h4>2. Minimum size <span class="val" id="v-m2">${q.min_m2 ? q.min_m2 + " m²" : "any"}</span></h4><p>Living area below which it is a no.</p><input type="range" id="r-m2" min="40" max="150" step="5" value="${q.min_m2 || 40}"></div>
        <div class="q"><h4>3. Bedrooms</h4><p>Minimum number of real bedrooms.</p>${opt("min_bedrooms", [["any", "Any"], ["1", "1+"], ["2", "2+"], ["3", "3+"]])}</div>
        <div class="q"><h4>4. Outdoor space</h4><p>Balcony, terrace or garden.</p>${opt("outdoor", [["must", "Must have"], ["nice", "Nice to have"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>5. Neighbourhoods you love</h4><p>Pick as many as you like. Listings there score highest, the rest of the same district scores medium.</p>
          <div class="opts">${Object.entries(groups).map(([d, list]) => `<span class="grp">${esc(d)}</span>` + list.map((a) => `<button data-area="${esc(a)}" class="${(q.areas || []).includes(a) ? "on" : ""}">${esc(a.replace(d, "").replace(/^[ (\/]+|[)]+$/g, "") || d)}</button>`).join("")).join("")}</div></div>
        <div class="q"><h4>6. Ownership</h4><p>Freehold or a lease that is paid off forever means no ground rent surprises.</p>${opt("ownership", [["only", "Freehold or paid-off only"], ["prefer", "Prefer, not required"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>7. Energy label</h4><p>Lower labels mean higher bills and possible insulation work.</p>${opt("energy", [["AB", "A or B"], ["C", "C or better"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>8. Floor</h4>${opt("floor", [["ground", "Ground floor with garden"], ["upper", "Upper floor"], ["top", "Top floor"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>9. Building era</h4>${opt("era", [["prewar", "Pre-war character"], ["modern", "Modern (1990+)"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>10. Max VvE per month</h4>${opt("max_vve", [["any", "Any"], ["150", "€150"], ["250", "€250"], ["400", "€400"]])}</div>
        <div class="q"><h4>11. Max price per m²</h4><p>A quick value check against the asking price.</p>${opt("max_ppm", [["any", "Any"], ["7000", "€7.000"], ["8000", "€8.000"], ["9000", "€9.000"], ["10000", "€10.000"]])}</div>
        <div class="q"><h4>12. Place you go most</h4><p>Work, gym, friends. Listings within the distance below score full.</p>${opt("anchor", [["any", "None"], ["zuidas", "Zuidas"], ["centraal", "Centraal"], ["amstel", "Amstel station"], ["sloterdijk", "Sloterdijk"], ["sciencepark", "Science Park"], ["leidseplein", "Leidseplein"], ["museumplein", "Museumplein"], ["vondelpark", "Vondelpark"], ["westerpark", "Westerpark"], ["oosterpark", "Oosterpark"]])}
          <p style="margin-top:10px">Max distance as the crow flies</p>${opt("max_km", [["2", "2 km"], ["3", "3 km"], ["5", "5 km"], ["8", "8 km"]])}</div>
        <div class="q"><h4>13. Elevator</h4>${opt("lift", [["need", "Needed"], ["nice", "Nice to have"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>14. Parking</h4>${opt("parking", [["need", "Needed"], ["nice", "Nice to have"], ["any", "Don't care"]])}</div>
        <div class="q"><h4>Top 3 priorities</h4><p>Tap in order of importance. These get extra weight.</p>
          <div class="opts">${PRIOS.map(([k, lab]) => { const i = pr.indexOf(k); return `<button data-prio="${k}" class="${i >= 0 ? "on" : ""}">${i >= 0 ? `<b>${i + 1}</b>` : ""}${lab}</button>`; }).join("")}</div></div>
        <button class="primary danger" id="prefs-reset">Clear all answers</button>
      </div>`;
    $("#r-budget").addEventListener("input", (e) => { $("#v-budget").textContent = +e.target.value >= 1500000 ? "no limit" : eur(+e.target.value); });
    $("#r-budget").addEventListener("change", (e) => savePrefs({ budget: +e.target.value >= 1500000 ? null : +e.target.value }));
    $("#r-m2").addEventListener("input", (e) => { $("#v-m2").textContent = +e.target.value <= 40 ? "any" : e.target.value + " m²"; });
    $("#r-m2").addEventListener("change", (e) => savePrefs({ min_m2: +e.target.value <= 40 ? null : +e.target.value }));
  }
  let prefsTimer = null, prefsPending = {};
  function savePrefs(patch) {
    prefsPending = { ...prefsPending, ...patch };
    state.prefs = { ...(state.prefs || {}), ...patch }; const top = $("#prefs-body").scrollTop; renderPrefs(); $("#prefs-body").scrollTop = top; $("#prefs-saved").textContent = "Saving…";
    clearTimeout(prefsTimer); prefsTimer = setTimeout(async () => {
      // Merge onto the latest shared answers first, so one phone never wipes what the other phone saved.
      const cur = await sb.from("app_events").select("data").eq("key", "couple_prefs").maybeSingle();
      const base = (cur.data && cur.data.data) || {};
      const merged = Object.keys(prefsPending).length && !("__reset" in prefsPending) ? { ...base, ...prefsPending } : { ...prefsPending };
      delete merged.__reset; merged.updated_by = state.me; merged.updated_at = new Date().toISOString(); prefsPending = {};
      const { error } = await sb.from("app_events").upsert({ key: "couple_prefs", at: merged.updated_at, data: merged }, { onConflict: "key" });
      if (!error) state.prefs = merged;
      $("#prefs-saved").textContent = error ? "Not saved" : "Saved"; if (error) console.error(error); renderAll(); if (!$("#prefs").hidden) { const t2 = $("#prefs-body").scrollTop; renderPrefs(); $("#prefs-body").scrollTop = t2; }
    }, 400);
  }
  function openProfile() { renderProfile(); $("#profile").hidden = false; }
  function renderProfile() {
    const p = state.prof; const me = person(state.me);
    const av = (p && p.avatar_url) || me.avatar; const name = (p && p.display_name) || me.name;
    $("#profile-body").innerHTML = `
      <div class="phero"><img src="${esc(av)}" alt=""><h2>${esc(name)}</h2><div class="sub">${p ? esc(p.email || "") : "Not signed in · guest mode on this phone"}</div></div>
      <div class="card-block"><h4>Profile</h4>
        <div class="setting"><div class="l">I am<small>Votes and scores are saved under this name</small></div>
          <div class="segsm">${CFG.people.map((x) => `<button data-person="${x.id}" class="${x.id === state.me ? "active" : ""}"><img src="${esc(x.avatar)}" alt=""> ${esc(x.name)}</button>`).join("")}</div></div>
        <div class="setting"><div class="l">Account</div>${p ? `<button class="pill ink" id="signout" style="border:0;padding:8px 14px">Sign out</button>` : `<button class="pill ink" id="signin" style="border:0;padding:8px 14px">Sign in</button>`}</div>
      </div>
      <div class="card-block" style="margin-top:10px"><h4>Appearance</h4>
        <div class="setting"><div class="l">Theme</div><div class="segsm">${["system", "light", "dark"].map((t) => `<button data-theme="${t}" class="${state.theme === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
      </div>
      <div class="card-block" style="margin-top:10px"><h4>Preferences</h4>
        <div class="setting"><div class="l">What fits you<small>${window.Affinity.hasPrefs(state.prefs) ? "Answered · shapes the % fit together with your likes" : "14 questions about budget, size, areas, ownership and more"}</small></div></div>
        <button class="primary accent" data-prefs="1" style="margin-top:6px">${window.Affinity.hasPrefs(state.prefs) ? "Edit preferences" : "Set preferences"}</button>
      </div>
      <div class="card-block" style="margin-top:10px"><h4>Viewings</h4>
        <div class="setting"><div class="l">Weekly target<small>How many viewings to request per week</small></div><div class="segsm">${[3, 5, 8].map((n) => `<button data-target="${n}" class="${state.weeklyTarget === n ? "active" : ""}">${n}</button>`).join("")}</div></div>
        <div class="setting"><div class="l">Weekly pick<small>Opens automatically on Saturdays</small></div><button class="pill ink" data-weekly="1" style="border:0;padding:8px 14px">Open now</button></div>
        <div class="setting"><div class="l">Agent<small>${esc(CFG.agent.to[0])}</small></div><span class="pill">cc ${CFG.agent.cc.length}</span></div>
      </div>
      <div class="card-block" style="margin-top:10px"><h4>Data</h4>
        ${CFG.shortlistSheet ? `<div class="setting"><div class="l">Shortlist sheet</div><a href="${esc(CFG.shortlistSheet)}" target="_blank" rel="noopener">Open</a></div>` : ""}
        <div class="setting"><div class="l">Listings in Pand</div><span class="pill">${state.listings.length}</span></div>
        <div class="setting"><div class="l">Version</div><span class="pill">${esc(CFG.version)}</span></div>
      </div>`;
  }
  function renderMe() { const p = state.prof; const me = person(state.me); $("#me-avatar").src = (p && p.avatar_url) || me.avatar; $("#me-name").textContent = me.name; }

  /* ---------- Shell ---------- */
  function renderAll() { renderMe(); renderDeck(); renderSaved(); renderViewings(); if (state.view === "map") renderBigMap(); if (!$("#sheet").hidden) renderSheet(); if (!$("#weekly").hidden) renderWeekly(); }

  async function load() {
    const q = (t, sel, ord) => { let x = sb.from(t).select(sel || "*"); if (ord) x = x.order(ord, { ascending: false }); return x; };
    const [ls, vs, vw, ev, ph, rq, pf] = await Promise.all([q("listings", "*", "first_seen"), q("votes"), q("viewings"), q("evaluations"), q("viewing_photos"), q("viewing_requests"), sb.from("app_events").select("data").eq("key", "couple_prefs").maybeSingle()]);
    if (ls.error || vs.error) { toast("Cannot reach database"); console.error(ls.error || vs.error); return; }
    state.listings = ls.data || []; state.votes = vs.data || [];
    state.viewings = {}; (vw.data || []).forEach((v) => (state.viewings[v.listing_id] = v));
    state.evals = {}; (ev.data || []).forEach((e) => (state.evals[e.listing_id + ":" + e.who] = e));
    state.photos = {}; (ph.data || []).forEach((p) => (state.photos[p.listing_id] = state.photos[p.listing_id] || []).push(p));
    state.requests = rq.data || [];
    if (pf && pf.data && pf.data.data) state.prefs = pf.data.data;
    recomputeProfile(); renderAll(); maybeSaturday();
  }
  function maybeSaturday() {
    const day = new Date().getDay(); const wk = isoWeek(new Date());
    if ((day === 6 || day === 0) && weekCandidates().length && localStorage.getItem("weeklySeen") !== wk && $("#auth").hidden) { localStorage.setItem("weeklySeen", wk); openWeekly(); }
  }

  document.body.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#me-btn")) { openProfile(); return; }
    const tab = t.closest("[data-view]"); if (tab) { state.view = tab.dataset.view; document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === tab));
      document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + state.view)); if (state.view === "map") renderBigMap(); if (state.view === "swipe") renderDeck(); return; }
    const seg = t.closest("[data-seg]"); if (seg) { state.savedTab = seg.dataset.seg; document.querySelectorAll("#saved-seg button").forEach((b) => b.classList.toggle("active", b === seg)); renderSaved(); return; }
    const op = t.closest("[data-open]"); if (op) { openSheet(op.dataset.open); return; }
    const cl = t.closest("[data-close]"); if (cl) { $("#" + cl.dataset.close).hidden = true; if (cl.dataset.close === "eval" || cl.dataset.close === "profile") renderAll(); return; }
    if (t.closest("[data-weekly]")) { $("#profile").hidden = true; openWeekly(); return; }
    const pk = t.closest("[data-pick]"); if (pk) { const id = pk.dataset.pick; state.picks.has(id) ? state.picks.delete(id) : state.picks.add(id); renderWeekly(); return; }
    if (t.closest("#send-job")) { sendRequest("gmail"); return; } if (t.closest("#send-phone")) { sendRequest("phone"); return; }
    const vt = t.closest("[data-vote]"); if (vt && state.sheetId) { castVote(byId(state.sheetId), vt.dataset.vote); return; }
    const st = t.closest("[data-stage]"); if (st && state.sheetId) { setStage(state.sheetId, st.dataset.stage); return; }
    const ev = t.closest("[data-eval]"); if (ev) { openEval(ev.dataset.eval); return; }
    const ck = t.closest("[data-check]"); if (ck) { saveEval({ checks: { [ck.dataset.check]: !ck.classList.contains("on") } }); return; }
    const vd = t.closest("[data-v]"); if (vd && !$("#eval").hidden) { saveEval({ verdict: vd.dataset.v }); return; }
    if (t.closest("#add-photo")) { $("#photo-input").click(); return; }
    const pp = t.closest("[data-person]"); if (pp) { state.me = pp.dataset.person; localStorage.setItem("who", state.me); state.lastVote = null; saveProfile({ person: state.me }); renderProfile(); renderAll(); return; }
    const th = t.closest("[data-theme]"); if (th && !$("#profile").hidden) { applyTheme(th.dataset.theme); saveProfile({ theme: th.dataset.theme }); renderProfile(); if (state.bigmap) renderBigMap(); return; }
    const tg = t.closest("[data-target]"); if (tg) { state.weeklyTarget = +tg.dataset.target; localStorage.setItem("weeklyTarget", state.weeklyTarget); saveProfile({ prefs: { ...((state.prof || {}).prefs || {}), weeklyTarget: state.weeklyTarget } }); renderProfile(); renderViewings(); return; }
    if (t.closest("[data-prefs]")) { $("#profile").hidden = true; openPrefs(); return; }
    if (t.closest("[data-lb-close]")) { $("#lightbox").hidden = true; return; }
    const pk2 = t.closest("[data-pref-key]"); if (pk2) { const k = pk2.dataset.prefKey, v = pk2.dataset.prefVal; savePrefs({ [k]: v === "any" ? null : (isNaN(+v) ? v : +v) }); return; }
    const ar = t.closest("[data-area]"); if (ar) { const a = ar.dataset.area; const cur = (state.prefs || {}).areas || []; savePrefs({ areas: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] }); return; }
    const po = t.closest("[data-prio]"); if (po) { const k = po.dataset.prio; const old = (state.prefs || {}).priorities || []; savePrefs({ priorities: old.includes(k) ? old.filter((x) => x !== k) : old.length >= 3 ? old : [...old, k] }); return; }
    if (t.closest("#prefs-reset")) { state.prefs = {}; prefsPending = { __reset: true }; savePrefs({}); return; }
    if (t.closest("#signout")) { sb.auth.signOut(); $("#profile").hidden = true; return; }
    if (t.closest("#signin")) { $("#profile").hidden = true; showAuth(); return; }
    if (t.closest("#auth-send")) { authSend(); return; } if (t.closest("#auth-verify")) { authVerify(); return; } if (t.closest("#auth-back")) { showAuth(); return; }
    const oa = t.closest("[data-oauth]"); if (oa) { authOAuth(oa.dataset.oauth); return; }
    if (t.closest("#auth-guest")) { localStorage.setItem("guest", "1"); $("#auth").hidden = true; maybeSaturday(); return; }
  });
  document.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "auth-email") authSend(); if (e.key === "Enter" && e.target.id === "auth-code") authVerify(); });
  $("#photo-input").addEventListener("change", (e) => { addPhoto(e.target.files[0]); e.target.value = ""; });
  const topCard = () => { const c = $("#deck .card:not(.behind)"); return [c, c && byId(c.dataset.id)]; };
  $("#btn-yes").onclick = () => { const [c, l] = topCard(); if (l) fly(c, "yes", l); };
  $("#btn-no").onclick = () => { const [c, l] = topCard(); if (l) fly(c, "no", l); };
  $("#btn-info").onclick = () => { const [, l] = topCard(); if (l) openSheet(l.id); };
  $("#btn-undo").onclick = undo;
  document.addEventListener("keydown", (e) => { if (e.target.matches("input,textarea")) return; if (!$("#sheet").hidden || !$("#eval").hidden || !$("#weekly").hidden || !$("#profile").hidden || !$("#prefs").hidden) { if (e.key === "Escape") { ["sheet", "eval", "weekly", "profile", "prefs", "lightbox"].forEach((id) => ($("#" + id).hidden = true)); } return; }
    if (e.key === "ArrowRight") $("#btn-yes").click(); if (e.key === "ArrowLeft") $("#btn-no").click(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "system") applyTheme("system"); });

  let ch = sb.channel("live");
  ["votes", "listings", "viewings", "evaluations", "viewing_photos", "viewing_requests", "app_events"].forEach((t) => { ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => { clearTimeout(load._t); load._t = setTimeout(load, 300); }); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.addEventListener("focus", () => load());
  setInterval(() => { if (!document.hidden) load(); }, 30000);   // fallback if the realtime socket drops on the phone
  ch.subscribe((status) => { if (status === "SUBSCRIBED") console.log("realtime on"); });
  applyTheme(state.theme); renderMe();
  initAuth().then(load);
})();
