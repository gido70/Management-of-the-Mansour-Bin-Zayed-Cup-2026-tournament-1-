
(function(){
  function safeText(s){ return (s===null||s===undefined)?'—':String(s); }

  function renderStandingsTable(tbody, standings){
    tbody.innerHTML = "";
    standings.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td>${safeText(row.team)}</td>
        <td>${row.played}</td>
        <td>${row.wins}</td>
        <td>${row.draws}</td>
        <td>${row.losses}</td>
        <td>${row.gf}</td>
        <td>${row.ga}</td>
        <td>${row.gd}</td>
        <td>${row.points}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadCSV(path){
    const res = await fetch(path, {cache:"no-store"});
    if(!res.ok) throw new Error("تعذر تحميل الملف: "+path);
    const text = await res.text();
    return CupApp.parseCSV(text);
  }

  CupApp.initGroupsAll = async function(){
    const errEl = document.getElementById("loadError");
    try{
      const matches = await loadCSV("data/matches.csv");
      const groups = ["A","B","C","D"];
      groups.forEach(g=>{
        const container = document.getElementById("grp_"+g);
        if(!container) return;
        const st = CupApp.computeStandings(matches, g);
        const tbody = container.querySelector("tbody");
        renderStandingsTable(tbody, st);
        const badge = container.querySelector(".badge");
        if(badge) badge.textContent = String(st.length);
      });
    }catch(e){
      if(errEl){
        errEl.classList.remove("hidden");
        errEl.textContent = "خطأ: " + (e && e.message ? e.message : e);
      }
      console.error(e);
    }
  };
})();
