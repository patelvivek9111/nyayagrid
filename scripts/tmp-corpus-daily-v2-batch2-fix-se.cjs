const postgres=require("postgres");
(async()=>{
  const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:"require",idle_timeout:10,connect_timeout:40});
  const r=await sql`
    update legal_authorities
    set court='State appellate/high court (S.E. reporter; jurisdiction pending cluster repair)',
        court_id='st-regional-se',
        court_level='state_high',
        jurisdiction='Unknown',
        updated_at=now()
    where citation in ('266 S.E.2d 114','712 S.E.2d 55','461 S.E.2d 163')
      and court_id in ('pending-repair','st-unknown')
    returning citation, court_id
  `;
  console.log(JSON.stringify({ok:true,updated:r,courtListenerHttpCalls:0}));
  await sql.end({timeout:5});
})();
