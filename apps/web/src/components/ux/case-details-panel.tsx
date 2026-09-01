"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, cx } from "@nyayagrid/ui";
import {
  CHOICE_OF_LAW_OPTIONS,
  FORUM_TYPE_OPTIONS,
  type JurisdictionCourtOption,
  type JurisdictionStateOption,
  type UiJurisdictionContract,
  courtSelectOptions,
  coverageMustNotSayCertified,
  coverageStatusLabel,
  forumDisplayLabel,
  stateSelectOptions,
} from "@/lib/case-jurisdiction";
import { SearchableSelect } from "@/components/ux/searchable-select";

type MatterSnapshot = {
  title: string;
  description: string | null;
  practiceArea: string | null;
};

type FormState = {
  primaryState: string;
  forumType: string;
  courtId: string;
  practiceArea: string;
  governingLawState: string;
  choiceOfLawStatus: string;
  asOfDate: string;
  relatedStates: string[];
};

function emptyForm(): FormState {
  return {
    primaryState: "",
    forumType: "",
    courtId: "",
    practiceArea: "",
    governingLawState: "",
    choiceOfLawStatus: "none_known",
    asOfDate: "",
    relatedStates: [],
  };
}

function formFromContext(ctx: UiJurisdictionContract, matter: MatterSnapshot): FormState {
  return {
    primaryState: ctx.primaryState ?? "",
    forumType: ctx.forumType ?? "",
    courtId: ctx.courtId ?? "",
    practiceArea: matter.practiceArea ?? ctx.practiceArea ?? "",
    governingLawState: ctx.governingLawState ?? "",
    choiceOfLawStatus: ctx.choiceOfLawStatus ?? "none_known",
    asOfDate: ctx.asOfDate ?? "",
    relatedStates: (ctx.relatedJurisdictions ?? [])
      .map((row) => row.stateCode ?? "")
      .filter(Boolean),
  };
}

function stateName(states: JurisdictionStateOption[], code: string | null | undefined): string | null {
  if (!code) return null;
  return states.find((row) => row.code === code)?.name ?? code;
}

export function CaseDetailsPanel({
  open,
  onClose,
  matterId,
  organizationId,
  canEdit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  matterId: string;
  organizationId: string | null;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [context, setContext] = useState<UiJurisdictionContract | null>(null);
  const [matter, setMatter] = useState<MatterSnapshot | null>(null);
  const [states, setStates] = useState<JurisdictionStateOption[]>([]);
  const [courts, setCourts] = useState<JurisdictionCourtOption[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());

  const stateOptions = useMemo(() => stateSelectOptions(states), [states]);
  const courtOptions = useMemo(() => courtSelectOptions(courts), [courts]);

  const selectedCourt = courts.find((court) => court.id === form.courtId);
  const derivedCircuitLabel =
    selectedCourt?.federalCircuitLabel ?? context?.federalCircuitLabel ?? null;

  const loadCourts = useCallback(
    async (state: string, forumType: string) => {
      if (!organizationId || !state || !forumType) {
        setCourts([]);
        return;
      }
      const params = new URLSearchParams({
        organizationId,
        state,
        forumType,
      });
      const res = await fetch(`/api/v1/jurisdiction/options?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load courts");
      setCourts(data.courts ?? []);
    },
    [organizationId],
  );

  const loadPanel = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const [matterRes, optionsRes] = await Promise.all([
        fetch(`/api/v1/matters/${matterId}`),
        fetch(`/api/v1/jurisdiction/options?organizationId=${organizationId}`),
      ]);
      const matterJson = await matterRes.json();
      const optionsJson = await optionsRes.json();
      if (!matterRes.ok) throw new Error(matterJson?.error?.message ?? "Failed to load Case");
      if (!optionsRes.ok) throw new Error(optionsJson?.error?.message ?? "Failed to load options");
      const ctx = matterJson.jurisdictionContext as UiJurisdictionContract | null;
      const snap: MatterSnapshot = {
        title: matterJson.matter.title,
        description: matterJson.matter.description ?? null,
        practiceArea: matterJson.matter.practiceArea ?? null,
      };
      setContext(ctx);
      setMatter(snap);
      setStates(optionsJson.states ?? []);
      const nextForm = ctx ? formFromContext(ctx, snap) : { ...emptyForm(), practiceArea: snap.practiceArea ?? "" };
      setForm(nextForm);
      setDirty(false);
      if (nextForm.primaryState && nextForm.forumType) {
        await loadCourts(nextForm.primaryState, nextForm.forumType);
      } else {
        setCourts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Case details");
    } finally {
      setLoading(false);
    }
  }, [organizationId, matterId, loadCourts]);

  useEffect(() => {
    if (open) loadPanel().catch(() => undefined);
  }, [open, loadPanel]);

  function patchForm(partial: Partial<FormState>) {
    setDirty(true);
    setForm((prev) => ({ ...prev, ...partial }));
  }

  async function onPrimaryStateChange(value: string) {
    patchForm({ primaryState: value, courtId: "" });
    if (value && form.forumType) await loadCourts(value, form.forumType);
    else setCourts([]);
  }

  async function onForumTypeChange(value: string) {
    patchForm({ forumType: value, courtId: "" });
    if (form.primaryState && value) await loadCourts(form.primaryState, value);
    else setCourts([]);
  }

  function requestClose() {
    if (dirty && canEdit) {
      const ok = window.confirm("Discard unsaved Case details changes?");
      if (!ok) return;
    }
    onClose();
  }

  async function onSave() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        practiceArea: form.practiceArea.trim() || null,
        primaryState: form.primaryState || null,
        forumType: form.forumType || null,
        courtId: form.courtId || null,
        governingLawState: form.governingLawState || null,
        choiceOfLawStatus: form.choiceOfLawStatus || null,
        asOfDate: form.asOfDate || null,
        relatedJurisdictions: form.relatedStates.map((stateCode) => ({ stateCode, courtId: null })),
      };
      const res = await fetch(`/api/v1/matters/${matterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Save failed");
      const ctx = data.jurisdictionContext as UiJurisdictionContract | null;
      setContext(ctx);
      if (ctx && matter) setForm(formFromContext(ctx, matter));
      setDirty(false);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function addRelatedState() {
    patchForm({ relatedStates: [...form.relatedStates, ""] });
  }

  function updateRelatedState(index: number, value: string) {
    const next = [...form.relatedStates];
    next[index] = value;
    patchForm({ relatedStates: next });
  }

  function removeRelatedState(index: number) {
    patchForm({ relatedStates: form.relatedStates.filter((_, i) => i !== index) });
  }

  if (!open) return null;

  const coverageLabel = coverageStatusLabel(context?.coverage);
  const forumLabel = forumDisplayLabel(form.forumType || context?.forumType);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-ink/20"
        aria-label="Close Case details"
        onClick={requestClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-white shadow-lg"
        aria-label="Case details"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-display text-lg text-ink">Case details</h2>
            <p className="text-xs text-ink/55">Jurisdiction &amp; details</p>
          </div>
          <Button type="button" variant="ghost" onClick={requestClose}>
            Close
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? <p className="text-sm text-ink/60">Loading…</p> : null}
          {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}

          {!loading && context ? (
            <div className="space-y-4">
              {context.legacyJurisdiction || context.legacyCourt ? (
                <div className="rounded border border-line bg-black/[0.02] p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Legacy recorded values
                  </p>
                  {context.legacyJurisdiction ? (
                    <p className="mt-1">
                      <span className="text-ink/55">Jurisdiction: </span>
                      {context.legacyJurisdiction}
                    </p>
                  ) : null}
                  {context.legacyCourt ? (
                    <p className="mt-1">
                      <span className="text-ink/55">Court: </span>
                      {context.legacyCourt}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-ink/50">
                    Structured fields below replace legacy text when saved.
                  </p>
                </div>
              ) : null}

              <SearchableSelect
                label="Jurisdiction / State"
                value={form.primaryState}
                onChange={(value) => {
                  onPrimaryStateChange(value).catch(() => undefined);
                }}
                options={stateOptions}
                allowEmpty
                emptyLabel="Not set"
                disabled={!canEdit}
              />

              <label className="block text-sm font-semibold text-ink">
                Court type
                <select
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm font-normal"
                  value={form.forumType}
                  disabled={!canEdit}
                  onChange={(e) => {
                    onForumTypeChange(e.target.value).catch(() => undefined);
                  }}
                >
                  <option value="">Not set</option>
                  {FORUM_TYPE_OPTIONS.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>

              <SearchableSelect
                label="Court"
                value={form.courtId}
                onChange={(value) => patchForm({ courtId: value })}
                options={courtOptions}
                allowEmpty
                emptyLabel={form.primaryState && form.forumType ? "Court not listed" : "Select state and court type first"}
                disabled={!canEdit || !form.primaryState || !form.forumType}
                helperText={
                  form.primaryState && form.forumType && courtOptions.length === 0
                    ? "No supported courts for this combination."
                    : undefined
                }
              />

              {derivedCircuitLabel ? (
                <div className="rounded border border-line bg-black/[0.02] px-3 py-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Federal circuit
                  </p>
                  <p className="mt-1 font-semibold text-ink">{derivedCircuitLabel}</p>
                  <p className="mt-1 text-xs text-ink/50">Derived from selected court</p>
                </div>
              ) : null}

              <div className="rounded border border-line px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Forum</p>
                <p className="mt-1 text-ink">
                  {selectedCourt?.name ??
                    context.courtName ??
                    (form.primaryState ? `${stateName(states, form.primaryState)} · Court not set` : "Not set")}
                  {forumLabel ? ` · ${forumLabel}` : null}
                </p>
              </div>

              <label className="block text-sm font-semibold text-ink">
                Practice area
                <input
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm font-normal"
                  value={form.practiceArea}
                  disabled={!canEdit}
                  onChange={(e) => patchForm({ practiceArea: e.target.value })}
                  placeholder="e.g. Employment, Contract"
                />
              </label>

              <SearchableSelect
                label="Governing / choice of law"
                value={form.governingLawState}
                onChange={(value) => patchForm({ governingLawState: value })}
                options={stateOptions}
                allowEmpty
                emptyLabel="Not set"
                disabled={!canEdit}
                helperText="Records the law the Case may be analyzed under. It does not by itself establish that the choice-of-law provision is enforceable."
              />

              <label className="block text-sm font-semibold text-ink">
                Choice-of-law status
                <select
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm font-normal"
                  value={form.choiceOfLawStatus}
                  disabled={!canEdit}
                  onChange={(e) => patchForm({ choiceOfLawStatus: e.target.value })}
                >
                  {CHOICE_OF_LAW_OPTIONS.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded border border-line px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Governing law (recorded)
                </p>
                <p className="mt-1 text-ink">
                  {stateName(states, form.governingLawState) ?? "Not set"}
                </p>
              </div>

              <label className="block text-sm font-semibold text-ink">
                Law as of
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm font-normal"
                  value={form.asOfDate}
                  disabled={!canEdit}
                  onChange={(e) => patchForm({ asOfDate: e.target.value })}
                />
                <span className="mt-1 block text-xs font-normal text-ink/55">
                  Nyaya uses this date when evaluating legal authority where source metadata
                  supports it.
                </span>
              </label>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-ink">Related jurisdictions</legend>
                <p className="text-xs text-ink/55">Optional — for multi-jurisdiction matters.</p>
                {form.relatedStates.map((code, index) => (
                  <div key={`related-${index}`} className="flex gap-2">
                    <div className="flex-1">
                      <SearchableSelect
                        label={`Related ${index + 1}`}
                        value={code}
                        onChange={(value) => updateRelatedState(index, value)}
                        options={stateOptions}
                        allowEmpty
                        emptyLabel="Select state"
                        disabled={!canEdit}
                      />
                    </div>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-6 shrink-0"
                        onClick={() => removeRelatedState(index)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
                {canEdit ? (
                  <Button type="button" variant="secondary" onClick={addRelatedState}>
                    + Add another jurisdiction
                  </Button>
                ) : null}
              </fieldset>

              <p
                className={cx(
                  "text-xs text-ink/55",
                  coverageMustNotSayCertified(context.coverage) ? undefined : undefined,
                )}
              >
                Coverage: {coverageLabel}
              </p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-line px-4 py-3">
          {canEdit ? (
            <Button type="button" disabled={saving || loading} onClick={() => onSave()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <p className="text-sm text-ink/55">View only — you cannot edit Case details.</p>
          )}
        </div>
      </aside>
    </>
  );
}
