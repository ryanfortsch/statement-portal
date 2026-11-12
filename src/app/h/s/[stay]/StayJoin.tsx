import type { StayJoinNotice } from '@/lib/guest-app-stays';

/**
 * The stay link's one optional line on a direct booking: anyone in the party
 * can leave an email for the Stay Cape Ann list. The page renders this only
 * when the loader says the stay may ask (`view.join`, stayMayAskEmail); the
 * printed home link and every OTA stay never get it.
 *
 * A plain form, no script: it posts to ./join and comes back with ?join=,
 * so it works with JavaScript off. After a signup the form stays, so the
 * next person in the group can add theirs. Nothing is required to use the
 * page, and nothing else on it asks for anything.
 */
const NOTICE: Record<StayJoinNotice, string> = {
  joined: "You're on the list. Anyone else here can add theirs below.",
  invalid: "That email doesn't look right. Try once more.",
  failed: "That didn't save. Try again in a minute.",
  full: "That's every email one stay can add. Text us if someone was missed.",
};

export function StayJoin({ token, notice, tone = 'dark' }: { token: string; notice: StayJoinNotice | null; tone?: 'dark' | 'light' }) {
  return (
    <div id="join" className={`ga-join${tone === 'light' ? ' ga-join-light' : ''}`}>
      {notice ? (
        <p className={`ga-join-notice${notice === 'joined' ? ' is-done' : ''}`} role="status">
          {NOTICE[notice]}
        </p>
      ) : (
        <p className="ga-join-lead">Hear first when a home opens or a week frees up.</p>
      )}
      {notice === 'full' ? null : (
        <>
          <form className="ga-join-form" method="post" action={`/h/s/${token}/join`}>
            <label className="ga-sr" htmlFor="ga-join-email">
              Email
            </label>
            <input
              id="ga-join-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="Your email"
              required
            />
            <div className="ga-hp" aria-hidden="true">
              <label htmlFor="ga-join-website">Leave this empty</label>
              <input id="ga-join-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <button className={`ga-btn${tone === 'light' ? '' : ' ga-btn-light'}`} type="submit">
              Join
            </button>
          </form>
          <p className="ga-join-fine">Stay Cape Ann email only. Leave any time.</p>
        </>
      )}
    </div>
  );
}
