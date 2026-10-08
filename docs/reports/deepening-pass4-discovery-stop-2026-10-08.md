# Deepening Pass 4 — Discovery / Production Ledger Stop Report

**Date:** 2026-10-08  
**Branch:** `nyaya/full-completion-deepening-v2`  
**Classification:** `DEEPENING_PASS4_DISCOVERY_PRODUCTION`

## STATUS

`DEEPENING_PASS4_PROTOTYPE_SCHEMA_REQUIRED`

## STOP_REASON

`DISCOVERY_SHARED_SCHEMA_REQUIRED` (+ `DISCOVERY_GRAPH_SHARED_SCHEMA_REQUIRED`)

Production L4 discovery/production ledger requires additive shared persistence. Chat A delivered a production-level application/domain prototype, exact schema proposal, D4 assignments, and Ask/whole-matter helpers — and stopped without implementing migration `0022` or graph enum expansion.

## CURRENT MATURITY

Prototype domain model: **L2** (usable deterministic review + Ask answers in-memory)  
Persisted production ledger: **L0**  
Overall Pass 4 target L4: **blocked on shared schema**

See gap matrix in `docs/reports/discovery-shared-schema-required-2026-10-08.md`.

## SCHEMA

- shared migration required?: **YES**
- proposed tables/changes: request_sets, request_items, responses, objections, productions, production_items, bates_ranges, deficiencies, privilege_assertions, meet_and_confer (+ junctions); reuse documents/evidence/parties/tasks/communications/motions
- migration risk: **Low–Medium** (additive); graph enum separate Medium

## DISCOVERY (prototype)

- request sets: yes (RFP + ROG)
- request items: yes
- responses: yes (incl. supplemental)
- objections: yes
- supplements: yes
- deficiencies: yes
- privilege review: yes (ASSERTED; not a legal conclusion)

## PRODUCTION LEDGER (prototype)

- productions: yes (Vol. 1 + supplemental Vol. 2)
- Bates ranges: yes
- overlap detection: yes (review signal)
- gap signals: yes (within/across productions; review signal only)
- custodians: yes (ids)
- documents/evidence linkage: yes

## DEADLINES

- service / response dates: modeled on sets/items
- tasks: link-ready to existing task system (not persisted this pass)
- meet-and-confer: yes
- motion links: yes (MOTION_TO_COMPEL)

## ASK NYAYA

- request / party / production / whole-matter: prototype helpers
- citations: source document ids + Bates raw text
- unsupported legal conclusion produced?: **NO** (MUST = NO)

## GRAPH

- discovery graph support: **prototype relationships only** (not materialized)
- shared graph migration required?: **YES**

## SECURITY (application-layer)

- cross-org / cross-matter denial helpers: tested
- unauthorized mutation / live DB isolation: **deferred** (no persistence; requires schema + runtime lock)

## ASSIGNMENTS

- count: 10 (D4)
- expected: all pass under deterministic runner
- critical / high: per catalog

## REGRESSION

Run locally after commits (static only; no Neon / CourtListener / DB mutations):

- Discovery ledger unit tests
- Deepening D1–D4
- Civil Ask / civil graph unit paths (no live DB)
- Production build as feasible

## PERFORMANCE

- 120-item scale fixture exercised in unit test
- N+1 / join explosion: N/A until persistence

## P0

- Shared discovery ledger migration coordination
- Shared graph node-type expansion for discovery entities

## P1

- Persist ledger after schema merge
- Production UI surfaces
- Wire Ask Nyaya live context
- Live security matrix with runtime lock

## NEXT ACTION

Coordinate and implement additive shared discovery/production schema (`0022`) + discovery graph node types on an authorized schema track; then resume Chat A persistence, UI, and live certification.

## GIT

Recorded at commit time in the mandatory final report below.
