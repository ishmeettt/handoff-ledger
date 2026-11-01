"use client";

import { useEffect, useState } from "react";

interface Me {
  userId: string;
  name: string;
  role: string;
}

// Shows who you are signed as and provides logout. Rendered in the header.
export default function UserBar() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;
  if (!me) {
    return (
      <a href="/login" className="nav-cta" style={{ fontSize: "0.88rem" }}>
        Sign in
      </a>
    );
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <span className="userbar">
      <span className="userbar-name">
        {me!.name}
        <span className={`badge access-${me!.role === "lead" ? "restricted" : me!.role === "successor" ? "internal" : "public"}`} style={{ marginLeft: "0.45rem" }}>
          {me!.role}
        </span>
      </span>
      <button className="ghost small" onClick={logout} style={{ marginLeft: "0.6rem" }}>
        Sign out
      </button>
    </span>
  );
}
