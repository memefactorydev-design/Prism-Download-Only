"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectionStatus, Provider } from "@/lib/connections";

export interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  defaultValue?: string;
  hint?: string;
  options?: string[]; // when set, render a <select> instead of an input
}

export interface ProviderCardSpec {
  provider: Provider;
  title: string;
  blurb: string;
  steps: string[];
  fields: FieldSpec[];
}

export function ConnectionCard({
  spec,
  status,
}: {
  spec: ProviderCardSpec;
  status: ConnectionStatus;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(status.status !== "connected");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(spec.fields.map((f) => [f.key, f.defaultValue ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = status.status === "connected";

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/connections/${spec.provider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(body.error ?? `Failed (HTTP ${res.status}).`);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${spec.title}? The stored key will be deleted.`))
      return;
    await fetch(`/api/connections/${spec.provider}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border p-6 ">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{spec.title}</h2>
          <p className="mt-1 text-sm text-muted">{spec.blurb}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            connected
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-foreground/8 text-muted"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {connected && (
        <ConnectedDetails provider={spec.provider} metadata={status.metadata} />
      )}

      <div className="mt-4 flex gap-3 text-sm">
        <button
          onClick={() => setOpen(!open)}
          className="underline underline-offset-4"
        >
          {open ? "Hide setup" : connected ? "Update key" : "Set up"}
        </button>
        {connected && status.metadata?.source !== "env" && (
          <button
            onClick={disconnect}
            className="text-red-500 underline underline-offset-4"
          >
            Disconnect
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-xl bg-foreground/5 p-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted dark:text-faint">
            {spec.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="mt-4 space-y-3">
            {spec.fields.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="font-medium">{f.label}</span>
                {f.hint && (
                  <span className="ml-2 text-xs text-muted">{f.hint}</span>
                )}
                {f.options ? (
                  <select
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-accent  "
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.secret ? "password" : "text"}
                    value={values[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-border-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-accent "
                  />
                )}
              </label>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          <button
            onClick={save}
            disabled={busy}
            className="mt-4 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 "
          >
            {busy ? "Validating…" : "Validate & save"}
          </button>
          <p className="mt-2 text-xs text-muted">
            The key is checked against the live API before being stored,
            encrypted, on this machine.
          </p>
        </div>
      )}
    </div>
  );
}

// Non-secret facts captured at validation time, rendered per provider.
function ConnectedDetails({
  provider,
  metadata,
}: {
  provider: string;
  metadata: Record<string, unknown> | null;
}) {
  if (!metadata) return null;
  if (metadata.source === "env") {
    return (
      <p className="mt-3 text-sm text-muted">
        Using the key from your <code>.env</code> file. Save one here to move it
        into encrypted storage.
      </p>
    );
  }

  if (provider === "postiz") {
    const channels =
      (metadata.channels as { platform: string; name: string }[]) ?? [];
    const missing = (metadata.missingChannels as string[]) ?? [];
    return (
      <div className="mt-3 text-sm">
        {channels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c, i) => (
              <span
                key={i}
                className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs"
              >
                {c.platform}: {c.name}
              </span>
            ))}
          </div>
        )}
        {missing.length > 0 && (
          <p className="mt-2 text-amber-600 dark:text-amber-500">
            Still to connect inside Postiz: {missing.join(", ")} — open Postiz
            and link these accounts so every channel can publish.
          </p>
        )}
      </div>
    );
  }

  if (provider === "meta") {
    const caps = (metadata.capabilities as Record<string, boolean>) ?? {};
    const warnings = (metadata.warnings as string[]) ?? [];
    return (
      <div className="mt-3 space-y-1.5 text-sm">
        {metadata.accountName != null && (
          <p className="text-muted">Account: {String(metadata.accountName)}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Capability
            ok={!!caps.adLibraryResearch}
            label="Ad Library research"
          />
          <Capability ok={!!caps.insightsRead} label="Insights / ROAS read" />
          <Capability ok={!!caps.adsWrite} label="Campaign writes" />
        </div>
        {metadata.adsWriteState === "pending_app_review" && (
          <p className="text-amber-600 dark:text-amber-500">
            Campaign creation/editing stays locked until your Meta app passes
            App Review (ads_management permission). Research and reading work
            before that.
          </p>
        )}
        {warnings.map((w, i) => (
          <p key={i} className="text-amber-600 dark:text-amber-500">
            {w}
          </p>
        ))}
      </div>
    );
  }

  if (provider === "anthropic" && metadata.modelsAvailable != null) {
    return (
      <p className="mt-3 text-sm text-muted">
        Key verified — {String(metadata.modelsAvailable)} models available.
      </p>
    );
  }
  return null;
}

function Capability({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-foreground/8 text-muted "
      }`}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}
