"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export function UsersBoard({ users, me }: { users: UserDTO[]; me: { id: string } }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) setError(body.error ?? "Could not create the account.");
    else {
      setName("");
      setEmail("");
      setPassword("");
      setRole("member");
      router.refresh();
    }
  }

  async function remove(u: UserDTO) {
    if (!confirm(`Remove ${u.name}'s access (${u.email})?`)) return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Delete failed.");
    }
    router.refresh();
  }

  return (
    <div>
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-foreground">Invite someone</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-xs text-muted">
            <span className="mb-1 block">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input w-40" />
          </label>
          <label className="block text-xs text-muted">
            <span className="mb-1 block">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input w-56" />
          </label>
          <label className="block text-xs text-muted">
            <span className="mb-1 block">Password (share securely)</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} className="input w-44" placeholder="min 8 characters" />
          </label>
          <label className="block text-xs text-muted">
            <span className="mb-1 block">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-auto">
              <option value="member">Member — creation only</option>
              <option value="admin">Admin — everything</option>
            </select>
          </label>
          <button onClick={create} disabled={busy || !name || !email || !password} className="btn btn-primary">
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="mt-5 space-y-2">
        {users.map((u) => (
          <div key={u.id} className="card flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                {u.name} {u.id === me.id && <span className="text-xs text-faint">(you)</span>}
              </p>
              <p className="text-xs text-muted">{u.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`badge ${u.role === "admin" ? "bg-accent-soft text-accent" : "bg-foreground/8 text-muted"}`}>
                {u.role}
              </span>
              {u.id !== me.id && (
                <button onClick={() => remove(u)} className="text-xs text-danger/70 hover:text-danger">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
