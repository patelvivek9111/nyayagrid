"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Button, Panel, Badge } from "@nyayagrid/ui";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
};

export default function MatterTasksPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [title, setTitle] = useState("Matter");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const matterRes = await fetch(`/api/v1/matters/${matterId}`);
    const matterData = await matterRes.json();
    if (matterRes.ok) setTitle(`${matterData.matter.matterNumber} — ${matterData.matter.title}`);
    const res = await fetch(`/api/v1/matters/${matterId}/tasks`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load tasks");
    setTasks(data.tasks ?? []);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage(err.message));
  }, [matterId]);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch(`/api/v1/matters/${matterId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: taskTitle }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Create failed");
      return;
    }
    setTaskTitle("");
    await refresh();
  }

  async function completeTask(taskId: string) {
    const res = await fetch(`/api/v1/matters/${matterId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Update failed");
      return;
    }
    await refresh();
  }

  return (
    <MatterShell matterId={matterId} title={title}>
      <Panel title="Create task">
        <form className="flex flex-col gap-3" onSubmit={createTask}>
          <input
            className="rounded border border-line px-3 py-2"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title"
            required
          />
          <Button type="submit">Create task</Button>
        </form>
        {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
      </Panel>
      <div className="mt-4">
        <Panel title="Tasks">
          {tasks.length === 0 ? (
            <p className="text-sm text-ink/70">No tasks yet.</p>
          ) : (
            <ul className="space-y-3">
              {tasks.map((task) => (
                <li key={task.id} className="rounded border border-line px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{task.title}</span>
                    <Badge>{task.status}</Badge>
                    <Badge>{task.priority}</Badge>
                  </div>
                  {task.description ? <p className="mt-1 text-ink/70">{task.description}</p> : null}
                  {task.status !== "completed" ? (
                    <Button
                      className="mt-2"
                      type="button"
                      variant="secondary"
                      onClick={() => completeTask(task.id)}
                    >
                      Mark complete
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </MatterShell>
  );
}
