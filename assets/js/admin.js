/* MBZ Cup 2026 - Admin Panel (static, generates matches.csv for upload) */
(() => {
  "use strict";

  // ====== EDIT PIN HERE (numbers only) ======
  const ADMIN_PIN = "2026";

  // ====== Helpers ======
  const qs = (s) => document.querySelector(s);
  const escapeCSV = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  function parseCSV(text){
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      const next = text[i+1];
      if(inQuotes){
        if(ch === '"' && next === '"'){ cur += '"'; i++; continue; }
        if(ch === '"'){ inQuotes = false; continue; }
        cur += ch;
      }else{
        if(ch === '"'){ inQuotes = true; continue; }
        if(ch === ','){ row.push(cur); cur=""; continue; }
        if(ch === '\n'){ row.push(cur); rows.push(row); row=[]; cur=""; continue; }
        if(ch === '\r'){ continue; }
        cur += ch;
      }
    }
    row.push(cur); rows.push(row);
    if(rows.length && rows[rows.length-1].length===1 && rows[rows.length-1][0].trim()===""){ rows.pop(); }
    const headers = (rows.shift() || []).map(h => h.trim());
    return rows.map(r => {
      const o = {};
      headers.forEach((h, idx) => o[h] = (r[idx] ?? "").trim());
      return o;
    });
  }

  async function fetchText(url){
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "v=" + Date.now(), { cache:"no-store" });
    if(!res.ok) throw new Error("فشل تحميل: " + url);
    return await res.text();
  }

  function uniq(arr){
    return Array.from(new Set(arr.map(x => String(x||"").trim()).filter(Boolean)));
  }

  function formatListFromMap(map){
    // map: name -> count
    const items = Object.entries(map)
      .filter(([n,c]) => n && c>0)
      .sort((a,b)=> a[0].localeCompare(b[0],'ar'));
    if(!items.length) return "";
    // "Name (2)، Name2 (1)"
    return items.map(([n,c]) => c===1 ? `${n} (1)` : `${n} (${c})`).join("، ");
  }

  function parseListToMap(text){
    // Accept: "Name (2)، Name2 (1)" or "Name, Name2"
    const s = String(text||"").trim();
    const map = {};
    if(!s) return map;
    const parts = s.split(/[,;|\n،]+/).map(x=>x.trim()).filter(Boolean);
    for(const p of parts){
      const m = p.match(/^(.+?)\s*\((\d+)\)\s*$/);
      if(m){
        const name = m[1].trim();
        const c = parseInt(m[2],10);
        if(name) map[name] = (map[name]||0) + (isNaN(c)?1:c);
      }else{
        map[p] = (map[p]||0) + 1;
      }
    }
    return map;
  }

  // ====== State ======
  let roster = {};          // team -> {group, players:[{number,name}]}
  let matches = [];
let awards = null;         // array of objects from CSV
  let headers = [];         // csv headers
  let current = null;       // current match object reference
  let originalSnapshot = ""; // for reset

  // scorers/cards maps & history for undo
  let goalsMap1 = {}, goalsMap2 = {};
  let yellowMap1 = {}, redMap1 = {}, yellowMap2 = {}, redMap2 = {};
  let history = []; // {type, side, name, cardType?}

  // ====== UI ======
  function setMsg(id, text, isError=false){
    const el = qs(id);
    if(!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    if(isError) el.style.background = "rgba(255,0,0,.15)";
  }

  function hideMsg(id){
    const el = qs(id);
    if(el) el.classList.add("hidden");
  }

  function fillSelect(el, items, placeholder) {
    if (typeof el === "string") el = qs(el);
    if (!el) return;
    el.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = placeholder || '—';
    el.appendChild(o0);

    (items || []).forEach(it => {
      const o = document.createElement('option');
      if (typeof it === 'string') {
        o.value = it;
        o.textContent = it;
      } else {
        o.value = (it && it.value != null) ? String(it.value) : '';
        o.textContent = (it && it.label != null) ? String(it.label) : String(it.value || '');
      }
      el.appendChild(o);
    });
  }
  function setStatus(text){
    const el = qs("#dataStatus");
    if(el) el.textContent = text;
  }

  function updatePreview(){
    qs("#goalsPreview1").textContent = formatListFromMap(goalsMap1) || "—";
    qs("#goalsPreview2").textContent = formatListFromMap(goalsMap2) || "—";
    const c1 = [];
    const y1 = formatListFromMap(yellowMap1);
    const r1 = formatListFromMap(redMap1);
    if(y1) c1.push("🟨 " + y1);
    if(r1) c1.push("🟥 " + r1);
    qs("#cardsPreview1").textContent = c1.length ? c1.join(" | ") : "—";

    const c2 = [];
    const y2 = formatListFromMap(yellowMap2);
    const r2 = formatListFromMap(redMap2);
    if(y2) c2.push("🟨 " + y2);
    if(r2) c2.push("🟥 " + r2);
    qs("#cardsPreview2").textContent = c2.length ? c2.join(" | ") : "—";
  }

  function buildCSV(){
    // Ensure required columns exist
    const required = [
      "match_code","group","round","date","time","team1","team2","score1","score2",
      "referee1","referee2","commentator","player_of_match",
      "goals_team1","goals_team2","var_team1","var_team2",
      "yellow_team1","red_team1","yellow_team2","red_team2"
    ];
    required.forEach(h => { if(!headers.includes(h)) headers.push(h); });

    const lines = [];
    lines.push(headers.join(","));
    for(const m of matches){
      const row = headers.map(h => escapeCSV(m[h] ?? ""));
      lines.push(row.join(","));
    }
    return lines.join("\n");
  }

  function refreshCSVOut(){
    const out = buildCSV();
    qs("#csvOut").value = out;
  }

  function setupMatchDropdown(){
    const list = matches
      .map(m => ({
        id: m.match_code || "",
        label: `${m.match_code || ""} — ${m.group || ""} — ${(m.team1||"")} × ${(m.team2||"")}`
      }))
      .filter(x => x.id);
    const sel = qs("#matchSelect");
    sel.innerHTML = "";
    list.forEach(x => {
      const o = document.createElement("option");
      o.value = x.id;
      o.textContent = x.label;
      sel.appendChild(o);
    });
  }

  function rosterPlayers(team){
    const t = roster[team];
    if(!t) return [];
    return (t.players || [])
      .filter(p => p && p.name)
      .map(p => ({
        value: p.name,
        label: (p.number ? (p.number + ' — ' + p.name) : p.name)
      }));
  }

  function setupPlayerDropdowns(){
    if(!current) return;
    const team1 = current.team1 || "";
    const team2 = current.team2 || "";
    const p1 = rosterPlayers(team1);
    const p2 = rosterPlayers(team2);

    fillSelect("#player", p1.concat(p2), "اختر لاعب");
    fillSelect("#pom", p1.concat(p2), "أفضل لاعب");

    fillSelect("#cardPlayer", p1.concat(p2), "اختر لاعب");

    // Side select: team1/team2
    fillSelect("#side", [`الفريق 1 — ${team1}`, `الفريق 2 — ${team2}`], "اختر الفريق");
    fillSelect("#cardSide", [`الفريق 1 — ${team1}`, `الفريق 2 — ${team2}`], "اختر الفريق");
  }

  function setupStaffDropdowns(){
    const refs = uniq(matches.flatMap(m => [m.referee1, m.referee2]));
    const comms = uniq(matches.map(m => m.commentator));
    fillSelect("#ref1", refs, "حكم 1");
    fillSelect("#ref2", refs, "حكم 2");
    fillSelect("#commentator", comms, "معلق");
  }

  function loadMatchById(id){
    const m = matches.find(x => (x.match_code||"") === id);
    if(!m) { setMsg("#panelMsg", "لم أجد هذه المباراة.", true); return; }
    current = m;
    hideMsg("#panelMsg");

    // snapshot (for reset)
    originalSnapshot = JSON.stringify(m);

    // Fill basic fields
    qs("#score1").value = (m.score1 ?? "");
    qs("#score2").value = (m.score2 ?? "");
    qs("#var1").value = (m.var_team1 ?? "0");
    qs("#var2").value = (m.var_team2 ?? "0");

    setupStaffDropdowns();

    qs("#ref1").value = (m.referee1 ?? "");
    qs("#ref2").value = (m.referee2 ?? "");
    qs("#commentator").value = (m.commentator ?? "");

    // roster-based dropdowns
    setupPlayerDropdowns();
    qs("#pom").value = (m.player_of_match ?? "");

    // Parse scorers/cards into maps
    goalsMap1 = parseListToMap(m.goals_team1 || "");
    goalsMap2 = parseListToMap(m.goals_team2 || "");
    yellowMap1 = parseListToMap(m.yellow_team1 || "");
    redMap1 = parseListToMap(m.red_team1 || "");
    yellowMap2 = parseListToMap(m.yellow_team2 || "");
    redMap2 = parseListToMap(m.red_team2 || "");
    history = [];
    updatePreview();

    // meta
    const meta = `${m.group || ""} • الجولة: ${m.round || ""} • ${m.date || ""} • ${m.time || ""}<br>${m.team1 || ""} × ${m.team2 || ""}`;
    qs("#matchMeta").innerHTML = meta;

    setStatus("جاهز");
  }

  function applyMapsToCurrent(){
    if(!current) return;
    current.goals_team1 = formatListFromMap(goalsMap1);
    current.goals_team2 = formatListFromMap(goalsMap2);
    current.yellow_team1 = formatListFromMap(yellowMap1);
    current.red_team1 = formatListFromMap(redMap1);
    current.yellow_team2 = formatListFromMap(yellowMap2);
    current.red_team2 = formatListFromMap(redMap2);
  }

  function saveRow(){
    if(!current) return;
    current.score1 = qs("#score1").value.trim();
    current.score2 = qs("#score2").value.trim();
    current.var_team1 = qs("#var1").value.trim() || "0";
    current.var_team2 = qs("#var2").value.trim() || "0";
    current.referee1 = qs("#ref1").value.trim();
    current.referee2 = qs("#ref2").value.trim();
    current.commentator = qs("#commentator").value.trim();
    current.player_of_match = qs("#pom").value.trim();

    applyMapsToCurrent();
    refreshCSVOut();
    setMsg("#panelMsg", "تم حفظ التعديلات داخل اللوحة. الآن نزّل matches.csv وارفعه إلى GitHub.", false);
  }

  function resetRow(){
    if(!current) return;
    const snap = JSON.parse(originalSnapshot || "{}");
    Object.keys(snap).forEach(k => current[k] = snap[k]);
    loadMatchById(current.match_code);
    refreshCSVOut();
    hideMsg("#panelMsg");
  }

  function sideToIndex(sideText){
    if(!sideText) return null;
    return sideText.startsWith("الفريق 2") ? 2 : 1;
  }

  function addGoal(){
    if(!current) return;
    const side = qs("#side").value;
    const name = qs("#player").value.trim();
    if(!side || !name) return;
    const idx = sideToIndex(side);
    const map = idx===1 ? goalsMap1 : goalsMap2;
    map[name] = (map[name]||0) + 1;
    history.push({type:"goal", idx, name});
    updatePreview();
  }

  function undoGoal(){
    for(let i=history.length-1;i>=0;i--){
      const h = history[i];
      if(h.type==="goal"){
        const map = h.idx===1 ? goalsMap1 : goalsMap2;
        map[h.name] = Math.max(0, (map[h.name]||0)-1);
        if(map[h.name]===0) delete map[h.name];
        history.splice(i,1);
        break;
      }
    }
    updatePreview();
  }

  function clearGoals(){
    goalsMap1 = {}; goalsMap2 = {};
    history = history.filter(h => h.type!=="goal");
    updatePreview();
  }

  function addCard(cardType){
    if(!current) return;
    const side = qs("#cardSide").value;
    const name = qs("#cardPlayer").value.trim();
    if(!side || !name) return;
    const idx = sideToIndex(side);
    const isYellow = cardType==="yellow";
    const map = idx===1 ? (isYellow?yellowMap1:redMap1) : (isYellow?yellowMap2:redMap2);
    map[name] = (map[name]||0) + 1;
    history.push({type:"card", idx, name, cardType});
    updatePreview();
  }

  function undoCard(){
    for(let i=history.length-1;i>=0;i--){
      const h = history[i];
      if(h.type==="card"){
        const isYellow = h.cardType==="yellow";
        const map = h.idx===1 ? (isYellow?yellowMap1:redMap1) : (isYellow?yellowMap2:redMap2);
        map[h.name] = Math.max(0, (map[h.name]||0)-1);
        if(map[h.name]===0) delete map[h.name];
        history.splice(i,1);
        break;
      }
    }
    updatePreview();
  }

  function clearCards(){
    yellowMap1 = {}; redMap1 = {}; yellowMap2 = {}; redMap2 = {};
    history = history.filter(h => h.type!=="card");
    updatePreview();
  }

  function downloadCSV(){
    const text = qs("#csvOut").value || buildCSV();
    const blob = new Blob([text], { type:"text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "matches.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 250);
  }

  async function copyCSV(){
    const text = qs("#csvOut").value || buildCSV();
    try{
      await navigator.clipboard.writeText(text);
      setMsg("#panelMsg","تم نسخ CSV. الآن افتح GitHub والصقه داخل data/matches.csv ثم Commit.", false);
    }catch{
      setMsg("#panelMsg","لم أستطع النسخ تلقائيًا. استخدم مربع النص وانسخ يدويًا.", true);
    }
  }

  // ====== Boot ======
  async function init(){
    // Gate
    qs("#btnLogin").addEventListener("click", () => {
      const pin = qs("#pin").value.trim();
      if(pin === ADMIN_PIN){
        qs("#gate").classList.add("hidden");
        qs("#panel").classList.remove("hidden");
        startPanel().catch(err => setMsg("#panelMsg", String(err), true));
      }else{
        setMsg("#gateMsg", "PIN غير صحيح.", true);
      }
    });

    qs("#pin").addEventListener("keydown", (e) => {
      if(e.key === "Enter") qs("#btnLogin").click();
    });
  }

  
    // Awards panel
    function setupAwardsPanel() {
      const elJson = document.querySelector("#awardsJson");
      const btnSave = document.querySelector("#btnSaveAwards");
      const btnDl = document.querySelector("#btnDownloadAwards");
      if (!elJson || !btnSave || !btnDl) return;

      const teams = Object.keys(roster || {});
      const players = (staffAll || []).filter(x => (x.role || "").includes("لاعب")).map(x => ({ value: x.name, label: `${x.name} — ${x.team}` }));
      const admins = (staffAll || []).filter(x => (x.role || "").includes("إداري")).map(x => ({ value: x.name, label: `${x.name} — ${x.team}` }));

      const teamOpts = teams.map(t => ({ value: t, label: t }));
      fillSelect("#aw_champion_team", teamOpts, "اختر الفريق");
      fillSelect("#aw_runnerup_team", teamOpts, "اختر الفريق");
      fillSelect("#aw_third_team", teamOpts, "اختر الفريق");
      fillSelect("#aw_fourth_team", teamOpts, "اختر الفريق");

      fillSelect("#aw_top_scorer", players, "اختر لاعب");
      fillSelect("#aw_best_player", players, "اختر لاعب");
      fillSelect("#aw_best_keeper", players, "اختر لاعب");
      fillSelect("#aw_best_admin", admins.length ? admins : players, "اختر إداري");

      // load existing from localStorage
      try {
        const saved = localStorage.getItem("mbz_awards");
        if (saved) {
          awards = JSON.parse(saved);
          if (awards && awards.teams) {
            document.querySelector("#aw_champion_team").value = awards.teams.champion || "";
            document.querySelector("#aw_runnerup_team").value = awards.teams.runnerup || "";
            document.querySelector("#aw_third_team").value = awards.teams.third || "";
            document.querySelector("#aw_fourth_team").value = awards.teams.fourth || "";
          }
          if (awards && awards.individual) {
            document.querySelector("#aw_top_scorer").value = awards.individual.top_scorer?.name || "";
            document.querySelector("#aw_best_player").value = awards.individual.best_player?.name || "";
            document.querySelector("#aw_best_keeper").value = awards.individual.best_keeper?.name || "";
            document.querySelector("#aw_best_admin").value = awards.individual.best_admin?.name || "";
          }
        }
      } catch(e) {}

      function buildAwards() {
        const champion = document.querySelector("#aw_champion_team").value || "";
        const runnerup = document.querySelector("#aw_runnerup_team").value || "";
        const third = document.querySelector("#aw_third_team").value || "";
        const fourth = document.querySelector("#aw_fourth_team").value || "";

        const topScorer = document.querySelector("#aw_top_scorer").value || "";
        const bestPlayer = document.querySelector("#aw_best_player").value || "";
        const bestKeeper = document.querySelector("#aw_best_keeper").value || "";
        const bestAdmin = document.querySelector("#aw_best_admin").value || "";

        const lookup = (name) => (staffAll || []).find(x => x.name === name) || null;

        return {
          updated_at: new Date().toISOString(),
          teams: { champion, runnerup, third, fourth },
          individual: {
            top_scorer: topScorer ? { name: topScorer, team: lookup(topScorer)?.team || "" } : { name: "", team: "" },
            best_player: bestPlayer ? { name: bestPlayer, team: lookup(bestPlayer)?.team || "" } : { name: "", team: "" },
            best_keeper: bestKeeper ? { name: bestKeeper, team: lookup(bestKeeper)?.team || "" } : { name: "", team: "" },
            best_admin: bestAdmin ? { name: bestAdmin, team: lookup(bestAdmin)?.team || "" } : { name: "", team: "" }
          }
        };
      }

      function refreshJson() {
        awards = buildAwards();
        elJson.value = JSON.stringify(awards, null, 2);
      }

      btnSave.addEventListener("click", () => {
        refreshJson();
        try { localStorage.setItem("mbz_awards", elJson.value); } catch(e) {}
        alert("تم حفظ الجوائز داخل اللوحة.");
      });

      btnDl.addEventListener("click", () => {
        refreshJson();
        downloadText("awards.json", elJson.value);
      });

      // initial
      refreshJson();
    }

async function startPanel(){
    setStatus("تحميل…");
    // Load roster
    const rosterText = await fetchText("data/roster.json");
    roster = JSON.parse(rosterText);

    // Load matches
    const csvText = await fetchText("data/matches.csv");
    const rows = parseCSV(csvText);

    headers = Object.keys(rows[0] || {});
    matches = rows;

    // Ensure match_code exists
    matches = matches.filter(m => (m.match_code||"").trim() !== "");

    setupMatchDropdown();
    refreshCSVOut();
    setStatus("جاهز");

    // Default load first match
    const firstId = qs("#matchSelect").value;
    if(firstId) loadMatchById(firstId);

    // Wire buttons
    qs("#btnLoadMatch").addEventListener("click", () => loadMatchById(qs("#matchSelect").value));
    qs("#btnSaveRow").addEventListener("click", saveRow);
    qs("#btnResetRow").addEventListener("click", resetRow);

    qs("#btnGoal").addEventListener("click", addGoal);
    qs("#btnUndoGoal").addEventListener("click", undoGoal);
    qs("#btnClearGoals").addEventListener("click", clearGoals);

    qs("#btnYellow").addEventListener("click", () => addCard("yellow"));
    qs("#btnRed").addEventListener("click", () => addCard("red"));
    qs("#btnUndoCard").addEventListener("click", undoCard);
    qs("#btnClearCards").addEventListener("click", clearCards);

    qs("#btnDownload").addEventListener("click", downloadCSV);
    qs("#btnCopy").addEventListener("click", copyCSV);
  }

  document.addEventListener("DOMContentLoaded", init);
})();setupAwardsPanel();

    
