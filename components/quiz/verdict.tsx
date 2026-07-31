import { Check, CircleDot, RotateCcw } from "lucide-react";

import type { Verdict } from "@/lib/quiz/types";

/**
 * Verdict presentation.
 *
 * Ochre and rose rather than green and red: this is formative assessment, so a
 * wrong answer should read as "revisit", not "fail".
 *
 * Colour is never the only carrier — every verdict ships an icon AND a text
 * label. That covers colour blindness and it is what the axe check in the E2E
 * suite is guarding.
 */
export const VERDICT_PRESENTATION: Record<
  Verdict,
  { readonly label: string; readonly Icon: typeof Check; readonly tone: string }
> = {
  correct: { label: "Correct", Icon: Check, tone: "var(--sb-mark)" },
  partial: { label: "Nearly", Icon: CircleDot, tone: "var(--sb-mark)" },
  revisit: { label: "Revisit", Icon: RotateCcw, tone: "var(--sb-query)" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { label, Icon, tone } = VERDICT_PRESENTATION[verdict];

  return (
    <p className="flex items-center gap-2 text-[length:var(--sb-text-margin)] font-semibold">
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: tone }}
      >
        {/* Ochre fails text contrast on paper, so it is a FILL here and the
            glyph on top is ink. Never ochre text on the paper ground. */}
        <Icon className="h-3 w-3" style={{ color: "var(--sb-ink)" }} strokeWidth={3} />
      </span>
      <span style={{ color: "var(--sb-ink)" }}>{label}</span>
    </p>
  );
}
