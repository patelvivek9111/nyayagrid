"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudentShell } from "@/components/shell";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import {
  loadProfessorSettings,
  saveProfessorSettings,
  type ProfessorExplanationLevel,
} from "@/lib/professor-settings";
import { Button, PageHeader, Panel } from "@nyayagrid/ui";

export default function ProfessorSettingsPage() {
  const [explanationLevel, setExplanationLevel] =
    useState<ProfessorExplanationLevel>("standard");
  const [showStudyAidReminder, setShowStudyAidReminder] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadProfessorSettings();
    setExplanationLevel(settings.explanationLevel);
    setShowStudyAidReminder(settings.showStudyAidReminder);
  }, []);

  function persist() {
    saveProfessorSettings({ explanationLevel, showStudyAidReminder });
    setSaved(true);
  }

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Settings"
        description="Personal study preferences for this browser. There is no firm admin or billing here."
      />
      {showStudyAidReminder ? (
        <div className="mb-4">
          <StudyAidNotice />
        </div>
      ) : (
        <p className="mb-4 text-xs text-ink/50">Study-aid reminder is hidden on this page.</p>
      )}
      {saved ? <p className="mb-4 text-sm text-accent">Preferences saved on this device.</p> : null}

      <Panel title="Study preferences">
        <label className="block text-sm font-semibold">
          Default explanation level
          <select
            className="mt-1 block w-full max-w-xs rounded border border-line px-2 py-1.5 text-sm"
            value={explanationLevel}
            onChange={(e) => setExplanationLevel(e.target.value as ProfessorExplanationLevel)}
          >
            <option value="simple">Simple</option>
            <option value="standard">Standard</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showStudyAidReminder}
            onChange={(e) => setShowStudyAidReminder(e.target.checked)}
          />
          Show the study-aid reminder
        </label>
        <div className="mt-4">
          <Button type="button" onClick={persist}>
            Save preferences
          </Button>
        </div>
      </Panel>

      <Panel title="Account and workspace" className="mt-4">
        <p className="text-sm text-ink/70">
          Switch workspaces from the header. Professor stays a personal study room; it does not
          open professional matters, billing, or firm administration.
        </p>
        <Link href="/app" className="mt-3 inline-block text-sm font-semibold text-accent underline">
          Professional workspace →
        </Link>
      </Panel>
    </StudentShell>
  );
}
