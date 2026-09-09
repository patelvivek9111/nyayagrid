/**
 * Attempt lifecycle. RUNNING never jumps to RETRY_ALLOWED.
 */

export type AttemptState =
  | "RUNNING"
  | "ABORT_REQUESTED"
  | "HARD_KILL_REQUESTED"
  | "TERMINATED"
  | "RETRY_ALLOWED";

const ALLOWED: Record<AttemptState, AttemptState[]> = {
  RUNNING: ["ABORT_REQUESTED", "HARD_KILL_REQUESTED", "TERMINATED"],
  ABORT_REQUESTED: ["HARD_KILL_REQUESTED", "TERMINATED"],
  HARD_KILL_REQUESTED: ["TERMINATED"],
  TERMINATED: ["RETRY_ALLOWED"],
  RETRY_ALLOWED: ["RUNNING"],
};

export class AttemptLifecycle {
  state: AttemptState = "RETRY_ALLOWED";
  readonly id: string;
  pid: number | null = null;

  constructor(id: string) {
    this.id = id;
  }

  transition(next: AttemptState): void {
    const allowed = ALLOWED[this.state];
    if (!allowed.includes(next)) {
      throw new Error(`illegal attempt transition ${this.state} → ${next} (${this.id})`);
    }
    this.state = next;
  }

  get retryAllowed(): boolean {
    return this.state === "RETRY_ALLOWED";
  }
}

/** At most one live child for a provider/model/subsystem/task lineage. */
export class LiveAttemptGate {
  private liveKey: string | null = null;
  private livePid: number | null = null;

  get current(): { key: string; pid: number | null } | null {
    return this.liveKey ? { key: this.liveKey, pid: this.livePid } : null;
  }

  begin(key: string, pid?: number): void {
    if (this.liveKey) {
      throw new Error(
        `overlap: ${this.liveKey} still RUNNING; refused ${key}`,
      );
    }
    this.liveKey = key;
    this.livePid = pid ?? null;
  }

  setPid(pid: number): void {
    if (!this.liveKey) throw new Error("setPid without live attempt");
    this.livePid = pid;
  }

  end(key: string): void {
    if (this.liveKey !== key) {
      throw new Error(`end mismatch: live=${this.liveKey} end=${key}`);
    }
    this.liveKey = null;
    this.livePid = null;
  }
}
