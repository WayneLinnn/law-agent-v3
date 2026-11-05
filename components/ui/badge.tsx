import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs leading-5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-action text-white",
        secondary: "border-transparent bg-aside text-foreground",
        outline: "border-line bg-surface text-foreground",
        warn: "border-transparent bg-seal text-white",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
