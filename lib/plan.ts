// Rule-based handover plan (fixes-only #3).
// Turns the role-filtered published claims into a "Start here" action list
// plus grouped sections, so the incoming person knows what to do on day one.
// Pure functions, no model call — and it only ever receives claims that
// /api/view already filtered for the viewer's role.

import { Claim } from "./types";

export type PlanKind =
  | "conflict"
  | "dependency"
  | "stale"
  | "gap"
  | "open-question"
  | "owner";

export interface PlanAction {
  claimId: string;
  kind: PlanKind;
  /** one-line instruction for the incoming person */
  action: string;
  /** the claim's own text, for context */
  claimText: string;
  /** true when the source claim is only Inferred — confirm before relying */
  inferred: boolean;
}

export interface PlanSection {
  key: string;
  label: string;
  claims: Claim[];
}

export interface HandoverPlan {
  startHere: PlanAction[];
  sections: PlanSection[];
}

/** Severity order: conflicts first, then access, stale work, gaps, questions, ownership. */
const KIND_ORDER: PlanKind[] = [
  "conflict",
  "dependency",
  "stale",
  "gap",
  "open-question",
  "owner",
];

function actionFor(cl: Claim): PlanAction | null {
  let kind: PlanKind;
  let action: string;

  if (cl.status === "conflicting") {
    kind = "conflict";
    action = `Resolve: ${cl.topic || cl.text} (sources disagree)`;
  } else if (cl.status === "missing") {
    kind = "gap";
    action = "Ask the previous owner why this was decided";
  } else if (cl.type === "dependency") {
    kind = "dependency";
    action = `Get access/ownership: ${cl.text}`;
  } else if (cl.stale) {
    kind = "stale";
    action = `Decide whether this is still needed: ${cl.text}`;
  } else if (cl.type === "open-question") {
    kind = "open-question";
    action = `Find out: ${cl.text}`;
  } else if (cl.type === "owner") {
    kind = "owner";
    action = `Take over: ${cl.text}`;
  } else {
    return null; // risks/contacts/decisions are context, not actions
  }

  if (!cl.id) return null; // never emit an action with no claim to link to
  return {
    claimId: cl.id,
    kind,
    action,
    claimText: cl.text,
    inferred: cl.status === "inferred",
  };
}

export function buildPlan(claims: Claim[]): HandoverPlan {
  // "Start here": one action per claim, ordered by severity, top 7
  const actions: PlanAction[] = [];
  const seen = new Set<string>();
  for (const kind of KIND_ORDER) {
    for (const cl of claims) {
      if (actions.length >= 7) break;
      const a = actionFor(cl);
      if (!a || a.kind !== kind || seen.has(a.claimId)) continue;
      seen.add(a.claimId);
      actions.push(a);
    }
  }
  actions.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  // Grouped sections (collapsible in the UI, with counts)
  const sections: PlanSection[] = [
    {
      key: "decisions",
      label: "Key decisions",
      claims: claims.filter((c) => c.type === "decision" && c.status !== "missing"),
    },
    {
      key: "ownership",
      label: "Ownership",
      claims: claims.filter((c) => c.type === "owner"),
    },
    {
      key: "risks",
      label: "Risks and dependencies",
      claims: claims.filter((c) => c.type === "risk" || c.type === "dependency"),
    },
    {
      key: "questions",
      label: "Open questions and gaps",
      claims: claims.filter((c) => c.type === "open-question" || c.status === "missing"),
    },
    {
      key: "contacts",
      label: "Contacts",
      claims: claims.filter((c) => c.type === "contact"),
    },
  ];

  return { startHere: actions, sections: sections.filter((s) => s.claims.length > 0) };
}
