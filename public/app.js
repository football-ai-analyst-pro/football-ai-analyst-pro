const $ = id => document.getElementById(id);

const metric = (name, val) =>
  `<div class="card"><span>${name}</span><strong>${val == null ? "Unavailable" : val + "%"}</strong></div>`;

$("go").addEventListener("click", async () => {
  const home = $("home").value.trim();
  const away = $("away").value.trim();

  if (!home || !away) {
    $("status").textContent = "Please enter both team names.";
    return;
  }

  $("status").textContent = "Researching recent matches and calculating estimates…";
  $("go").disabled = true;
  $("results").hidden = true;

  try {
    const r = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home, away })
    });

    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not analyse this match.");

    $("fixture").textContent = `${d.teams.home} vs ${d.teams.away}`;
    $("summary").textContent = `Estimated total goals: ${d.predictions.expectedGoals}`;

    const p = d.predictions;

    $("markets").innerHTML =
      metric("Over 1.5 goals", p.over15) +
      metric("Over 2.5 goals", p.over25) +
      metric("Under 2.5 goals", p.under25) +
      metric("Under 3.5 goals", p.under35) +
      metric("Both teams to score", p.btts) +
      metric(`${d.teams.home} win`, p.homeWin) +
      metric("Draw", p.draw) +
      metric(`${d.teams.away} win`, p.awayWin);

    $("best").innerHTML = d.best3.map((x, i) =>
      `<div class="bestrow"><b>${i + 1}. ${x.market}</b><span class="pill">${x.probability}%</span></div>`
    ).join("");

    const z = d.discipline;

    $("discipline").innerHTML =
      `<div class="bestrow"><span>Expected total fouls</span><b>${z.expectedFouls ?? "Unavailable"}</b></div>` +
      `<div class="bestrow"><span>Expected total offsides</span><b>${z.expectedOffsides ?? "Unavailable"}</b></div>` +
      `<div class="bestrow"><span>Home fouls / offsides</span><b>${z.homeFouls ?? "—"} / ${z.homeOffsides ?? "—"}</b></div>` +
      `<div class="bestrow"><span>Away fouls / offsides</span><b>${z.awayFouls ?? "—"} / ${z.awayOffsides ?? "—"}</b></div>`;

    const f = d.data;

    $("form").innerHTML =
      `<div class="bestrow"><span>${d.teams.home}: goals for / against per match</span><b>${f.homeGoalsFor} / ${f.homeGoalsAgainst}</b></div>` +
      `<div class="bestrow"><span>${d.teams.away}: goals for / against per match</span><b>${f.awayGoalsFor} / ${f.awayGoalsAgainst}</b></div>` +
      `<div class="bestrow"><span>Completed matches analysed</span><b>${f.homeMatches} / ${f.awayMatches}</b></div>`;

    $("note").textContent = d.note;
    $("results").hidden = false;
    $("status").textContent = "";

  } catch (e) {
    $("status").textContent = e.message;
  } finally {
    $("go").disabled = false;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
