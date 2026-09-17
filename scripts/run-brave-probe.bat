@echo off
flyctl ssh console --app nyayagrid-staging -C "node /app/scripts/brave-staging-probe.cjs" 2>nul
if errorlevel 1 (
  flyctl ssh console --app nyayagrid-staging -C "node -e \"const k=process.env.BRAVE_SEARCH_API_KEY;if(!k||!String(k).trim()){console.log(JSON.stringify({ok:false,reason:'missing'}));process.exit(2)}fetch('https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent('Pennsylvania Courts official site')+'&count=3',{headers:{Accept:'application/json','X-Subscription-Token':k}}).then(async r=>{const j=await r.json();const results=(j.web&&j.web.results)||[];const s=JSON.stringify(j);console.log(JSON.stringify({ok:r.ok,status:r.status,count:results.length,bounded:results.length<=8,titles:results.map(x=>String(x.title||'').slice(0,80)),urls:results.map(x=>String(x.url||'').slice(0,120)),keyLeaked:s.includes(k)}));}).catch(e=>{console.log(JSON.stringify({ok:false,error:String(e&&e.message?e.message:e).slice(0,120)}));process.exit(1);})\""
)
