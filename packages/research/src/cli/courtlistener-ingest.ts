/**
 * Bounded CourtListener case-law ingest CLI.
 * Requires COURTLISTENER_API_KEY. Never prints the key.
 *
 * Usage:
 *   npx tsx packages/research/src/cli/courtlistener-ingest.ts --jurisdiction US --max 25
 *   npx tsx packages/research/src/cli/courtlistener-ingest.ts --jurisdiction PA --max 20 --dry-run
 *   npx tsx packages/research/src/cli/courtlistener-ingest.ts --cl-court ca3 --max 20
 */
import { createDb } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { importAuthority } from "../ingest";
import {
  createCourtListenerAdapter,
  emptyCheckpoint,
  runAdapterBatch,
  COURT_ID_MAP,
} from "../corpus/adapters";
import { getCourtById } from "@nyayagrid/jurisdiction";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Map CourtListener court ids onto NyayaGrid court registry when known (hyphenated federal ids). */
const CL_TO_NYAYA: Record<string, { courtId: string; courtLevel: string; authorityState: string }> = {
  scotus: { courtId: "us-scotus", courtLevel: "scotus", authorityState: "US" },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US" },
  cal: { courtId: "st-ca-high", courtLevel: "state_high", authorityState: "CA" },
  calctapp: { courtId: "st-ca-app", courtLevel: "state_appellate", authorityState: "CA" },
  ny: { courtId: "st-ny-high", courtLevel: "state_high", authorityState: "NY" },
  nyappdiv: { courtId: "st-ny-app", courtLevel: "state_appellate", authorityState: "NY" },
  pa: { courtId: "st-pa-high", courtLevel: "state_high", authorityState: "PA" },
  pasuperct: { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA" },
  tex: { courtId: "st-tx-high", courtLevel: "state_high", authorityState: "TX" },
  texapp: { courtId: "st-tx-app", courtLevel: "state_appellate", authorityState: "TX" },
  nj: { courtId: "st-nj-high", courtLevel: "state_high", authorityState: "NJ" },
  njsuperct: { courtId: "st-nj-app", courtLevel: "state_appellate", authorityState: "NJ" },
  fla: { courtId: "st-fl-high", courtLevel: "state_high", authorityState: "FL" },
  fladistctapp: { courtId: "st-fl-app", courtLevel: "state_appellate", authorityState: "FL" },
  ill: { courtId: "st-il-high", courtLevel: "state_high", authorityState: "IL" },
  illappct: { courtId: "st-il-app", courtLevel: "state_appellate", authorityState: "IL" },
  mass: { courtId: "st-ma-high", courtLevel: "state_high", authorityState: "MA" },
  massappct: { courtId: "st-ma-app", courtLevel: "state_appellate", authorityState: "MA" },
  va: { courtId: "st-va-high", courtLevel: "state_high", authorityState: "VA" },
  vacapp: { courtId: "st-va-app", courtLevel: "state_appellate", authorityState: "VA" },
  del: { courtId: "st-de-high", courtLevel: "state_high", authorityState: "DE" },
};

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const jurisdiction = (argValue("--jurisdiction") ?? "US").toUpperCase();
  const maxItems = Number.parseInt(argValue("--max") ?? "25", 10);
  const dryRun = hasFlag("--dry-run");
  const clCourt = argValue("--cl-court"); // optional override e.g. ca3

  if (!apiKey) {
    console.log(
      JSON.stringify({
        ok: false,
        humanActionRequired: "COURTLISTENER_API_KEY",
        message: "CourtListener API key not configured; refusing to invent case data.",
      }),
    );
    process.exit(2);
  }

  const adapter = createCourtListenerAdapter({
    apiKey,
    rateLimitMs: 400,
    jurisdictionCode: clCourt ? undefined : jurisdiction,
    clCourtId: clCourt ?? undefined,
  });

  const checkpoint = emptyCheckpoint("courtlistener");
  const db = dryRun ? null : createDb(process.env.DATABASE_URL!);
  const embeddings = dryRun ? null : createEmbeddingProviderFromEnv();
  const unmappedCourts = new Set<string>();

  const summary = await runAdapterBatch({
    adapter,
    checkpoint,
    dryRun,
    maxItems,
    persist: dryRun
      ? undefined
      : async (records) => {
          let imported = 0;
          let skipped = 0;
          for (const record of records) {
            const rawCourt = String(
              record.courtId ?? record.sourceMetadata?.court_id ?? "",
            ).toLowerCase();
            const mapped = CL_TO_NYAYA[rawCourt];
            if (rawCourt && !mapped) unmappedCourts.add(rawCourt);
            if (mapped) {
              const court = getCourtById(mapped.courtId);
              record.courtId = mapped.courtId;
              record.courtLevel = mapped.courtLevel;
              record.authorityState = mapped.authorityState;
              record.jurisdiction =
                mapped.authorityState === "US"
                  ? "United States"
                  : record.jurisdiction ?? mapped.authorityState;
              if (court?.name) record.court = court.name;
            }
            const result = await importAuthority({
              db: db!,
              embeddings: embeddings!,
              input: record,
            });
            if (result.skipped) skipped += 1;
            else imported += 1;
          }
          return { imported, skipped };
        },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        jurisdiction,
        clCourt: clCourt ?? COURT_ID_MAP[jurisdiction.toLowerCase()] ?? null,
        keyConfigured: true,
        summary,
        unmappedCourts: [...unmappedCourts].sort(),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String(e?.stack || e).slice(0, 2000));
  process.exit(1);
});
