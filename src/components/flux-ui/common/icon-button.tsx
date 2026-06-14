import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Lattice-style square icon button. Built on top of shadcn `Button`
 * (variant="ghost") with bespoke sizing + lattice colour tokens, and
 * wrapped in a shadcn `Tooltip` when a `tooltip` prop is provided.
 *
 * Sizes (match `.icon-btn` / `.icon-btn.tiny` / `.icon-btn.lstrip-icon`
 * from `lattice/src/App.css`):
 *  - default → 28×28
 *  - tiny    → 22×22
 *  - lstrip  → 30×30
 *
 * Hover / active colours match lattice's `var(--hover)` + `var(--text-normal)`.
 */

export type IconButtonSize = "default" | "tiny" | "lstrip";
export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface IconButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "size" | "variant"> {
  size?: IconButtonSize;
  /** Persistent pressed/selected styling — independent of :hover. */
  active?: boolean;
  /** When set, renders a shadcn `Tooltip` around the button. */
  tooltip?: string;
  tooltipSide?: TooltipSide;
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
  default: "h-7 w-7 [&_svg]:size-[var(--icon-md)]",
  tiny: "h-[22px] w-[22px] [&_svg]:size-[var(--icon-sm)]",
  lstrip: "h-[30px] w-[30px] [&_svg]:size-[var(--icon-md)]",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      size = "default",
      active,
      className,
      children,
      tooltip,
      tooltipSide = "bottom",
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const btn = (
      <Button
        ref={ref}
        variant="ghost"
        aria-label={ariaLabel ?? tooltip}
        aria-pressed={active ? true : undefined}
        className={cn(
          // Reset shadcn defaults that fight lattice sizing
          "p-0 rounded-[4px] border-0 bg-transparent shrink-0",
          "transition-[background,color,transform] duration-100 ease-out",
          "active:translate-y-0 active:scale-[0.94]",
          // Suppress shadcn's loud `focus-visible:ring-3` — Radix returns
          // focus programmatically to triggers after popovers close, and
          // Chromium treats that as keyboard focus → conspicuous ring on
          // these tiny lattice-style icon buttons. Lattice uses only the
          // hover state for affordance, so we mirror that.
          "focus-visible:ring-0 focus-visible:border-transparent",
          SIZE_CLASS[size],
          // Text colour (muted by default, normal on hover/active)
          active
            ? "text-[#2e2e2e] dark:text-[#dcddde]"
            : "text-[#6b6b6b] dark:text-[#8b8b8b]",
          "hover:text-[#2e2e2e] dark:hover:text-[#dcddde]",
          // Background — hover/active
          active
            ? "bg-[#ececea] dark:bg-[#2a2a2a]"
            : "hover:bg-[#ececea] dark:hover:bg-[#2a2a2a]",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...rest}
      >
        {children}
      </Button>
    );

    if (!tooltip) return btn;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side={tooltipSide} sideOffset={6}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  },
);
