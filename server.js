import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
const SPORTMONKS_API_BASE = "https://api.sportmonks.com/v3/football";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

async function teamForm(teamId) {
const end = new Date();
const start = new Date();
start.setFullYear(start.getFullYear() - 2);

const formatDate = date => date.toISOString().slice(0, 10);

const endpoint = "fixtures/between/${formatDate(start)}/${formatDate(end)}/${teamId}";

const payload = await sportmonksApi(endpoint, {
include: "participants;scores;state",
order: "desc",
per_page: 50
});

return asArray(payload);

}

const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const pct = x => Math.max(0, Math.min(100, Math.round(x*100)));

function poissonAtLeast(lambda, goals) {
  let p0 = Math.exp(-lambda), sum = p0, p = p0;
  for (let k = 1; k < goals; k++) { p *= lambda / k; sum += p; }
  return 1 - sum;
}

function poissonUnder(lambda, goals) {
  let p = Math.exp(-lambda), sum = p;
  for (let k = 1; k < goals; k++) { p *= lambda / k; sum += p; }
  return sum;
}

function poissonDist(lambda, max = 10) {
  const a = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k++) a[k] = a[k - 1] * lambda / k;
  return a;
}

function matchProb(home, away) {
  const h = poissonDist(home), a = poissonDist(away);
  let hw = 0, dr = 0, aw = 0;
  for (let i = 0; i < h.length; i++) {
    for (let j = 0; j < a.length; j++) {
      if (i > j) hw += h[i] * a[j];
      else if (i === j) dr += h[i] * a[j];
      else aw += h[i] * a[j];
    }
  }
  return { homeWin: pct(hw), draw: pct(dr), awayWin: pct(aw) };
}

function fixtureHomeAwayIds(fixture) {
  const homeId = fixture?.home_team_id ?? fixture?.homeTeam?.id ?? fixture?.home_team?.id ?? fixture?.participants?.home?.id ?? fixture?.teams?.home?.id;
  const awayId = fixture?.away_team_id ?? fixture?.awayTeam?.id ?? fixture?.away_team?.id ?? fixture?.participants?.away?.id ?? fixture?.teams?.away?.id;
  return { homeId, awayId };
}

function fixtureGoalValues(fixture) {
  const score = fixture?.scores ?? fixture?.score ?? {};
  const goals = fixture?.goals ?? {};
  const homeGoals = n(score.home ?? score.local ?? fixture?.home_score ?? fixture?.localTeamScore ?? fixture?.local_team_score ?? goals.home ?? goals.local);
  const awayGoals = n(score.away ?? score.visitor ?? fixture?.away_score ?? fixture?.visitorTeamScore ?? fixture?.away_team_score ?? goals.away ?? goals.visitor);
  return { homeGoals, awayGoals };
}

function teamStatsFromFixtures(fixtures, teamId) {
  const scored = [], conceded = [], totals = [], homeGoals = [], awayGoals = [];

  for (const fixture of fixtures) {
    const { homeId, awayId } = fixtureHomeAwayIds(fixture);
    const { homeGoals: home, awayGoals: away } = fixtureGoalValues(fixture);

    if (homeId == null || awayId == null || home == null || away == null) continue;

    if (homeId === teamId) {
      scored.push(home);
      conceded.push(away);
      homeGoals.push(home);
      totals.push(home + away);
    } else if (awayId === teamId) {
      scored.push(away);
      conceded.push(home);
      awayGoals.push(away);
      totals.push(home + away);
    }
  }

  return {
    played: scored.length,
    scored: avg(scored),
    conceded: avg(conceded),
    avgTotal: avg(totals),
    homeScored: avg(homeGoals.length ? homeGoals : null),
    awayScored: avg(awayGoals.length ? awayGoals : null)
  };
}

function statValueFromRecord(record, label) {
  const normalized = String(label).toLowerCase();
  const candidate = record?.statistics?.find(item => String(item?.type ?? item?.name ?? item?.key).toLowerCase() === normalized)
    ?? record?.stats?.find(item => String(item?.type ?? item?.name ?? item?.key).toLowerCase() === normalized)
    ?? record?.statistics?.find(item => String(item?.type ?? item?.name ?? item?.key).toLowerCase().includes(normalized))
    ?? record?.stats?.find(item => String(item?.type ?? item?.name ?? item?.key).toLowerCase().includes(normalized));

  if (!candidate) return null;
  return n(candidate.value ?? candidate.total ?? candidate.amount ?? candidate.count);
}

async function extraStats(fixtures, teamId) {
  const sample = fixtures.filter(f => {
    const status = String(f?.status ?? "").toLowerCase();
    return status === "finished" || status === "ft" || status === "fulltime";
  }).slice(0, 5);

  const rows = [];
  for (const fixture of sample) {
    try {
      const payload = await sportmonksApi(`fixtures/${fixture.id}/statistics`);
      const records = asArray(payload);
      const mine = records.find(item => {
        const recordTeamId = item?.team_id ?? item?.team?.id ?? item?.teamId;
        return recordTeamId === teamId;
      });

      const get = label => statValueFromRecord(mine, label);
      rows.push({
        fouls: get("fouls"),
        offsides: get("offsides")
      });
    } catch {}
  }

  return {
    fouls: avg(rows.map(x => x.fouls).filter(x => x !== null)),
    offsides: avg(rows.map(x => x.offsides).filter(x => x !== null)),
    samples: rows.filter(x => x.fouls !== null || x.offsides !== null).length
  };
}

app.post("/api/analyse", async (req, res) => {
  try {
    const homeName = String(req.body.home || "").trim();
    const awayName = String(req.body.away || "").trim();

    if (!homeName || !awayName) return res.status(400).json({ error: "Enter both team names." });
    if (homeName.toLowerCase() === awayName.toLowerCase()) return res.status(400).json({ error: "Choose two different teams." });

    const [homeTeam, awayTeam] = await Promise.all([teamSearch(homeName), teamSearch(awayName)]);
    const [hf, af] = await Promise.all([teamForm(homeTeam.id), teamForm(awayTeam.id)]);

    const hform = teamStatsFromFixtures(hf, homeTeam.id);
    const aform = teamStatsFromFixtures(af, awayTeam.id);

    if (hform.played < 3 || aform.played < 3) {
      throw new Error("There is not enough recent completed-match data for a responsible analysis.");
    }

    const [hs, as] = await Promise.all([extraStats(hf, homeTeam.id), extraStats(af, awayTeam.id)]);
    const leagueHome = hform.homeScored ?? hform.scored;
    const leagueAway = aform.awayScored ?? aform.scored;
    const homeLambda = Math.max(.15, Math.min(4, (leagueHome * 0.60 + aform.conceded * 0.40) * 1.08));
    const awayLambda = Math.max(.15, Math.min(4, (leagueAway * 0.60 + hform.conceded * 0.40) * .92));
    const total = homeLambda + awayLambda;
    const outcomes = matchProb(homeLambda, awayLambda);
    const over15 = pct(poissonAtLeast(total, 2));
    const over25 = pct(poissonAtLeast(total, 3));
    const under25 = pct(poissonUnder(total, 3));
    const under35 = pct(poissonUnder(total, 4));
    const btts = pct((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)));

    const selections = [
      ["Over 1.5 goals", over15],
      ["Over 2.5 goals", over25],
      ["Under 2.5 goals", under25],
      ["Under 3.5 goals", under35],
      ["Both teams to score", btts],
      [`${homeTeam.name} win`, outcomes.homeWin],
      ["Draw", outcomes.draw],
      [`${awayTeam.name} win`, outcomes.awayWin]
    ].sort((x, y) => y[1] - x[1]);

    const best = selections.slice(0, 3);
    const fmt = x => x == null ? "Unavailable" : x.toFixed(1);

    res.json({
      teams: { home: homeTeam.name, away: awayTeam.name },
      data: {
        homeMatches: hform.played,
        awayMatches: aform.played,
        homeGoalsFor: fmt(hform.scored),
        homeGoalsAgainst: fmt(hform.conceded),
        awayGoalsFor: fmt(aform.scored),
        awayGoalsAgainst: fmt(aform.conceded)
      },
      predictions: {
        over15,
        over25,
        under25,
        under35,
        btts,
        ...outcomes,
        expectedGoals: (Math.round(total * 10) / 10)
      },
      discipline: {
        homeFouls: hs.fouls,
        awayFouls: as.fouls,
        expectedFouls: hs.fouls !== null && as.fouls !== null ? Math.round(hs.fouls + as.fouls) : null,
        homeOffsides: hs.offsides,
        awayOffsides: as.offsides,
        expectedOffsides: hs.offsides !== null && as.offsides !== null ? Math.round(hs.offsides + as.offsides) : null
      },
      best3: best.map(([market, probability]) => ({ market, probability })),
      note: "Probabilities are model estimates based on recent results, not guarantees or betting advice. Offside and foul estimates are shown only when the data provider supplies those statistics."
    });
  } catch (error) {
    res.status(502).json({ error: error.message || "Analysis failed." });
  }
});

app.listen(PORT, () => console.log(`Football AI Analyst Pro listening on ${PORT}`));
