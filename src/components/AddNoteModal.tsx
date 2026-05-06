'use client';

import { useState } from 'react';

/**
 * Two-step modal for capturing reservation eccentricities (the "Allie
 * sent an email about a refund and we need it on the August statement"
 * use case).
 *
 *   Step 1 (paste): operator pastes the email body and/or attaches the
 *     original .eml/.pdf/.csv. Submit hits /api/notes/extract which
 *     LLM-normalizes the freeform text into structured fields and
 *     returns up to 8 reservation candidates from a fuzzy guest-name
 *     search.
 *
 *   Step 2 (confirm): operator picks the right confirmation_code from
 *     the candidate list (or types one manually if none matched), edits
 *     the body if the LLM phrased it badly, and saves. /api/notes/save
 *     uploads the attachment to Supabase Storage and inserts the row.
 *
 * The two-step shape exists because the LLM is good at turning
 * "Guesty auto-charged Evan and I refunded half" into structured fields
 * but can't be trusted to nail the confirmation_code -- the operator
 * has to confirm. Avoiding that confirmation step would mean wrong
 * notes on wrong reservations and a debugging tax.
 */

type Candidate = {
  confirmation_code: string;
  guest_name: string;
  property_id: string;
  property_name: string;
  check_in: string | null;
  check_out: string | null;
  source: 'reservations' | 'guesty_reservations';
};

type Extraction = {
  guest_name_match: string;
  property_match: string;
  body: string;
  amounts_referenced: number[];
  dates_referenced: string[];
  confidence: 'high' | 'medium' | 'low';
};

type ExtractResponse = {
  extraction: Extraction;
  property_id_match: string | null;
  candidates: Candidate[];
  error?: string;
};

type Step = 'paste' | 'confirm' | 'saving' | 'saved';

export function AddNoteModal({ onClose, defaultAuthor }: { onClose: () => void; defaultAuthor?: string }) {
  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [propertyIdMatch, setPropertyIdMatch] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [editedBody, setEditedBody] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  async function handleProcess() {
    if (!text.trim() && !attachment) {
      setError('Paste some text or attach a file.');
      return;
    }
    setError(null);
    setStep('saving'); // borrowed state for "extracting" phase

    try {
      const fd = new FormData();
      fd.append('text', text);
      if (attachment) fd.append('attachment', attachment);

      const res = await fetch('/api/notes/extract', { method: 'POST', body: fd });
      const data: ExtractResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Extraction failed.');
        setStep('paste');
        return;
      }
      setExtraction(data.extraction);
      setCandidates(data.candidates || []);
      setPropertyIdMatch(data.property_id_match);
      setEditedBody(data.extraction.body);
      // Auto-select the first candidate if confidence is high and there's exactly one match.
      if (data.candidates.length === 1 && data.extraction.confidence === 'high') {
        setSelectedCode(data.candidates[0].confirmation_code);
      } else {
        setSelectedCode('');
      }
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed.');
      setStep('paste');
    }
  }

  async function handleSave() {
    const code = (selectedCode || manualCode).trim();
    if (!code) {
      setError('Pick a candidate or type a confirmation code.');
      return;
    }
    if (!editedBody.trim()) {
      setError('Body cannot be empty.');
      return;
    }
    setError(null);
    setStep('saving');

    try {
      const fd = new FormData();
      fd.append('confirmation_code', code);
      const propertyId =
        candidates.find(c => c.confirmation_code === code)?.property_id ||
        propertyIdMatch ||
        '';
      if (propertyId) fd.append('property_id', propertyId);
      fd.append('body', editedBody.trim());
      if (text.trim()) fd.append('source_text', text.trim());
      if (defaultAuthor) fd.append('author', defaultAuthor);
      if (extraction?.amounts_referenced?.length) {
        fd.append('amounts_referenced', JSON.stringify(extraction.amounts_referenced));
      }
      if (attachment) fd.append('attachment', attachment);

      const res = await fetch('/api/notes/save', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Save failed.');
        setStep('confirm');
        return;
      }
      setSavedNoteId(data.note?.id || 'saved');
      setStep('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setStep('confirm');
    }
  }

  const isProcessing = step === 'saving';

  return (
    <div
      onClick={isProcessing ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(30, 46, 52, 0.35)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 64, paddingBottom: 40,
        overflow: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          width: '100%', maxWidth: 720,
          padding: 28,
          boxShadow: '0 30px 80px -20px rgba(30,46,52,.25), 0 8px 24px -8px rgba(30,46,52,.1)',
        }}
      >
        {/* Header */}
        <div className="flex items-baseline justify-between" style={{ marginBottom: 18 }}>
          <div>
            <div className="eyebrow">Reservation note</div>
            <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', margin: '6px 0 0' }}>
              {step === 'paste' && 'Capture the eccentricity'}
              {step === 'confirm' && 'Confirm the details'}
              {step === 'saving' && (extraction ? 'Saving' : 'Reading')}
              {step === 'saved' && 'Saved'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-4)', cursor: isProcessing ? 'wait' : 'pointer' }}
            aria-label="close"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderLeft: '2px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 12, color: 'var(--ink-2)',
          }}>
            {error}
          </div>
        )}

        {/* Step 1: paste */}
        {step === 'paste' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16, lineHeight: 1.55 }}>
              Paste the email or describe what happened. The system will extract the affected
              reservation, dollar amounts, and dates so accounting sees them on the right statement.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Guesty auto-charged Evan Friese and I had to refund him half his reservation. The net Stripe payout that day to ...7876 was $175.02 because the first half of Paul Mangus' reservation was on its way."
              rows={8}
              style={{
                width: '100%',
                fontFamily: 'var(--font-inter, ui-sans-serif)',
                fontSize: 13, lineHeight: 1.5,
                padding: 12,
                border: '1px solid var(--rule)',
                background: 'var(--paper-2)',
                color: 'var(--ink)',
                resize: 'vertical',
                marginBottom: 14,
              }}
            />
            <div style={{ marginBottom: 18 }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                border: '1px solid var(--rule)',
                background: 'transparent',
                color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '8px 14px',
                cursor: 'pointer',
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {attachment ? `Attached: ${attachment.name}` : 'Attach file (optional)'}
                <input
                  type="file"
                  accept=".eml,.pdf,.txt,.csv,.html,text/*"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                  style={{ display: 'none' }}
                />
              </label>
              {attachment && (
                <button
                  onClick={() => setAttachment(null)}
                  style={{
                    marginLeft: 8, background: 'transparent', border: 'none',
                    color: 'var(--ink-4)', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  remove
                </button>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleProcess}
                style={{
                  background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                  cursor: 'pointer',
                }}
              >
                Process
              </button>
            </div>
          </>
        )}

        {/* "Reading"/"Saving" spinner state */}
        {step === 'saving' && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            <div className="font-serif" style={{ fontSize: 22, marginBottom: 8, fontStyle: 'italic' }}>
              {extraction ? 'Saving the note…' : 'Reading the note…'}
            </div>
            <div>
              {extraction ? 'Uploading any attachment and persisting the row.' : 'Asking Claude to extract structured fields and matching against existing reservations.'}
            </div>
          </div>
        )}

        {/* Step 2: confirm */}
        {step === 'confirm' && extraction && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>What we extracted</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 14px',
                fontSize: 12,
                padding: '10px 12px',
                border: '1px solid var(--rule)',
                background: 'var(--paper-2)',
              }}>
                <span style={{ color: 'var(--ink-4)' }}>Guest:</span>
                <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
                  {extraction.guest_name_match || <em style={{ color: 'var(--ink-4)' }}>(not detected)</em>}
                </span>
                <span style={{ color: 'var(--ink-4)' }}>Property:</span>
                <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
                  {extraction.property_match || <em style={{ color: 'var(--ink-4)' }}>(not detected)</em>}
                </span>
                {extraction.amounts_referenced.length > 0 && (
                  <>
                    <span style={{ color: 'var(--ink-4)' }}>Amounts:</span>
                    <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {extraction.amounts_referenced.map(n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)).join(', ')}
                    </span>
                  </>
                )}
                {extraction.dates_referenced.length > 0 && (
                  <>
                    <span style={{ color: 'var(--ink-4)' }}>Dates:</span>
                    <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {extraction.dates_referenced.join(', ')}
                    </span>
                  </>
                )}
                <span style={{ color: 'var(--ink-4)' }}>Confidence:</span>
                <span style={{
                  fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 600,
                  color: extraction.confidence === 'high' ? 'var(--positive)' : extraction.confidence === 'medium' ? 'var(--signal)' : 'var(--negative)',
                }}>
                  {extraction.confidence}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Pick the reservation</div>
              {candidates.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                  No matching reservations found by guest name. Type the confirmation code manually:
                </div>
              ) : (
                <div style={{ border: '1px solid var(--rule)', maxHeight: 240, overflow: 'auto' }}>
                  {candidates.map((c) => {
                    const checked = selectedCode === c.confirmation_code;
                    return (
                      <label
                        key={c.confirmation_code}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr auto',
                          gap: 12,
                          padding: '10px 12px',
                          borderBottom: '1px solid var(--rule-soft)',
                          background: checked ? 'var(--paper-2)' : 'transparent',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="radio"
                          name="candidate"
                          checked={checked}
                          onChange={() => { setSelectedCode(c.confirmation_code); setManualCode(''); }}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <div style={{ color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500, fontSize: 13 }}>
                            {c.guest_name || 'Unknown guest'}
                          </div>
                          <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>
                            {c.property_name}
                            {c.check_in && c.check_out && (
                              <> &middot; {c.check_in} → {c.check_out}</>
                            )}
                            {c.source === 'guesty_reservations' && (
                              <> &middot; <span style={{ fontStyle: 'italic' }}>upcoming</span></>
                            )}
                          </div>
                        </div>
                        <code style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)',
                          alignSelf: 'center',
                        }}>
                          {c.confirmation_code}
                        </code>
                      </label>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>or type manually:</span>
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => { setManualCode(e.target.value); if (e.target.value) setSelectedCode(''); }}
                  placeholder="HA-XlpeL8K"
                  style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                    padding: '6px 10px',
                    border: '1px solid var(--rule)',
                    background: 'var(--paper-2)',
                    color: 'var(--ink)',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Body (edit to taste)</div>
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-inter, ui-sans-serif)',
                  fontSize: 13, lineHeight: 1.5,
                  padding: 10,
                  border: '1px solid var(--rule)',
                  background: 'var(--paper-2)',
                  color: 'var(--ink)',
                  resize: 'vertical',
                }}
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => { setStep('paste'); setError(null); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-3)',
                  fontSize: 11, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase',
                  padding: '10px 0',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--rule)',
                    color: 'var(--ink-3)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    padding: '10px 18px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    background: 'var(--ink)', color: 'var(--paper)',
                    border: '1px solid var(--ink)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                    padding: '10px 18px',
                    cursor: 'pointer',
                  }}
                >
                  Save note
                </button>
              </div>
            </div>
          </>
        )}

        {/* Saved confirmation */}
        {step === 'saved' && (
          <>
            <div style={{
              padding: '14px 16px',
              borderLeft: '2px solid var(--positive)',
              background: 'var(--paper-2)',
              fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--positive)', marginBottom: 4 }}>Saved.</div>
              The note will appear on the affected statement and on the property card. You can keep
              adding more, or close this window.
              {savedNoteId && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                  id: {savedNoteId}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3" style={{ marginTop: 16 }}>
              <button
                onClick={() => {
                  // Reset for another note in the same session.
                  setText(''); setAttachment(null);
                  setExtraction(null); setCandidates([]); setPropertyIdMatch(null);
                  setSelectedCode(''); setManualCode(''); setEditedBody('');
                  setSavedNoteId(null); setError(null);
                  setStep('paste');
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                  cursor: 'pointer',
                }}
              >
                Add another
              </button>
              <button
                onClick={onClose}
                style={{
                  background: 'var(--ink)', color: 'var(--paper)',
                  border: '1px solid var(--ink)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
