"use client";

// Auth-aware fetch for client pages: 401 → bounce to /login with ?next=.
export async function api<T = any>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(path, init);
  if (r.status === 401) {
    // never bounce to /login when we are already there — that nests
    // ?next=/login?next=... forever (it did, once)
    if (window.location.pathname === "/login") {
      const data = await r.json().catch(() => ({}) as T);
      return { ok: false, status: r.status, data };
    }
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    throw new Error("redirecting to login");
  }
  const data = await r.json().catch(() => ({}) as T);
  return { ok: r.ok, status: r.status, data };
}
