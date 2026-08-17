import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/schema/index.ts",
    "./src/schema/phase5.ts",
    "./src/schema/phase6.ts",
    "./src/schema/phase7.ts",
    "./src/schema/phase8.ts",
    "./src/schema/phase9.ts",
    "./src/schema/phase10.ts",
    "./src/schema/phase11.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  },
  strict: true,
  verbose: true,
});
