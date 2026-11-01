import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = "https://v3.football.api-sports.io";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function api(pathAndQuery) {
  if (!API_KEY) throw new Error("Football data is not configured yet. Add API_FOOTBALL_KEY in your hosting provider's server-side Secrets.");
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { "x-apisports-key": API_KEY }
  });
  if (!res.ok) throw new Error(`Football data provider returned HTTP ${res.status}.`);
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) throw new Error("Football data provider reported an API error.");
  return body.response || [];
}

const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const pct = x => Math.max(0, Math.min(100, Math.round(x*100)));

function poissonAtLeast(lambda, goals) {
  let p0 = Math.exp(-lambda), sum = p0, p = p0;
  for (let k=1;k<goals;k++){ p *= lambda/k; sum += p; }
  return 1-sum;
}
function poissonUnder(lambda, goals) {
  let p = Math.exp(-lambda), sum = p;
  for (let k=1;k<goals;k++){ p *= lambda/k; sum += p; }
  return sum;
}
function poissonDist(lambda, max=10) {
  const a=[Math.exp(-lambda)];
  for(let k=1;k<=max;k++) a[k]=a[k-1]*lambda/k;
  return a;
}
function matchProb(home, away) {
  const h=poissonDist(home), a=poissonDist(away);
  let hw=0, dr=0, aw=0;
  for(let i=0;i<h.length;i++) for(let j=0;j<a.length;j++){
    if(i>j) hw+=h[i]*a[j]; else if(i===j) dr+=h[i]*a[j]; else aw+=h[i]*a[j];
  }
  return {homeWin:pct(hw), draw:pct(dr), awayWin:pct(aw)};
}
async function teamSearch(name) {
  const results = await api(`/teams?search=${encodeURIComponent(name)}`);
  if (!results.length) throw new Error(`Could not find a team matching "${name}". Check the spelling.`);
  return results[0].team;
}
async function teamForm(teamId) {
  return api(`/fixtures?team=${teamId}&last=10`);
}
function teamStatsFromFixtures(fixtures, teamId) {
  const scored=[], conceded=[], totals=[], homeGoals=[], awayGoals=[];
  for (const f of fixtures) {
    const h=f.teams?.home, a=f.teams?.away, g=f.goals;
    if (!g || g.home==null || g.away==null) continue;
    if (h?.id===teamId) { scored.push(g.home); conceded.push(g.away); homeGoals.push(g.home); }
    else if (a?.id===teamId) { scored.push(g.away); conceded.push(g.home); awayGoals.push(g.away); }
    totals.push(g.home+g.away);
  }
  return {played:scored.length, scored:avg(scored), conceded:avg(conceded),
    avgTotal:avg(totals), homeScored:avg(homeGoals), awayScored:avg(awayGoals)};
}
async function extraStats(fixtures, teamId) {
  const sample=fixtures.filter(f=>f.fixture?.status?.short==="FT").slice(0,5);
  const rows=[];
  for (const f of sample) {
    try {
      const data=await api(`/fixtures/statistics?fixture=${f.fixture.id}`);
      const mine=data.find(x=>x.team?.id===teamId);
      const get=(label)=>n(mine?.statistics?.find(s=>String(s.type).toLowerCase()===label.toLowerCase())?.value);
      rows.push({fouls:get("Fouls"), offsides:get("Offsides")});
    } catch {}
  }
  return {fouls:avg(rows.map(x=>x.fouls).filter(x=>x!==null)),
    offsides:avg(rows.map(x=>x.offsides).filter(x=>x!==null)),
    samples:rows.filter(x=>x.fouls!==null || x.offsides!==null).length};
}

app.post("/api/analyse", async (req,res) => {
  try {
    const homeName=String(req.body.home||"").trim(), awayName=String(req.body.away||"").trim();
    if(!homeName || !awayName) return res.status(400).json({error:"Enter both team names."});
    if(homeName.toLowerCase()===awayName.toLowerCase()) return res.status(400).json({error:"Choose two different teams."});
    const [homeTeam,awayTeam]=await Promise.all([teamSearch(homeName),teamSearch(awayName)]);
    const [hf,af]=await Promise.all([teamForm(homeTeam.id),teamForm(awayTeam.id)]);
    const hform=teamStatsFromFixtures(hf,homeTeam.id), aform=teamStatsFromFixtures(af,awayTeam.id);
    if(hform.played<3 || aform.played<3) throw new Error("There is not enough recent completed-match data for a responsible analysis.");
    const [hs,as]=await Promise.all([extraStats(hf,homeTeam.id),extraStats(af,awayTeam.id)]);
    const leagueHome = hform.homeScored ?? hform.scored;
    const leagueAway = aform.awayScored ?? aform.scored;
    const homeLambda=Math.max(.15,Math.min(4,(leagueHome*0.60 + aform.conceded*0.40)*1.08));
    const awayLambda=Math.max(.15,Math.min(4,(leagueAway*0.60 + hform.conceded*0.40)*.92));
    const total=homeLambda+awayLambda, outcomes=matchProb(homeLambda,awayLambda);
    const over15=pct(poissonAtLeast(total,2)), over25=pct(poissonAtLeast(total,3));
    const under25=pct(poissonUnder(total,3)), under35=pct(poissonUnder(total,4));
    const btts=pct((1-Math.exp(-homeLambda))*(1-Math.exp(-awayLambda)));
    const selections=[
      ["Over 1.5 goals",over15],["Over 2.5 goals",over25],["Under 2.5 goals",under25],
      ["Under 3.5 goals",under35],["Both teams to score",btts],
      [`${homeTeam.name} win`,outcomes.homeWin],["Draw",outcomes.draw],[`${awayTeam.name} win`,outcomes.awayWin]
    ].sort((x,y)=>y[1]-x[1]);
    const best=selections.slice(0,3);
    const fmt=x=>x==null?"Unavailable":x.toFixed(1);
    res.json({
      teams:{home:homeTeam.name,away:awayTeam.name},
      data:{homeMatches:hform.played,awayMatches:aform.played,homeGoalsFor:fmt(hform.scored),homeGoalsAgainst:fmt(hform.conceded),awayGoalsFor:fmt(aform.scored),awayGoalsAgainst:fmt(aform.conceded)},
      predictions:{over15,over25,under25,under35,btts,...outcomes,expectedGoals:(Math.round(total*10)/10)},
      discipline:{homeFouls:hs.fouls,awayFouls:as.fouls,expectedFouls:hs.fouls!==null&&as.fouls!==null?Math.round(hs.fouls+as.fouls):null,homeOffsides:hs.offsides,awayOffsides:as.offsides,expectedOffsides:hs.offsides!==null&&as.offsides!==null?Math.round(hs.offsides+as.offsides):null,statsSamples:Math.min(hs.samples,as.samples)},
      best3:best.map(([market,probability])=>({market,probability})),
      note:"Probabilities are model estimates based on recent results, not guarantees or betting advice. Offside and foul estimates are shown only when the data provider supplies those statistics."
    });
  } catch(e) { res.status(502).json({error:e.message||"Analysis failed."}); }
});
app.listen(PORT,()=>console.log(`Football AI Analyst Pro listening on ${PORT}`));
