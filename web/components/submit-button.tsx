"use client";

import { useFormStatus } from "react-dom";

/** Submit button that disables itself while the server action runs, so nothing is logged twice. */
export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Saving…" : children}
    </button>
  );
}
