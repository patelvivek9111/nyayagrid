const STORAGE_KEY = "nyaya-professor-settings";

export type ProfessorExplanationLevel = "simple" | "standard" | "advanced";

export type ProfessorClientSettings = {
  explanationLevel: ProfessorExplanationLevel;
  showStudyAidReminder: boolean;
};

const DEFAULTS: ProfessorClientSettings = {
  explanationLevel: "standard",
  showStudyAidReminder: true,
};

export function loadProfessorSettings(): ProfessorClientSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ProfessorClientSettings>;
    return {
      explanationLevel:
        parsed.explanationLevel === "simple" ||
        parsed.explanationLevel === "standard" ||
        parsed.explanationLevel === "advanced"
          ? parsed.explanationLevel
          : DEFAULTS.explanationLevel,
      showStudyAidReminder:
        typeof parsed.showStudyAidReminder === "boolean"
          ? parsed.showStudyAidReminder
          : DEFAULTS.showStudyAidReminder,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveProfessorSettings(settings: ProfessorClientSettings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
