'use client';

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PilotConversation } from '@/lib/calderwood-inbox-core';
import type { ThreadMessage } from '@/lib/stay-concierge';
import { CHANNEL_LABELS } from '@/lib/channels-types';
import { validInterval } from '@/lib/calderwood-workspace';
import { PilotFrame, PilotIcon } from '../PilotFrame';
import { syncReservationInspector } from './reservation-inspector';
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
function dateDetail(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return `${new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} · ${value.slice(0, 4)}`;
}
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts = [];
  let start = 0;
  let index = text.toLowerCase().indexOf(needle);
  while (index !== -1) {
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    start = index + needle.length;
    index = text.toLowerCase().indexOf(needle, start);
  }
  return <>{parts}{text.slice(start)}</>;
}
function channelName(value: string) { return CHANNEL_LABELS[value as keyof typeof CHANNEL_LABELS] ?? value; }
function ChannelBadge({ channel }: { channel: string }) {
  const name = channelName(channel || 'Unknown');
  const key = name.toLowerCase().includes('airbnb') ? 'airbnb' : name.toLowerCase().includes('vrbo') ? 'vrbo' : 'other';
  return <span className={s.channelBadge} data-channel={key}><i aria-hidden="true"/>{name}</span>;
}
const stayLabels: Record<string, string> = { in_house: 'Staying now', upcoming: 'Upcoming', checked_out: 'Past stay' };
const viaLabels: Record<string, string> = { guesty_auto: 'Automated', helm_ai: 'AI-assisted', team: 'Team', operator: 'Sent from Helm' };

const dockedQuery = '(min-width: 1380px)';
function subscribeToLayout(onChange: () => void) {
  const query = window.matchMedia(dockedQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function getDockedLayout() { return window.matchMedia(dockedQuery).matches; }
function getServerLayout() { return false; }

export function PilotInbox({ data, bookingId }: { data: InboxData; bookingId?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [channel, setChannel] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [messageQuery, setMessageQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [mobileThread, setMobileThread] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const docked = useSyncExternalStore(subscribeToLayout, getDockedLayout, getServerLayout);
  const [pending, transition] = useTransition();
  const router = useRouter();
  const timeline = useRef<HTMLDivElement>(null);
  const detailsPanel = useRef<HTMLDialogElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const detailsOpener = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const c = data.selected;
  const channels = [...new Set(data.conversations.map(r => r.channel))].sort();
  const matches = messageQuery.trim() ? data.messages.flatMap((m, i) => m.body?.toLowerCase().includes(messageQuery.trim().toLowerCase()) ? [i] : []) : [];
  const currentMatch = matches.length ? matchIndex % matches.length : -1;
  const arrival = c?.booking?.check_in || c?.check_in || '';
  const departure = c?.booking?.check_out || c?.check_out || '';
  const nights = validInterval(arrival, departure) ? Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000) : null;
  const conversationNights = c && validInterval(c.check_in, c.check_out) ? Math.round((Date.parse(c.check_out) - Date.parse(c.check_in)) / 86400000) : null;
  const datesDiffer = !!c?.booking && ((!!c.check_in && c.check_in !== c.booking.check_in) || (!!c.check_out && c.check_out !== c.booking.check_out));
  const stayIssue = c ? !c.booking ? 'Unmatched stay' : datesDiffer ? 'Dates differ' : c.booking.status === 'cancelled' ? 'Cancelled reservation' : null : null;
  const rows = data.conversations.filter(r =>
    (!bookingId || r.booking?.id === bookingId) &&
    (filter === 'all' || r.stay_status === filter) &&
    (channel === 'all' || r.channel === channel) &&
    `${r.guest_full} ${r.channel} ${r.last_preview} ${r.booking?.external_confirmation_code ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    const panel = detailsPanel.current;
    if (!panel) return;
    const opener = detailsOpener.current;
    syncReservationInspector(
      panel,
      showDetails ? docked ? 'docked' : 'modal' : 'closed',
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
      opener?.isConnected ? opener : detailsButton.current,
    );
  }, [showDetails, docked]);
  useEffect(() => { const el = timeline.current; if (el) el.scrollTop = el.scrollHeight; }, [c?.conversation_id, data.messages.length, mobileThread]);

  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const matchedMessage = currentMatch < 0 ? -1 : matches[currentMatch];
  useEffect(() => {
    if (matchedMessage >= 0) timeline.current?.querySelector(`[data-message-index="${matchedMessage}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [matchedMessage, messageQuery, c?.conversation_id]);

  function closeSearch() { setSearchOpen(false); setMessageQuery(''); setMatchIndex(0); searchButton.current?.focus(); }
  function closeDetails() { setShowDetails(false); }
  function openDetails(button: HTMLButtonElement) { detailsOpener.current = button; setShowDetails(true); }
  function navigate(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setMobileThread(true);
    setMessageQuery('');
    setMatchIndex(0);
    transition(() => router.push(href, { scroll: false }));
  }

  const reservationDetails = <>
    <div className={s.detailsBody}>
      <div className={s.propertyCard}><span className={s.propertyIcon}><PilotIcon name="home" size={22}/></span><div><h3>65 Calderwood</h3><p>Calderwood Court</p></div></div>
      {c ? <>
        <div className={s.stayState}><span className={s.statusPill} data-status={c.booking?.status || 'unknown'}>{c.booking?.status || 'Unverified'}</span>{nights !== null && <span><PilotIcon name="moon" size={13}/>{nights} {nights === 1 ? 'night' : 'nights'}</span>}</div>
        <div className={s.stayDates}><div><span>Check-in</span><strong>{date(arrival)}</strong><small>{dateDetail(arrival)}</small></div><PilotIcon name="arrow" size={16}/><div><span>Check-out</span><strong>{date(departure)}</strong><small>{dateDetail(departure)}</small></div></div>
        <div className={s.reservationSection}><h3>Guest & booking</h3><dl className={s.facts}>
          <div><dt><PilotIcon name="people" size={14}/>Guest</dt><dd>{c.guest_full || 'Not recorded'}</dd></div>
          <div><dt><PilotIcon name="people" size={14}/>Party size</dt><dd>{c.booking?.num_guests != null ? <>{c.booking.num_guests} {c.booking.num_guests === 1 ? 'guest' : 'guests'}</> : 'Not recorded'}</dd></div>
          <div><dt><PilotIcon name="channel" size={14}/>Channel</dt><dd><ChannelBadge channel={c.booking?.channel || c.channel}/></dd></div>
          <div><dt><PilotIcon name="reservations" size={14}/>Reference</dt><dd className={s.confirmation}>{c.booking?.external_confirmation_code || 'Not recorded'}</dd></div>
        </dl></div>
        {c.booking ? <>
          <Link className={s.reservationLink} href={`/channels/pilot?booking=${encodeURIComponent(c.booking.id)}`}><PilotIcon name="reservations" size={15}/>View reservation<PilotIcon name="arrow" size={14}/></Link>
          {datesDiffer && <div className={s.contextNote}><PilotIcon name="info" size={16}/><p>Dates need review. The conversation shows {date(c.check_in, true)} to {date(c.check_out, true)}.</p></div>}
        </> : <div className={s.contextNote}><PilotIcon name="info" size={16}/><p>No unique reservation match. Dates are from conversation metadata.</p></div>}
      </> : <p className={s.note}>Select a guest to see their stay details.</p>}
      <details className={s.sourceDetails}><summary>Source & history</summary><p>{c?.source === 'guesty' ? 'Messages are read through Guesty via Stay Concierge.' : 'Messages are read from Helm’s existing records.'} Up to 200 messages are shown. Attachments and complete history are not yet verified.</p><p>Updated {time(data.asOf, true)} ET. Opening or refreshing this view does not mark messages read.</p></details>
    </div>
    <div className={s.contextFoot}><PilotIcon name="baseline" size={14}/><span>Reservation changes are disabled.</span></div>
  </>;

  return <PilotFrame section="inbox">
    <div className={s.workspace}>
      {data.errors.map(e => <div key={e} role="alert" className={s.warning}><PilotIcon name="info" size={16}/><span>{e}</span></div>)}
      <div className={`${s.columns} ${mobileThread ? s.mobileThread : ''} ${docked && showDetails ? s.withDetails : ''}`}>
        <aside className={s.list} aria-label="Conversations">
          <div className={s.listHeading}>
            <div><h1>Inbox</h1><span className={s.total} aria-label={`${rows.length} matching conversations`}>{rows.length}</span></div>
            <label className={s.channelFilter}><span className={s.srOnly}>Filter by channel</span><select value={channel} onChange={e => setChannel(e.target.value)}><option value="all">All channels</option>{channels.map(value => <option key={value} value={value}>{channelName(value || 'Unknown')}</option>)}</select><PilotIcon name="down" size={11}/></label>
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
                <span className={s.rowAvatar} aria-hidden="true">{initials(r.guest_full)}</span>
                <div className={s.rowContent}><div className={s.rowTitle}><strong title={r.guest_full}>{r.guest_full || 'Guest'}</strong><time dateTime={r.last_activity_at} title={`${time(r.last_activity_at, true)} ET`}>{activity(r.last_activity_at, data.asOf)}</time></div>
                <p>{r.last_preview || 'Open conversation'}</p>
                <div className={s.rowMeta}><ChannelBadge channel={r.channel}/><span>{date(r.check_in)} – {date(r.check_out)}</span>{stayLabels[r.stay_status] && <small data-status={r.stay_status} title={stayLabels[r.stay_status]}>{r.stay_status === 'in_house' ? 'In house' : stayLabels[r.stay_status]}</small>}</div></div>
              </Link>;
            })}
            {!rows.length && <div className={s.empty}><span><PilotIcon name="search" size={24}/></span><h3>{query || filter !== 'all' || channel !== 'all' ? 'No matching conversations' : 'No conversations yet'}</h3><p>{query || filter !== 'all' || channel !== 'all' ? 'Try another name or select all conversations.' : bookingId ? 'No linked conversation was returned for this reservation.' : 'Nothing was returned in the recent conversation window.'}</p>{(query || filter !== 'all' || channel !== 'all') && <button onClick={() => { setQuery(''); setFilter('all'); setChannel('all'); }}>Clear filters</button>}</div>}
          </div>
          <div className={s.listFoot}><span><PilotIcon name="history" size={12}/>Last 60 days</span><span>Updated {time(data.asOf)} ET</span></div>
        </aside>

        <main className={s.thread} aria-label="Conversation history" aria-busy={pending}>
          <div className={s.threadHeader}>
            <header className={s.threadHead}>
              <button className={s.backButton} aria-label="Back to conversations" onClick={() => setMobileThread(false)}><PilotIcon name="back"/></button>
              <div className={s.threadIdentity}><h2 title={c?.guest_full}>{c?.guest_full || 'Your guest conversations'}</h2>{!c && <p>Choose a conversation to get started</p>}</div>
              <button ref={searchButton} className={`${s.iconButton} ${searchOpen ? s.pressed : ''}`} aria-label="Search this conversation" aria-expanded={searchOpen} disabled={!c || !!data.threadError || !data.messages.length} title="Search this conversation" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}><PilotIcon name="search" size={17}/></button>
              <button ref={detailsButton} className={s.detailsButton} aria-label={showDetails ? 'Hide reservation details' : 'View reservation details'} aria-controls="reservation-details" aria-expanded={showDetails} disabled={!c} onClick={e => showDetails ? closeDetails() : openDetails(e.currentTarget)}><PilotIcon name="panel" size={16}/><span>Stay details</span></button>
            </header>
            {c && <div className={s.stayStrip}><div><ChannelBadge channel={c.channel}/><strong>{date(c.check_in)} <span>→</span> {date(c.check_out)}</strong>{conversationNights !== null && <span>{conversationNights} {conversationNights === 1 ? 'night' : 'nights'}</span>}</div>{stayIssue ? <button className={s.stayIssue} aria-controls="reservation-details" aria-expanded={showDetails} onClick={e => openDetails(e.currentTarget)}><PilotIcon name="info" size={14}/>{stayIssue}</button> : stayLabels[c.stay_status] && <span className={s.stayChip} data-status={c.stay_status}>{stayLabels[c.stay_status]}</span>}</div>}
          </div>
          {searchOpen && <div className={s.threadSearch} onKeyDown={e => { if (e.key === 'Escape') closeSearch(); if (e.key === 'Enter' && e.target === searchInput.current && matches.length) setMatchIndex((currentMatch + (e.shiftKey ? matches.length - 1 : 1)) % matches.length); }}>
            <PilotIcon name="search" size={15}/><input ref={searchInput} aria-label="Find in conversation" placeholder="Find in this conversation…" value={messageQuery} onChange={e => { setMessageQuery(e.target.value); setMatchIndex(0); }}/><span role="status">{messageQuery.trim() ? matches.length ? `${currentMatch + 1} of ${matches.length} ${matches.length === 1 ? 'message' : 'messages'}` : 'No matches' : ''}</span>
            <button aria-label="Previous matching message" disabled={!matches.length} onClick={() => setMatchIndex((currentMatch + matches.length - 1) % matches.length)}><PilotIcon name="up" size={15}/></button><button aria-label="Next matching message" disabled={!matches.length} onClick={() => setMatchIndex((currentMatch + 1) % matches.length)}><PilotIcon name="down" size={15}/></button><button aria-label="Close conversation search" onClick={closeSearch}><PilotIcon name="close" size={15}/></button>
          </div>}
          {pending && <div className={s.progress} role="status">Loading conversation…</div>}
          {data.threadError ? <div className={s.empty}><span><PilotIcon name="info" size={24}/></span><h3>Messages couldn’t load</h3><p>{data.threadError}</p><button disabled={pending} onClick={() => transition(() => router.refresh())}>Try again</button></div> : <div ref={timeline} className={s.messages}>
            {data.messages.map((m, i) => <div key={`${m.id}:${i}`} className={`${s.messageGroup} ${matchedMessage === i ? s.matched : ''}`} data-message-index={i}>
              {(i === 0 || day(data.messages[i - 1].at) !== day(m.at)) && <div className={s.dayDivider}><span>{day(m.at)}</span></div>}
              {m.via === 'guesty_auto' ? <details key={`${m.id}:${matches.includes(i)}`} className={s.automationMessage} open={matches.includes(i) || undefined}>
                <summary><span className={s.automationIcon}><PilotIcon name="automation" size={15}/></span><span className={s.automationTitle}><strong><PilotIcon name="automation" size={12}/>Automated message</strong><span>{m.sender_name || 'Host'} · {m.body?.replace(/\s+/g, ' ').trim().slice(0, 140) || 'No text content'}</span></span><time dateTime={m.at} title={`${time(m.at, true)} ET`}>{time(m.at)}</time><PilotIcon name="down" size={14}/></summary>
                <div className={s.automatedBody}><Highlight text={m.body || 'This message has no text content.'} query={messageQuery}/></div>
              </details> : <article className={`${s.message} ${m.who === 'host' ? s.host : ''}`}>
                <div className={s.messageContent}>
                  <div className={s.sender}><strong>{m.sender_name || (m.who === 'guest' ? c?.guest_full || 'Guest' : 'Host')}</strong>{m.via && <span>{viaLabels[m.via] || m.via}</span>}<time dateTime={m.at} title={`${time(m.at, true)} ET`}>{time(m.at)}</time></div>
                  <div className={s.bubble}><Highlight text={m.body || 'This message has no text content.'} query={messageQuery}/></div>
                </div>
              </article>}
            </div>)}
            {!data.messages.length && <div className={s.empty}><span><PilotIcon name="message" size={25}/></span><h3>{c ? 'No messages returned' : 'Select a conversation'}</h3><p>{c ? 'The source hasn’t returned any messages. Complete history is not yet verified.' : 'Guest messages and stay details will appear here.'}</p></div>}
          </div>}
          <footer className={s.readOnly}><span><PilotIcon name="lock" size={13}/>Read-only conversation</span><Link href="/messaging">Open guest messaging <PilotIcon name="external" size={13}/></Link></footer>
        </main>

        <dialog id="reservation-details" ref={detailsPanel} onCancel={e => { e.preventDefault(); closeDetails(); }} onKeyDown={e => { if (docked && e.key === 'Escape') { e.preventDefault(); closeDetails(); } }} className={`${s.details} ${docked ? s.docked : ''}`} aria-labelledby="reservation-title">
          <div className={s.detailsHeading}><h2 id="reservation-title">Stay details</h2><button className={s.closeDetails} aria-label="Close reservation details" autoFocus onClick={closeDetails}><PilotIcon name="close" size={17}/></button></div>
          {reservationDetails}
        </dialog>
      </div>
    </div>
  </PilotFrame>;
}
