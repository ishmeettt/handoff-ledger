import Link from "next/link";

// Shown when a non-lead session opens a reviewer-only page (the API returns
// 403 by design — review S1-1). Explains the boundary instead of crashing.
export default function LeadOnly({ page }: { page: string }) {
  return (
    <>
      <h1>{page}</h1>
      <p className="subtitle">Reviewer tools are lead-only.</p>
      <div className="notice warn">
        Your session role doesn't include reviewer permissions — the API
        returns 403 for this page's data, by design. As an incoming member you
        get the published <Link href="/handover">Handover view</Link>, filtered
        to what your role may see.
      </div>
    </>
  );
}
