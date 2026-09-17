console.log(
  JSON.stringify({
    dbConfigured: Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()),
    dbLen: (process.env.DATABASE_URL || "").length,
  }),
);
