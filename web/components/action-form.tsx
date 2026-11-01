"use client";

import { useRef } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/**
 * A form that runs a server action and reports the result as a toast,
 * so a failed save (permissions, validation) never fails silently.
 */
export function ActionForm({ action, success, reset = false, className, children }: {
  action: (form: FormData) => Promise<ActionResult>;
  success?: string;
  reset?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className={className}
      action={async (form) => {
        const res = await action(form);
        if (!res.ok) toast.error(res.error);
        else {
          if (res.message ?? success) toast.success(res.message ?? success);
          if (reset) ref.current?.reset();
        }
      }}
    >
      {children}
    </form>
  );
}
