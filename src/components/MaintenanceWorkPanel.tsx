import { InboxFollowup } from './InboxFollowup';
import { WorkOutcomeDetails } from './MessageOutcomes';
import { workStatus, workError, type OutcomeSource, type WorkOutcome } from '@/lib/message-outcomes';

type Props = {
  id: string;
  work: NonNullable<OutcomeSource['maintenance_work']>;
  outcome?: WorkOutcome;
  create: boolean;
  busy: boolean;
  dismissing: boolean;
  onCreateChange: (create: boolean) => void;
  onDismiss: () => void;
};

/** The work slip a guest's maintenance report implies: its state word and
 *  whether it needs a look. Shared by the panel and the guest card's Also on
 *  approve line. */
export function maintenanceWorkState({ work, outcome, create }: Pick<Props, 'work' | 'outcome' | 'create'>) {
  const hasSlip = !!(work.slip_id || outcome?.id);
  const dismissed = work.status === 'dismissed' || outcome?.status === 'dismissed';
  const completed = outcome?.status === 'done';
  const error = workError(work);
  return {
    title: outcome?.title || work.title,
    hasSlip,
    dismissed,
    completed,
    error,
    attention: !!error || !!outcome?.error || outcome?.status === 'blocked' || outcome?.status === 'unavailable',
    status: error || outcome?.error ? 'Needs review' : dismissed ? 'Dismissed' : completed ? 'Completed' : hasSlip ? outcome ? workStatus(outcome.status, outcome.assignee) : 'Created' : create ? 'Create when approved' : 'Skip',
  };
}

/** The slip's controls: create or skip before approve, open or dismiss after. */
export function MaintenanceWorkControls({ id, work, outcome, create, busy, dismissing, onCreateChange, onDismiss }: Props) {
  const { hasSlip, dismissed, completed, error } = maintenanceWorkState({ work, outcome, create });
  return <>
    {outcome && (hasSlip || outcome.id)
      ? <WorkOutcomeDetails work={outcome} />
      : <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1)' }}>{work.title}</p>}
    {dismissed ? (!outcome && <p style={{ fontSize: 12 }}>Work slip dismissed.</p>) : hasSlip ? (
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 8, fontSize: 12 }}>
        {!outcome && <a href={`/work/${encodeURIComponent(work.slip_id)}`} style={{ color: 'var(--ink-2)' }}>Open work slip ↗</a>}
        {!completed && !!work.slip_id && <button type="button" className="eyebrow" disabled={busy || dismissing} onClick={onDismiss}
          style={{ background: 'none', border: 0, color: 'var(--ink-3)', cursor: 'pointer', textDecoration: 'underline' }}>{dismissing ? 'Dismissing…' : 'Dismiss slip'}</button>}
      </div>
    ) : (
      <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0', display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12 }} disabled={busy}>
        <legend className="sr-only">Property work slip</legend>
        <label><input type="radio" name={`work-${id}`} checked={create} onChange={() => onCreateChange(true)} /> Create when I approve</label>
        <label><input type="radio" name={`work-${id}`} checked={!create} onChange={() => onCreateChange(false)} /> Skip</label>
      </fieldset>
    )}
    {error && !(outcome && (hasSlip || outcome.id)) && <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)' }}>{error}</p>}
  </>;
}

export function MaintenanceWorkPanel(props: Props) {
  const state = maintenanceWorkState(props);
  return <InboxFollowup ariaLabel="Property work slip" title={`Work slip · ${state.title}`} attention={state.attention} status={state.status}>
    <MaintenanceWorkControls {...props} />
  </InboxFollowup>;
}
