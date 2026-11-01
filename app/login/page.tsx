"use client";

import { useEffect, useState } from "react";

interface DemoUser {
  username: string;
  name: string;
  role: string;
  roleLabel: string;
}

export default function LoginPage() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [username, setUsername] = useState("priya");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []));
  }, []);

  async function signIn(user?: string) {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user ?? username, password: user ? "handoff-demo" : password }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(d.error ?? "Sign-in failed.");
    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get("next") ?? "/";
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="subtitle">
        Handoff Ledger is permission-first: every API checks your signed session before returning
        anything. Choose a demo role to see exactly what that role is allowed to see.
      </p>

      <div className="grid grid-2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Demo roles (one click)</h2>
          {users.map((u) => (
            <button
              key={u.username}
              className="ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginBottom: "0.6rem", padding: "0.7rem 1rem" }}
              disabled={busy}
              onClick={() => signIn(u.username)}
            >
              <strong>{u.name}</strong>
              <div className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>
                {u.roleLabel} — password: <code>handoff-demo</code>
              </div>
            </button>
          ))}
        </div>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            signIn();
          }}
        >
          <h2 style={{ marginTop: 0 }}>Sign in with credentials</h2>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {err && <div className="notice err">{err}</div>}
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    </>
  );
}
