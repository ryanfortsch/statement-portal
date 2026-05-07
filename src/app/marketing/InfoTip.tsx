'use client';

// Small superscript "i" with a styled Radix tooltip on hover/focus/tap.
// Replaces the native title-attribute version, which had a 1-2 second
// browser delay and looked like a system bubble. Each instance has its
// own TooltipProvider so the marketing page can stay server-rendered
// and just drop these in where needed.

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function InfoTip({ tip }: { tip: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={tip}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 13,
              height: 13,
              borderRadius: '50%',
              border: '1px solid var(--ink-4)',
              color: 'var(--ink-4)',
              fontSize: 9,
              fontWeight: 600,
              lineHeight: 1,
              cursor: 'help',
              padding: 0,
              background: 'transparent',
              verticalAlign: 'top',
              marginTop: 1,
            }}
          >
            i
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          style={{ maxWidth: 280, fontSize: 12, lineHeight: 1.5, fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}
        >
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
