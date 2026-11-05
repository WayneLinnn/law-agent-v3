import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
