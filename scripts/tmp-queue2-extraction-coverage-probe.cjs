const postgres=require("postgres");
(async()=>{
  const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:"require",idle_timeout:5,connect_timeout:30});
  try{
    const [c]=await sql`select count(*)::int as cases from legal_authorities where authority_type='case'`;
    // best-effort: if extraction tracking table/columns exist
    let extraction=null;
    try{
      const rows=await sql`
        select
          count(*)::int as eligible,
          count(*) filter (where citation_extraction_status is not null or citations_extracted_at is not null)::int as processed
        from legal_authorities where authority_type='case'
      `;
      extraction=rows[0];
    }catch(e){
      extraction={note:String(e.message||e).slice(0,120)};
    }
    console.log(JSON.stringify({ok:true,cases:c.cases,extraction,courtListenerHttpCalls:0}));
  } finally { await sql.end({timeout:5}); }
})().catch(e=>{console.log(JSON.stringify({ok:false,error:String(e.message||e)})); process.exit(1);});
