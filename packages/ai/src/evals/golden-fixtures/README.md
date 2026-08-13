# Golden matter upload fixtures (SYNTH)

Plain-text Case documents derived from `packages/ai/src/evals/golden-matter.ts`.

**Not real authorities.** Titles and bodies are labeled `SYNTH` for manual demos, Playwright upload, and `npm run seed:golden-matter`.

Regenerate from the corpus (keeps files in sync):

```bash
npx tsx -e "import { writeFileSync, mkdirSync } from 'node:fs'; import { join } from 'node:path'; import { buildGoldenFixtureDocuments } from './packages/ai/src/evals/golden-matter.ts'; const dir = join('packages/ai/src/evals/golden-fixtures'); mkdirSync(dir, { recursive: true }); for (const doc of buildGoldenFixtureDocuments()) writeFileSync(join(dir, doc.filename), doc.body, 'utf8');"
```

Seed into local Postgres + MinIO:

```bash
npm run docker:up
npm run db:migrate
npm run seed:golden-matter
```
