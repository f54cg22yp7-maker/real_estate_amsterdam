/* Pand: two people, one deck, independent votes, match on mutual like, weekly viewing pick, in-viewing evaluation. */
(function () {
  const CFG = window.APP_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  const $ = (s) => document.querySelector(s);
  const state = { listings: [], votes: [], viewings: {}, evals: {}, photos: {}, requests: [], me: localStorage.getItem("who") || CFG.people[0].id,
    view: "swipe", savedTab: "likes", lastVote: null, bigmap: null, profile: null, sheetId: null, evalId: null, picks: new Set() };
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

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2000); }
  function voteOf(id, who) { return state.votes.find((v) => v.listing_id === id && v.who === who); }
  function isMatch(l) { return CFG.people.every((p) => (voteOf(l.id, p.id) || {}).vote === "yes"); }
  function viewing(id) { return state.viewings[id]; }
  function evalOf(id, who) { return state.evals[id + ":" + who]; }
  function fit(l) { const s = window.Affinity.score(l, state.profile); return s == null ? null : s; }
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

  /* ---------- Swipe deck ---------- */
  function cardHtml(l) {
    const f = fit(l);
    return `
      <div class="photo" style="background-image:url('${esc(l.photo || "")}')">
        ${statusBadge(l)}${f != null ? `<div class="fit">${f}% fit</div>` : ""}
        <div class="stamp yes">LIKE</div><div class="stamp no">PASS</div>
        <div class="grad"></div>
        <div class="headline">
          <div class="price">${eur(l.price)}<small>${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""}</small></div>
          <div class="addr">${esc(l.street || l.address || "")}</div>
          <div class="area">${esc(window.areaFor(l.postcode))} · ${l.postcode ? esc(l.postcode.slice(0, 4) + " " + l.postcode.slice(4)) : ""}</div>
        </div>
      </div>
      <div class="body">
        <div class="chips">${chipsHtml(l)}</div>
        ${kvHtml(l)}
        <div class="summary">${esc(l.summary || (l.description_en || "").slice(0, 220) || "")}</div>
        <div class="minimap" id="mm-${l.id}"></div>
        <div class="links"><button data-open="${l.id}">Details & photos</button><a href="${esc(l.url)}" target="_blank" rel="noopener">Full listing</a></div>
      </div>`;
  }
  function mountMap(el, l, zoom) {
    if (!l.lat || !l.lng || !window.L || !el || el._map) return;
    const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, touchZoom: false, doubleClickZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#1C2B4A", fillOpacity: 1 }).addTo(m);
    m.setView([l.lat, l.lng], zoom || 14); el._map = m; setTimeout(() => m.invalidateSize(), 50);
  }
  function renderDeck() {
    const deck = $("#deck"), q = queue();
    $("#count").textContent = q.length ? `${q.length} to review` : "";
    deck.innerHTML = "";
    if (!q.length) { deck.innerHTML = `<div class="empty"><h2>All caught up</h2><div>New listings arrive every few hours. Check Saved and Viewings meanwhile.</div></div>`; $("#actions").style.visibility = "hidden"; return; }
    $("#actions").style.visibility = "visible";
    q.slice(0, 2).reverse().forEach((l, i, arr) => {
      const c = document.createElement("div"); c.className = "card" + (i < arr.length - 1 ? " behind" : ""); c.dataset.id = l.id; c.innerHTML = cardHtml(l); deck.appendChild(c);
      if (i === arr.length - 1) { attachDrag(c, l); mountMap(document.getElementById(`mm-${l.id}`), l); }
    });
  }
  function attachDrag(card, l) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false, decided = null;
    const yes = card.querySelector(".stamp.yes"), no = card.querySelector(".stamp.no");
    const onDown = (e) => { if (e.target.closest("button,a")) return; const p = e.touches ? e.touches[0] : e; sx = p.clientX; sy = p.clientY; dx = dy = 0; dragging = true; decided = null; card.style.transition = "none"; };
    const onMove = (e) => {
      if (!dragging) return; const p = e.touches ? e.touches[0] : e; dx = p.clientX - sx; dy = p.clientY - sy;
      if (decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) decided = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (decided !== "h") return; if (e.cancelable) e.preventDefault();
      card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = Math.min(1, Math.max(0, dx / 90)); no.style.opacity = Math.min(1, Math.max(0, -dx / 90));
    };
    const onUp = () => { if (!dragging) return; dragging = false; if (decided === "h" && Math.abs(dx) > 100) return fly(card, dx > 0 ? "yes" : "no", l);
      card.style.transition = "transform .25s"; card.style.transform = ""; yes.style.opacity = no.style.opacity = 0; };
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
    else if (vote === "yes" && isMatch(l)) toast(`Match with ${nameOf(other())}!`);
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
  function stagePill(id) {
    const v = viewing(id); if (!v || v.stage === "dropped") return "";
    const map = { selected: ["gold", "On the viewing list"], requested: ["gold", requestSent(v) ? "Viewing requested" : "Request pending"], scheduled: ["navy", "Viewing " + fmtDate(v.scheduled_at)], viewed: ["good", "Viewed"] };
    const [cls, txt] = map[v.stage] || ["", v.stage]; return `<span class="pill ${cls}">${esc(txt)}</span>`;
  }
  function requestSent(v) { const r = state.requests.find((r) => r.id === v.request_id); return !!(r && r.sent_at); }
  function fmtDate(iso) { if (!iso) return "date tbd"; const d = new Date(iso); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (iso.length > 10 ? " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""); }
  function rowHtml(l, note, cls) {
    const f = fit(l);
    return `<button class="row" data-open="${l.id}">
      <div class="thumb" style="background-image:url('${esc(l.photo || "")}')"></div>
      <div class="info"><div class="t1"><span>${esc(l.street || "")}</span><span>${eur(l.price)}</span></div>
      <div class="t2">${esc(window.areaFor(l.postcode))} · ${l.m2 || "?"} m² · ${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""} · ${esc(ownershipText(l)[0])}</div>
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
      || `<div class="empty"><h2>No likes yet</h2><div>Swipe right on what you would view.</div></div>`;
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
    const day = new Date().getDay();
    $("#viewings-list").innerHTML = `
      <div class="weekly-card"><h3>Weekly pick</h3>
        <p>${cands.length ? `${cands.length} candidate${cands.length > 1 ? "s" : ""} this week (${cands.filter(isMatch).length} match${cands.filter(isMatch).length === 1 ? "" : "es"}). Choose about ${CFG.weeklyTarget} and Pand emails the agent.` : "No new likes this week yet. The pick opens every Saturday."}${day === 6 ? " It is Saturday: pick day." : ""}</p>
        <button data-weekly="1" ${cands.length ? "" : "disabled"}>Choose viewings</button></div>
      ${sec("requested", "Requested", (v) => requestSent(v) ? `Email sent · waiting for the agent` : `Email goes out at the next job run`)}
      ${sec("scheduled", "Scheduled", (v) => `Viewing on ${esc(fmtDate(v.scheduled_at))} · open to evaluate`)}
      ${sec("viewed", "Viewed", (v) => verdictLine(v.listing_id))}
      ${inPipe.length ? "" : `<div class="section-h">Pipeline</div><div class="card-block" style="color:var(--muted)">Requested, scheduled and viewed apartments show up here.</div>`}`;
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
      <p style="margin:6px 2px 10px;color:var(--muted);font-size:13.5px">Everything liked in the last 7 days. Matches are pre-selected. Tap to include or exclude, then send the request to Dames van Vermeer.</p>
      <div class="stack">${cands.map((l) => { const th = voteOf(l.id, other()), me = voteOf(l.id, state.me);
        const who = isMatch(l) ? "♥ Match" : me && me.vote === "yes" ? `You liked · ${th ? nameOf(other()) + " passed" : "waiting for " + nameOf(other())}` : `${nameOf(other())} liked`;
        return `<div class="pick ${state.picks.has(l.id) ? "on" : ""}" data-pick="${l.id}"><div class="box"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div>
          <div class="thumb" style="background-image:url('${esc(l.photo || "")}')"></div>
          <div class="info"><div class="t1">${esc(l.street)} · ${eur(l.price)}</div><div class="t2">${esc(who)} · ${l.m2} m² · ${esc(ownershipText(l)[0])}${fit(l) != null ? " · " + fit(l) + "% fit" : ""}</div></div></div>`; }).join("")}</div>
      <div class="counter"><span>Selected</span><span><b>${n}</b> / about ${CFG.weeklyTarget} per week</span></div>
      <div class="card-block"><h4>Availability (optional, replaces the default sentence)</h4><textarea id="avail" placeholder="${esc(defaultAvailability())}"></textarea></div>
      <div class="card-block"><h4>Email preview</h4><div class="preview" id="preview">${esc(emailBody([...state.picks].map(byId).filter(Boolean), ""))}</div></div>
      <div class="stack" style="margin-top:12px">
        <button class="primary" id="send-job" ${n ? "" : "disabled"}>Send request from Pand (Gmail, next job run)</button>
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
    const r1 = await sb.from("viewing_requests").insert(req); if (r1.error) { console.error(r1.error); return toast("Could not save the request. Did you run schema.sql?"); }
    const r2 = await sb.from("viewings").upsert(rows, { onConflict: "listing_id" }); if (r2.error) { console.error(r2.error); return toast("Saved request, but viewings failed"); }
    state.requests.push(req); rows.forEach((r) => (state.viewings[r.listing_id] = r)); state.picks.clear();
    if (via === "phone") {
      const week = isoWeek(new Date()).split("-W")[1];
      const href = `mailto:${CFG.agent.to.join(",")}?cc=${encodeURIComponent(CFG.agent.cc.join(","))}&subject=${encodeURIComponent(`Week ${+week} listings: viewing request`)}&body=${encodeURIComponent(emailBody(ids.map(byId).filter(Boolean), avail))}`;
      window.location.href = href; toast("Opening Mail with the request");
    } else toast("Request queued. Pand emails the agent at the next run (within 3 hours).");
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
    const photos = (l.photos && l.photos.length ? l.photos : [l.photo]).filter(Boolean);
    const stepIdx = stage ? STAGES.indexOf(stage) : -1;
    $("#sheet-body").innerHTML = `
      <div class="gallery">${photos.map((p) => `<img src="${esc(p)}" loading="lazy" alt="">`).join("")}</div>
      <div class="detail-price">${eur(l.price)}<small>${l.price_per_m2 ? eur(l.price_per_m2) + "/m²" : ""}${fit(l) != null ? " · " + fit(l) + "% fit" : ""}</small></div>
      <div class="detail-addr">${esc(l.address || "")}</div>
      <div class="detail-area">${esc(window.areaFor(l.postcode))} · ${esc(l.status || "available")}${l.listed_since ? " · listed " + esc(l.listed_since) : ""}</div>
      <div class="chips">${chipsHtml(l)}</div>
      <div class="stack">
        <div class="card-block"><h4>Your vote</h4><div class="vote-row">
          <button class="yes ${me === "yes" ? "on" : ""}" data-vote="yes">♥ Like</button><button class="no ${me === "no" ? "on" : ""}" data-vote="no">✕ Pass</button></div>
          <div class="people-scores"><span><img src="${esc(person(other()).avatar)}" alt="">${esc(nameOf(other()))}: ${th ? (th.vote === "yes" ? "liked" : "passed") : "not yet"}</span>${isMatch(l) ? `<span class="pill gold">♥ Match</span>` : ""}</div></div>
        <div class="card-block"><h4>Viewing</h4>
          ${stage ? `<div class="stage"><span style="font-weight:700">${esc({ selected: "On the viewing list", requested: requestSent(v) ? "Requested, waiting for the agent" : "Request queued for the next email", scheduled: "Scheduled " + fmtDate(v.scheduled_at), viewed: "Viewed" }[stage])}</span><span class="steps">${STAGES.map((s, i) => `<i class="${i <= stepIdx ? "on" : ""}"></i>`).join("")}</span></div>` : `<div style="color:var(--muted);font-size:13.5px;margin-bottom:8px">Not on the viewing list. Add it and it appears in the weekly pick.</div>`}
          <div class="stack" style="margin-top:10px">
            ${!stage ? `<button class="primary" data-stage="selected">Add to viewing list</button>` : ""}
            ${stage && stage !== "viewed" ? `<label style="font-size:13px;color:var(--muted)">Viewing date and time</label><input type="datetime-local" id="sched" value="${v.scheduled_at ? esc(v.scheduled_at.slice(0, 16)) : ""}"><button class="primary secondary" data-stage="scheduled">Save date</button>` : ""}
            ${stage ? `<button class="primary" data-eval="${l.id}">${stage === "viewed" ? "Open evaluation" : "Start viewing evaluation"}</button>` : ""}
            ${stage ? `<button class="primary danger" data-stage="dropped">Remove from viewings</button>` : ""}
          </div>
          ${stage === "viewed" ? `<div class="people-scores" style="margin-top:10px">${verdictLine(l.id)}</div>` : ""}
        </div>
        <div class="card-block"><h4>Facts</h4>${kvHtml(l)}<div class="summary" style="margin:0">${esc(l.summary || "")}</div></div>
        ${l.description_en ? `<div class="card-block"><h4>Description</h4><div class="desc clamp" id="desc">${esc(l.description_en)}</div><button class="linkbtn" id="desc-more">Read more</button></div>` : ""}
        ${l.features && Object.keys(l.features).length ? `<div class="card-block"><h4>All features</h4><div class="kv">${Object.entries(l.features).slice(0, 40).map(([k, val]) => `<div><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join("")}</div></div>` : ""}
        <div class="card-block"><h4>Location</h4><div class="minimap" id="sheet-map"></div>
          <div class="links"><a href="${esc(l.url)}" target="_blank" rel="noopener">Full listing</a><a href="https://maps.apple.com/?q=${encodeURIComponent(l.address || "")}&ll=${l.lat},${l.lng}" target="_blank" rel="noopener">Open in Maps</a></div></div>
      </div>`;
    mountMap($("#sheet-map"), l, 15);
    const more = $("#desc-more"); if (more) more.onclick = () => { $("#desc").classList.toggle("clamp"); more.textContent = $("#desc").classList.contains("clamp") ? "Read more" : "Show less"; };
  }
  async function setStage(id, stage) {
    const now = new Date().toISOString(); const prev = viewing(id) || {};
    const row = { listing_id: id, stage, selected_by: prev.selected_by || state.me, request_id: prev.request_id || null, scheduled_at: prev.scheduled_at || null, notes: prev.notes || null, updated_at: now };
    if (stage === "scheduled") { const val = ($("#sched") || {}).value; if (!val) return toast("Pick a date first"); row.scheduled_at = new Date(val).toISOString(); }
    if (stage === "selected") row.selected_at = now;
    state.viewings[id] = row; renderAll(); if (!$("#sheet").hidden) renderSheet();
    const { error } = await sb.from("viewings").upsert(row, { onConflict: "listing_id" });
    if (error) { console.error(error); toast("Could not save. Did you run schema.sql?"); } else toast({ selected: "Added to the viewing list", scheduled: "Viewing scheduled", dropped: "Removed", viewed: "Marked as viewed" }[stage] || "Saved");
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
        <div class="card-block"><h4>Scores · you as ${esc(nameOf(state.me))}${theirs ? ` · <span style="color:var(--khaki)">●</span> ${esc(nameOf(other()))}` : ""}</h4>
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
    state.evals[key] = next;
    if (patch.notes === undefined) renderEvalLight();
    $("#eval-saved").textContent = "Saving…"; clearTimeout(evalTimer);
    evalTimer = setTimeout(async () => {
      const { error } = await sb.from("evaluations").upsert(next, { onConflict: "listing_id,who" });
      $("#eval-saved").textContent = error ? "Not saved" : "Saved"; if (error) console.error(error);
      const v = viewing(id); if (!error && (!v || v.stage !== "viewed")) { const now = new Date().toISOString(); const row = { ...(v || { listing_id: id, selected_by: state.me }), listing_id: id, stage: "viewed", updated_at: now }; state.viewings[id] = row; await sb.from("viewings").upsert(row, { onConflict: "listing_id" }); renderViewings(); }
    }, 500);
  }
  function renderEvalLight() { const notes = $("#eval-notes"); const pos = notes ? notes.selectionStart : 0; renderEval(); const n2 = $("#eval-notes"); if (n2 && document.activeElement !== n2) return; if (n2) n2.setSelectionRange(pos, pos); }
  function photoUrl(path) { return sb.storage.from("viewing-photos").getPublicUrl(path).data.publicUrl; }
  async function addPhoto(file) {
    if (!file) return; toast("Uploading photo…");
    const blob = await downscale(file, 1600); const id = state.evalId; const path = `${id}/${Date.now()}-${state.me}.jpg`;
    const up = await sb.storage.from("viewing-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) { console.error(up.error); return toast("Upload failed. Is the viewing-photos bucket created (schema.sql)?"); }
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

  /* ---------- Map ---------- */
  function renderBigMap() {
    if (!window.L) return;
    if (!state.bigmap) { state.bigmap = L.map("bigmap", { zoomControl: false }).setView([52.3676, 4.9041], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.bigmap); state.bigmap._layer = L.layerGroup().addTo(state.bigmap); }
    const g = state.bigmap._layer; g.clearLayers();
    state.listings.filter((l) => l.lat && l.lng && !HIDDEN.has(l.status)).forEach((l) => {
      const me = (voteOf(l.id, state.me) || {}).vote, th = (voteOf(l.id, other()) || {}).vote; let color = "#B9B3A3";
      if (me === "yes" && th === "yes") color = "#B8973F"; else if (me === "yes") color = "#1C2B4A"; else if (th === "yes") color = "#8C8664"; else if (me === "no") return;
      L.circleMarker([l.lat, l.lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: .95 })
        .bindPopup(`<b>${esc(l.street)}</b><br>${eur(l.price)} · ${l.m2} m²<br><a href="#" onclick="window.__open('${l.id}');return false">Details</a> · <a href="${esc(l.url)}" target="_blank">Listing</a>`).addTo(g);
    });
    setTimeout(() => state.bigmap.invalidateSize(), 50);
  }
  window.__open = openSheet;

  /* ---------- Shell ---------- */
  function renderWho() { $("#who").innerHTML = CFG.people.map((p) => `<button data-who="${p.id}" class="${p.id === state.me ? "active" : ""}"><img src="${esc(p.avatar)}" alt=""><span>${esc(p.name)}</span></button>`).join(""); }
  function renderAll() { renderWho(); renderDeck(); renderSaved(); renderViewings(); if (state.view === "map") renderBigMap(); if (!$("#sheet").hidden) renderSheet(); if (!$("#weekly").hidden) renderWeekly(); }

  async function load() {
    const q = (t, sel, ord) => { let x = sb.from(t).select(sel || "*"); if (ord) x = x.order(ord, { ascending: false }); return x; };
    const [ls, vs, vw, ev, ph, rq] = await Promise.all([q("listings", "*", "first_seen"), q("votes"), q("viewings"), q("evaluations"), q("viewing_photos"), q("viewing_requests")]);
    if (ls.error || vs.error) { toast("Cannot reach database"); console.error(ls.error || vs.error); return; }
    state.listings = ls.data || []; state.votes = vs.data || [];
    state.viewings = {}; (vw.data || []).forEach((v) => (state.viewings[v.listing_id] = v));
    state.evals = {}; (ev.data || []).forEach((e) => (state.evals[e.listing_id + ":" + e.who] = e));
    state.photos = {}; (ph.data || []).forEach((p) => (state.photos[p.listing_id] = state.photos[p.listing_id] || []).push(p));
    state.requests = rq.data || [];
    if (vw.error || ev.error) console.warn("v2 tables missing, run supabase/schema.sql", vw.error || ev.error);
    recomputeProfile(); renderAll(); maybeSaturday();
  }
  function maybeSaturday() {
    const day = new Date().getDay(); const wk = isoWeek(new Date());
    if ((day === 6 || day === 0) && weekCandidates().length && localStorage.getItem("weeklySeen") !== wk) { localStorage.setItem("weeklySeen", wk); openWeekly(); }
  }

  document.body.addEventListener("click", (e) => {
    const t = e.target;
    const w = t.closest("[data-who]"); if (w) { state.me = w.dataset.who; localStorage.setItem("who", state.me); state.lastVote = null; renderAll(); return; }
    const tab = t.closest("[data-view]"); if (tab) { state.view = tab.dataset.view; document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === tab));
      document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + state.view)); if (state.view === "map") renderBigMap(); if (state.view === "swipe") renderDeck(); return; }
    const seg = t.closest("[data-seg]"); if (seg) { state.savedTab = seg.dataset.seg; document.querySelectorAll("#saved-seg button").forEach((b) => b.classList.toggle("active", b === seg)); renderSaved(); return; }
    const op = t.closest("[data-open]"); if (op) { openSheet(op.dataset.open); return; }
    const cl = t.closest("[data-close]"); if (cl) { $("#" + cl.dataset.close).hidden = true; if (cl.dataset.close === "eval") renderAll(); return; }
    if (t.closest("[data-weekly]")) { openWeekly(); return; }
    const pk = t.closest("[data-pick]"); if (pk) { const id = pk.dataset.pick; state.picks.has(id) ? state.picks.delete(id) : state.picks.add(id); renderWeekly(); return; }
    if (t.closest("#send-job")) { sendRequest("gmail"); return; } if (t.closest("#send-phone")) { sendRequest("phone"); return; }
    const vt = t.closest("[data-vote]"); if (vt && state.sheetId) { castVote(byId(state.sheetId), vt.dataset.vote); return; }
    const st = t.closest("[data-stage]"); if (st && state.sheetId) { setStage(state.sheetId, st.dataset.stage); return; }
    const ev = t.closest("[data-eval]"); if (ev) { openEval(ev.dataset.eval); return; }
    const ck = t.closest("[data-check]"); if (ck) { saveEval({ checks: { [ck.dataset.check]: !ck.classList.contains("on") } }); return; }
    const vd = t.closest("[data-v]"); if (vd && !$("#eval").hidden) { saveEval({ verdict: vd.dataset.v }); return; }
    if (t.closest("#add-photo")) { $("#photo-input").click(); return; }
  });
  $("#photo-input").addEventListener("change", (e) => { addPhoto(e.target.files[0]); e.target.value = ""; });
  const topCard = () => { const c = $("#deck .card:not(.behind)"); return [c, c && byId(c.dataset.id)]; };
  $("#btn-yes").onclick = () => { const [c, l] = topCard(); if (l) fly(c, "yes", l); };
  $("#btn-no").onclick = () => { const [c, l] = topCard(); if (l) fly(c, "no", l); };
  $("#btn-info").onclick = () => { const [, l] = topCard(); if (l) openSheet(l.id); };
  $("#btn-undo").onclick = undo;
  document.addEventListener("keydown", (e) => { if (!$("#sheet").hidden || !$("#eval").hidden || !$("#weekly").hidden) { if (e.key === "Escape") { $("#sheet").hidden = $("#eval").hidden = $("#weekly").hidden = true; } return; }
    if (e.key === "ArrowRight") $("#btn-yes").click(); if (e.key === "ArrowLeft") $("#btn-no").click(); });

  let ch = sb.channel("live");
  ["votes", "listings", "viewings", "evaluations", "viewing_photos", "viewing_requests"].forEach((t) => { ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => { clearTimeout(load._t); load._t = setTimeout(load, 300); }); });
  ch.subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  renderWho(); load();
})();
