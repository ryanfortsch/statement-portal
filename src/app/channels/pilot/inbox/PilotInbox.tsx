'use client';

import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PilotConversation } from '@/lib/calderwood-inbox-core';
import type { ThreadMessage } from '@/lib/stay-concierge';
import { CHANNEL_LABELS } from '@/lib/channels-types';
import { validInterval } from '@/lib/calderwood-workspace';
import { PilotFrame, PilotIcon } from '../PilotFrame';
import s from './inbox.module.css';

export type InboxData = {
  conversations: PilotConversation[];
  selected: PilotConversation | null;
  messages: ThreadMessage[];
  errors: string[];
  threadError: string | null;
  asOf: string;
};

const timeOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' } as const;
function time(value: string, withDate = false) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', withDate ? { ...timeOptions, month: 'short', day: 'numeric' } : timeOptions)
    : 'Time unavailable';
}
function date(value: string, withYear = false) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' })
    : 'Not recorded';
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '?'; }
function day(value: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    : 'Date unavailable';
}
function activity(value: string, asOf: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  if (day(value) === day(asOf)) return time(value);
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}
function channelName(value: string) { return CHANNEL_LABELS[value as keyof typeof CHANNEL_LABELS] ?? value; }
function ChannelBadge({ channel }: { channel: string }) {
  const name = channelName(channel || 'Unknown');
  const key = name.toLowerCase().includes('airbnb') ? 'airbnb' : name.toLowerCase().includes('vrbo') ? 'vrbo' : 'other';
  return <span className={s.channelBadge} data-channel={key}><i aria-hidden="true"/>{name}</span>;
}
const stayLabels: Record<string, string> = { in_house: 'Staying now', upcoming: 'Upcoming', checked_out: 'Past stay' };
const viaLabels: Record<string, string> = { guesty_auto: 'Automated', helm_ai: 'AI-assisted', team: 'Team', operator: 'Sent from Helm' };

export function PilotInbox({ data, bookingId }: { data: InboxData; bookingId?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [mobileThread, setMobileThread] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [pending, transition] = useTransition();
  const router = useRouter();
  const timeline = useRef<HTMLDivElement>(null);
  const detailsPanel = useRef<HTMLElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const c = data.selected;
  const arrival = c?.booking?.check_in || c?.check_in || '';
  const departure = c?.booking?.check_out || c?.check_out || '';
  const nights = validInterval(arrival, departure) ? Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000) : null;
  const rows = data.conversations.filter(r =>
    (!bookingId || r.booking?.id === bookingId) &&
    (filter === 'all' || r.stay_status === filter) &&
    `${r.guest_full} ${r.channel} ${r.last_preview} ${r.booking?.external_confirmation_code ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => { if (showDetails) detailsPanel.current?.focus({ preventScroll: true }); }, [showDetails]);
  useEffect(() => { const el = timeline.current; if (el) el.scrollTop = el.scrollHeight; }, [c?.conversation_id, data.messages.length, mobileThread]);

  function closeDetails() { setShowDetails(false); detailsButton.current?.focus(); }
  function navigate(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setMobileThread(true);
    setShowDetails(false);
    transition(() => router.push(href, { scroll: false }));
  }

  return <PilotFrame section="inbox">
    <div className={s.workspace}>
      {data.errors.map(e => <div key={e} role="alert" className={s.warning}><PilotIcon name="info" size={16}/><span>{e}</span></div>)}
      <div className={`${s.columns} ${mobileThread ? s.mobileThread : ''} ${showDetails ? s.showDetails : ''}`}>
        <aside className={s.list} aria-label="Conversations">
          <div className={s.listHeading}>
            <div><h1>Inbox</h1><span className={s.total}>{data.conversations.length}</span></div>
            <button className={s.iconButton} disabled={pending} aria-label={pending ? 'Refreshing conversations' : 'Refresh conversations'} title={`Updated ${time(data.asOf)} ET. Refresh conversations`} onClick={() => transition(() => router.refresh())}><PilotIcon name="refresh" size={16}/></button>
          </div>
          <div className={s.listTools}>
            <label className={s.search}><PilotIcon name="search" size={16}/><span className={s.srOnly}>Search conversations</span><input type="search" placeholder="Search conversations" value={query} onChange={e => setQuery(e.target.value)}/></label>
            <div className={s.filters} role="group" aria-label="Filter conversations by stay">
              {([['all', 'All'], ['upcoming', 'Upcoming'], ['in_house', 'In house'], ['checked_out', 'Past']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
            </div>
            {bookingId && <div className={s.filterNotice}>One reservation <Link href="/channels/pilot/inbox">Show all</Link></div>}
          </div>
          <div className={s.conversationRows}>
            {rows.map(r => {
              const href = `/channels/pilot/inbox?conversation=${encodeURIComponent(r.conversation_id)}${bookingId ? `&booking=${encodeURIComponent(bookingId)}` : ''}`;
              return <Link key={r.conversation_id} className={`${s.row} ${r.conversation_id === c?.conversation_id ? s.active : ''}`} aria-current={r.conversation_id === c?.conversation_id ? 'true' : undefined} href={href} onClick={e => navigate(e, href)}>
                <div className={s.rowTitle}><strong>{r.guest_full || 'Guest'}</strong><time>{activity(r.last_activity_at, data.asOf)}</time></div>
                <p>{r.last_preview || 'Open conversation'}</p>
                <div className={s.rowMeta}><ChannelBadge channel={r.channel}/><span>{date(r.check_in)} – {date(r.check_out)}</span>{stayLabels[r.stay_status] && <small data-status={r.stay_status}>{stayLabels[r.stay_status]}</small>}</div>
              </Link>;
            })}
            {!rows.length && <div className={s.empty}><span><PilotIcon name="search" size={24}/></span><h3>{query || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}</h3><p>{query || filter !== 'all' ? 'Try another name or select all conversations.' : bookingId ? 'No linked conversation was returned for this reservation.' : 'Nothing was returned in the recent conversation window.'}</p>{(query || filter !== 'all') && <button onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button>}</div>}
          </div>
          <div className={s.listFoot}><span>Last 60 days</span><span>Updated {time(data.asOf)} ET</span></div>
        </aside>

        <main className={s.thread} aria-label="Conversation history" aria-busy={pending}>
          <header className={s.threadHead}>
            <button className={s.backButton} aria-label="Back to conversations" onClick={() => setMobileThread(false)}><PilotIcon name="back"/></button>
            <span className={s.headerAvatar}>{c ? initials(c.guest_full) : <PilotIcon name="message"/>}</span>
            <div className={s.threadIdentity}><h2>{c?.guest_full || 'Your guest conversations'}</h2><p>{c ? <><ChannelBadge channel={c.channel}/><span>·</span>{date(c.check_in)} – {date(c.check_out)}</> : 'Choose a conversation to get started'}</p></div>
            <button ref={detailsButton} className={s.detailsButton} aria-label="Toggle reservation details" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}><PilotIcon name="panel" size={18}/></button>
          </header>
          {pending && <div className={s.progress} role="status">Loading conversation…</div>}
          {data.threadError ? <div className={s.empty}><span><PilotIcon name="info" size={24}/></span><h3>Messages couldn’t load</h3><p>{data.threadError}</p><button disabled={pending} onClick={() => transition(() => router.refresh())}>Try again</button></div> : <div ref={timeline} className={s.messages}>
            {data.messages.map((m, i) => <div key={`${m.id}:${i}`} className={s.messageGroup}>
              {(i === 0 || day(data.messages[i - 1].at) !== day(m.at)) && <div className={s.dayDivider}><span>{day(m.at)}</span></div>}
              <article className={`${s.message} ${m.who === 'host' ? s.host : ''}`}>
                <span className={s.messageAvatar} aria-hidden="true">{m.who === 'host' ? <PilotIcon name="helm" size={16}/> : initials(m.sender_name || c?.guest_full || 'Guest')}</span>
                <div className={s.messageContent}>
                  <div className={s.sender}><strong>{m.sender_name || (m.who === 'guest' ? c?.guest_full || 'Guest' : 'Host')}</strong>{m.via && <span>{m.via === 'guesty_auto' && <PilotIcon name="automation" size={11}/>} {viaLabels[m.via] || m.via}</span>}<time dateTime={m.at}>{time(m.at)}</time></div>
                  <div className={s.bubble}>{m.body || 'This message has no text content.'}</div>
                </div>
              </article>
            </div>)}
            {!data.messages.length && <div className={s.empty}><span><PilotIcon name="message" size={25}/></span><h3>{c ? 'No messages returned' : 'Select a conversation'}</h3><p>{c ? 'The source hasn’t returned any messages. Complete history is not yet verified.' : 'Guest messages and stay details will appear here.'}</p></div>}
          </div>}
          <footer className={s.readOnly}><span><PilotIcon name="lock" size={13}/>Read-only conversation</span><Link href="/messaging">Open guest messaging <PilotIcon name="external" size={13}/></Link></footer>
        </main>

        <aside ref={detailsPanel} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') closeDetails(); }} className={s.details} aria-label="Reservation context">
          <div className={s.detailsHeading}><h2>Stay overview</h2><button className={s.closeDetails} aria-label="Close reservation details" onClick={closeDetails}><PilotIcon name="close" size={17}/></button></div>
          <div className={s.detailsBody}>
            <div className={s.propertyCard}><span className={s.propertyIcon}><PilotIcon name="home" size={22}/></span><div><span className={s.sectionLabel}>PROPERTY</span><h3>65 Calderwood</h3><p>Calderwood Court</p></div></div>
            {c ? <>
              <div className={s.stayState}><span className={s.statusPill} data-status={c.booking?.status || 'unknown'}>{c.booking?.status || 'Unverified'}</span>{nights !== null && <span><PilotIcon name="moon" size={13}/>{nights} {nights === 1 ? 'night' : 'nights'}</span>}</div>
              <div className={s.stayDates}><div><span>Check-in</span><strong>{date(arrival)}</strong><small>{arrival.slice(0, 4) || 'Not recorded'}</small></div><PilotIcon name="arrow" size={16}/><div><span>Check-out</span><strong>{date(departure)}</strong><small>{departure.slice(0, 4) || 'Not recorded'}</small></div></div>
              <div className={s.reservationSection}><h3>Reservation details</h3><dl className={s.facts}>
                <div><dt>Guest</dt><dd>{c.guest_full || 'Not recorded'}</dd></div>
                <div><dt>Party size</dt><dd>{c.booking?.num_guests != null ? <>{c.booking.num_guests} {c.booking.num_guests === 1 ? 'guest' : 'guests'}</> : 'Not recorded'}</dd></div>
                <div><dt>Channel</dt><dd><ChannelBadge channel={c.booking?.channel || c.channel}/></dd></div>
                <div><dt>Confirmation</dt><dd className={s.confirmation}>{c.booking?.external_confirmation_code || 'Not recorded'}</dd></div>
              </dl></div>
              {c.booking ? <>
                <Link className={s.reservationLink} href={`/channels/pilot?booking=${encodeURIComponent(c.booking.id)}`}><PilotIcon name="reservations" size={15}/>View reservation<PilotIcon name="arrow" size={14}/></Link>
                {((c.check_in && c.check_in !== c.booking.check_in) || (c.check_out && c.check_out !== c.booking.check_out)) && <div className={s.contextNote}><PilotIcon name="info" size={16}/><p>Dates need review. The conversation shows {date(c.check_in, true)} to {date(c.check_out, true)}.</p></div>}
              </> : <div className={s.contextNote}><PilotIcon name="info" size={16}/><p>No unique reservation match. Dates are from conversation metadata.</p></div>}
            </> : <p className={s.note}>Select a guest to see their stay details.</p>}
            <details className={s.sourceDetails}><summary>Source & history</summary><p>{c?.source === 'guesty' ? 'Messages are read through Guesty via Stay Concierge.' : 'Messages are read from Helm’s existing records.'} Up to 200 messages are shown. Attachments and complete history are not yet verified.</p><p>Updated {time(data.asOf, true)} ET. Opening or refreshing this view does not mark messages read.</p></details>
          </div>
          <div className={s.contextFoot}><PilotIcon name="baseline" size={14}/><span>Reservation changes are disabled.</span></div>
        </aside>
      </div>
    </div>
  </PilotFrame>;
}
