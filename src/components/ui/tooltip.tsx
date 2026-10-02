"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 12, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "z-50 max-h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-auto rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground data-[state=delayed-open]:animate-[kinetic-popover-in_180ms_cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-[kinetic-popover-out_100ms_ease-in] origin-(--radix-tooltip-content-transform-origin) motion-reduce:data-[state=delayed-open]:animate-[kinetic-overlay-in_120ms_ease-out]",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
