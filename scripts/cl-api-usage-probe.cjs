/**
 * Probe CourtListener /api/rest/v4/api-usage/ on staging (no token exposure).
 * Does NOT count against main user quota (separate api_usage throttle).
 */
const { spawnSync } = require("node:child_process");

const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

const probeCode = `
const k=process.env.COURTLISTENER_API_KEY;
if(!k){console.log(JSON.stringify({ok:false,reason:'no_key'}));process.exit(2)}
const t0=Date.now();
fetch('https://www.courtlistener.com/api/rest/v4/api-usage/',{
  headers:{Authorization:'Token '+k,Accept:'application/json'},
  signal:AbortSignal.timeout(30000)
}).then(async r=>{
  const j=await r.json().catch(()=>({}));
  const membership=j.membership||null;
  const current=j.current_usage||j.usage||[];
  const userScopes=(Array.isArray(current)?current:[]).filter(x=>String(x.scope||x.name||'').toLowerCase()==='user' || String(x.throttle||'').toLowerCase().includes('user'));
  // Also accept nested shapes
  let scopes=userScopes;
  if(!scopes.length && j.current_usage && typeof j.current_usage==='object' && !Array.isArray(j.current_usage)){
    const u=j.current_usage.user || j.current_usage;
    if(Array.isArray(u)) scopes=u;
    else if(u && typeof u==='object') scopes=[u];
  }
  // Flatten common shapes: minute/hour/day rows under user
  const rows=[];
  const walk=(arr)=>{
    for(const row of (Array.isArray(arr)?arr:[])){
      const period=String(row.period||row.window||row.rate||row.name||'').toLowerCase();
      rows.push({
        scope:String(row.scope||row.throttle||'user'),
        period: period.includes('min')?'minute':period.includes('hour')?'hour':period.includes('day')?'day':period||null,
        limit:Number(row.limit??row.rate_limit??row.allowed??null),
        usage:Number(row.usage??row.used??row.count??null),
        remaining:Number(row.remaining??row.left??(row.limit!=null&&row.usage!=null?row.limit-row.usage:null)),
        reset_at:row.reset_at||row.resetAt||row.resets_at||null,
        blocked:Boolean(row.blocked||row.is_blocked||false),
      });
    }
  };
  walk(scopes);
  if(!rows.length) walk(Array.isArray(current)?current:[]);
  // Parse rate strings like "15/min" if present
  for(const row of rows){
    if(!row.period && typeof row.limit==='number' && row.limit>0){ /* keep */ }
  }
  const byPeriod={};
  for(const row of rows){
    if(row.period) byPeriod[row.period]=row;
  }
  // Heuristic: if no period labels, sort by limit ascending → minute, hour, day
  if(!byPeriod.minute && rows.length>=3){
    const sorted=[...rows].filter(r=>Number.isFinite(r.limit)).sort((a,b)=>a.limit-b.limit);
    if(sorted[0]) byPeriod.minute={...sorted[0],period:'minute'};
    if(sorted[1]) byPeriod.hour={...sorted[1],period:'hour'};
    if(sorted[2]) byPeriod.day={...sorted[2],period:'day'};
  }
  const minuteLimit=byPeriod.minute?.limit??null;
  const hourLimit=byPeriod.hour?.limit??null;
  const dayLimit=byPeriod.day?.limit??null;
  const tier2Expected=minuteLimit===15 && hourLimit===150 && dayLimit===600;
  const freeDefault=minuteLimit===5 && hourLimit===50 && dayLimit===125;
  console.log(JSON.stringify({
    ok:r.ok,
    status:r.status,
    ms:Date.now()-t0,
    membership:{
      level:membership?.level||membership?.name||null,
      is_active:membership?.is_active??membership?.isActive??null,
      rawKeys:membership?Object.keys(membership):[],
    },
    limits:{
      minute:byPeriod.minute||null,
      hour:byPeriod.hour||null,
      day:byPeriod.day||null,
    },
    tier2Expected,
    freeDefault,
    propagationReady:Boolean(tier2Expected),
    rawTopKeys:Object.keys(j),
    rawSample:JSON.stringify(j).slice(0,2500),
  },null,2));
}).catch(e=>console.log(JSON.stringify({ok:false,err:String(e.name||e),ms:Date.now()-t0})));
`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", MACHINE, "-a", APP, "--timeout", "90", `node -e ${JSON.stringify(probeCode)}`],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 800));
process.exit(r.status ?? 1);
