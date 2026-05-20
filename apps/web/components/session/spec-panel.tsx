"use client";

import { useState } from "react";
import { Button } from "@/components/primitives/button";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/primitives/badge";
import type { Spec } from "@openforge/db/schema";
interface ActiveSkillRef {
  source: "builtin" | "user" | "repo";
  slug: string;
}

interface Props {
  sessionId: string;
  spec: Spec;
  onAction: () => void;
}

export function SpecPanel({ sessionId, spec, onAction }: Props) {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  async function handleAction(action: "approve" | "reject") {
    setLoading(true);
    try {
      await apiFetch(`/api/sessions/${sessionId}/spec`, {
        method: "POST",
        body: {
          action,
          specId: spec.id,
          rejectionNote: action === "reject" ? rejectionNote : undefined,
        },
      });
      onAction();
    } finally {
      setLoading(false);
      setShowRejectForm(false);
    }
  }

  if (spec.status !== "draft") return null;

  const complexityVariant = {
    trivial: "success",
    small: "info",
    medium: "pending",
    large: "failure",
  }[spec.estimatedComplexity] as "success" | "info" | "pending" | "failure";

  return (
    <div className="overflow-hidden border border-stroke-subtle bg-surface-1/50">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 transition-colors duration-(--of-duration-instant) hover:bg-surface-2/50"
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg
          className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium text-text-primary">
          Spec — Review before implementing
        </span>
        <Badge variant={complexityVariant} className="ml-auto">
          {spec.estimatedComplexity}
        </Badge>
      </button>

      {open && (
        <div className="space-y-4 border-t border-stroke-subtle px-4 py-4">
          <Section label="Goal">
            <p className="text-sm text-text-secondary">{spec.goal}</p>
          </Section>

          <Section label="Approach">
            <p className="whitespace-pre-wrap text-sm text-text-secondary">{spec.approach}</p>
          </Section>

          {(spec.filesToModify.length > 0 || spec.filesToCreate.length > 0) && (
            <Section label="Files">
              <ul className="space-y-0.5">
                {spec.filesToModify.map((f) => (
                  <li key={f} className="flex items-center gap-2 font-mono text-xs text-text-secondary">
                    <span className="text-warning">M</span> {f}
                  </li>
                ))}
                {spec.filesToCreate.map((f) => (
                  <li key={f} className="flex items-center gap-2 font-mono text-xs text-text-secondary">
                    <span className="text-accent-text">A</span> {f}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {spec.risks.length > 0 && (
            <Section label="Risks">
              <ul className="list-inside list-disc space-y-0.5 text-sm text-text-secondary">
                {spec.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {spec.verificationPlan && (
            <Section label="Verification Plan">
              <p className="text-sm text-text-secondary">{spec.verificationPlan}</p>
            </Section>
          )}

          {showRejectForm && (
            <div className="space-y-2">
              <textarea
                placeholder="Describe what needs to change…"
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                rows={3}
                className="w-full border border-stroke-default bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors duration-(--of-duration-instant) focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => handleAction("approve")}
              disabled={loading}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Approve
            </Button>

            {showRejectForm ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleAction("reject")}
                disabled={loading || !rejectionNote.trim()}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Reject with note
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowRejectForm(true)}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Reject
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              className="sm:ml-auto"
              onClick={async () => {
                setLoading(true);
                try {
                  const { data } = await apiFetch<{ activeSkills?: ActiveSkillRef[] }>(
                    `/api/sessions/${sessionId}/skills`,
                  );
                  const next = (data.activeSkills ?? []).filter(
                    (s) => !(s.slug === "spec-first" && s.source === "builtin"),
                  );
                  await apiFetch(`/api/sessions/${sessionId}/skills`, {
                    method: "PATCH",
                    body: { activeSkills: next },
                  });
                  onAction();
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              Skip spec
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      {children}
    </div>
  );
}
