'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import type { CleanerApproval } from '@/lib/stay-concierge';
import {
  approveCleanerDraft,
  rejectCleanerDraft,
  markCleanerHandled,
  coachCleanerDraft,
} from './actions';
import { prettifyTopic, ageToneColor, relativeTimeShort } from '@/app/messaging/format';

type Props = { initialPending: CleanerApproval[] };

const REFRESH_MS = 15_000;

export function CleanerMessagingQueue({ initialPending }: Props) {
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  return (
    <Section
      title={initialPending.length === 0 ? 'Inbox zero' : `Pending (${initialPending.length})`}
      eyebrow={`refreshes every ${REFRESH_MS / 1000}s`}
      empty={initialPending.length === 0}
      emptyMessage="No cleaner-manager drafts waiting. Texts from Rosa or Nina show up here automatically."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {initialPending.map((approval) => (
          <CleanerApprovalCard
            key={approval.id}
            approval={approval}
            onResolved={() => router.refresh()}
          />
        ))}
      </div>
    </Section>
  );
}

type PendingAction = 'approve' | 'reject' | 'mark-handled' | 'coach' | null;

function CleanerApprovalCard({
  approval,
  onResolved,
}: {
  approval: CleanerApproval;
  onResolved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCoach, setShowCoach] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const nameLabel = approval.cleaner_name || approval.cleaner_contact || 'Cleaner';
  const topicLabel = prettifyTopic(approval.topic) || 'General';
  const langChip = approval.inbound_language === 'pt'
    ? 'they wrote PT'
    : approval.inbound_language === 'mixed'
      ? 'mixed PT/EN'
      : 'they wrote EN';

  const ageLabel =
    approval.age_minutes == null
      ? 'just now'
      : approval.age_minutes < 1
        ? 'just now'
        : approval.age_minutes < 60
          ? `${approval.age_minutes} min ago`
          : `${Math.floor(approval.age_minutes / 60)}h ${approval.age_minutes % 60}m ago`;

  const run = (action: PendingAction, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        setPendingAction(null);
        return;
      }
      onResolved();
    });
  };

  // If inbound was English, don't double-render English under it.
  const showInboundEnglish =
    approval.inbound_language === 'pt' || approval.inbound_language === 'mixed';
  const inboundEnglishText = approval.cleaner_text_english?.trim();

  return (
    <article
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--paper-2)',
        padding: 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>
            {nameLabel}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {topicLabel} · {langChip}
          </span>
        </div>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }} title={approval.created_at}>
          {'drafted '}
          <span
            style={{
              color: ageToneColor(approval.age_minutes),
              fontWeight: ageToneColor(approval.age_minutes) === 'var(--signal)' ? 700 : 500,
            }}
          >
            {ageLabel}
          </span>
          {' · id '}
          {approval.short_id}
        </span>
      </header>

      <div className="rt-msg-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldBlock
          label="They said"
          sub={relativeTimeShort(approval.created_at) ? `sent ${relativeTimeShort(approval.created_at)}` : ''}
          subTitle={approval.created_at}
        >
          <BodyText>{approval.cleaner_text || '(empty)'}</BodyText>
          {showInboundEnglish && inboundEnglishText && (
            <TranslationLine label="English">{inboundEnglishText}</TranslationLine>
          )}
        </FieldBlock>
        <FieldBlock label="Proposed reply (Portuguese)">
          <BodyText emphasis>{approval.draft || '(no draft)'}</BodyText>
          {approval.draft_english?.trim() && (
            <TranslationLine label="English">{approval.draft_english}</TranslationLine>
          )}
        </FieldBlock>
      </div>

      {error && (
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
          {error}
        </p>
      )}

      <footer
        style={{
          marginTop: 18,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <PrimaryButton
          onClick={() => run('approve', () => approveCleanerDraft(approval.id))}
          disabled={isPending}
        >
          {pendingAction === 'approve' ? 'Sending…' : 'Approve & send'}
        </PrimaryButton>
        <SecondaryButton onClick={() => setShowCoach((v) => !v)} disabled={isPending}>
          {showCoach ? 'Cancel coaching' : 'Coach the AI'}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => run('mark-handled', () => markCleanerHandled(approval.id))}
          disabled={isPending}
          title="Already replied directly. Clears the queue without sending."
        >
          {pendingAction === 'mark-handled' ? 'Clearing…' : 'Mark handled'}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => run('reject', () => rejectCleanerDraft(approval.id))}
          disabled={isPending}
          title="This message doesn't need a reply. Drops the draft."
        >
          {pendingAction === 'reject' ? 'Skipping…' : 'Reject'}
        </SecondaryButton>
      </footer>

      {showCoach && (
        <div style={{ marginTop: 14 }}>
          <label
            htmlFor={`cleaner-coach-${approval.id}`}
            className="eyebrow"
            style={{ display: 'block', marginBottom: 6, color: 'var(--ink-3)' }}
          >
            Coaching note
          </label>
          <textarea
            id={`cleaner-coach-${approval.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Say what's wrong with the Portuguese draft. You can write in English — the AI will regenerate in PT."
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 14,
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <PrimaryButton
              onClick={() =>
                run('coach', async () => {
                  const res = await coachCleanerDraft(approval.id, feedback);
                  if (res.ok) {
                    setFeedback('');
                    setShowCoach(false);
                  }
                  return res;
                })
              }
              disabled={isPending || !feedback.trim()}
            >
              {pendingAction === 'coach' ? 'Regenerating…' : 'Regenerate with this note'}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                setShowCoach(false);
                setFeedback('');
              }}
              disabled={isPending}
            >
              Cancel
            </SecondaryButton>
          </div>
        </div>
      )}
    </article>
  );
}

function FieldBlock({
  label,
  sub,
  subTitle,
  children,
}: {
  label: string;
  sub?: string;
  subTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="eyebrow"
        style={{
          marginBottom: 6,
          color: 'var(--ink-4)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>{label}</span>
        {sub && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: '0.10em',
              color: 'var(--ink-3)',
              textTransform: 'none',
            }}
            title={subTitle}
          >
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function BodyText({ children, emphasis = false }: { children: React.ReactNode; emphasis?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.55,
        color: emphasis ? 'var(--ink)' : 'var(--ink-2)',
        whiteSpace: 'pre-wrap',
        fontWeight: emphasis ? 500 : 400,
      }}
    >
      {children}
    </p>
  );
}

function TranslationLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px dashed var(--rule)',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--ink-3)',
        fontStyle: 'italic',
      }}
    >
      <span
        className="eyebrow"
        style={{ fontStyle: 'normal', color: 'var(--ink-4)', marginRight: 6 }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--ink-4)' : 'var(--ink)',
        color: 'var(--paper)',
        border: '2px solid var(--ink)',
        padding: '13px 22px',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'var(--paper)',
        color: 'var(--ink-2)',
        border: '1px solid var(--ink-3)',
        padding: '10px 16px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
