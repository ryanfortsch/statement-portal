import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getPropertyContracts, type PropertyContractRow } from '@/lib/property-contracts';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  registerTermsFromProjection,
  registerTermsFromRow,
  TEMPLATE_RENEWAL,
  type LockedTerms,
} from '@/lib/contract-register';
import { RegisterAgreementForm, type RegisterFormInitial } from './RegisterAgreementForm';

export const dynamic = 'force-dynamic';

/**
 * "Register this agreement": the contracts register's write form. Opened
 * from the register's Not registered chips (a contract countersigned in
 * Helm, `projection`), its In Drive chips (a signed PDF the sweep found,
 * `drive`), and each home's row (`property`, plus `edit` to correct the
 * live entry). The rules live in src/lib/contract-register.ts and the
 * writer in ../actions.ts.
 */

type Search = { property?: string; projection?: string; drive?: string; edit?: string };

type Home = { id: string; name: string; owner_full: string | null; owner_last: string | null; management_fee_pct: number | null; projection_id: string | null };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return 'not recorded';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
function easternDay(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function loadHomes(): Promise<Home[]> {
  const { data } = await supabase
    .from('properties')
    .select('id, name, owner_full, owner_last, management_fee_pct, projection_id, is_rising_tide_owned')
    .eq('is_active', true)
    .eq('kind', 'managed')
    .order('name');
  return ((data ?? []) as (Home & { is_rising_tide_owned: boolean | null })[]).filter((p) => !p.is_rising_tide_owned);
}

async function loadHome(id: string): Promise<Home | null> {
  const { data } = await supabase
    .from('properties')
    .select('id, name, owner_full, owner_last, management_fee_pct, projection_id')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as Home | null;
}

export default async function RegisterAgreementPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  if (!isServiceConfigured) {
    return (
      <Shell title="Register this" emphasis="agreement.">
        <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Ask Ryan: this page is not set up.</p>
      </Shell>
    );
  }

  const [home, homes, orphan] = await Promise.all([
    params.property ? loadHome(params.property) : Promise.resolve(null),
    params.property ? Promise.resolve([] as Home[]) : loadHomes(),
    params.drive
      ? supabase
          .from('contract_drive_orphans')
          .select('drive_file_id, title, folder_year, drive_url')
          .eq('drive_file_id', params.drive)
          .maybeSingle()
          .then((r) => (r.data ?? null) as { drive_file_id: string; title: string; folder_year: string; drive_url: string } | null)
      : Promise.resolve(null),
  ]);
  const contracts: PropertyContractRow[] = home ? await getPropertyContracts(home.id) : [];
  const active = contracts.find((c) => c.status === 'active') ?? null;
  const last = contracts[0] ?? null;
  const editing = params.edit && active && active.id === params.edit ? active : null;

  let projection: ProjectionRow | null = null;
  if (params.projection) {
    const { data } = await supabase.from('projections').select('*').eq('id', params.projection).maybeSingle();
    projection = (data ?? null) as ProjectionRow | null;
  }
  const signedInHelm = !!projection?.contract_signed_at && !!projection?.contract_countersigned_at;

  const locked: LockedTerms | null = signedInHelm && projection
    ? registerTermsFromProjection(projection)
    : editing?.signed_via === 'helm'
      ? registerTermsFromRow(editing)
      : null;

  const source = editing ?? null;
  const initial: RegisterFormInitial = {
    property_id: home?.id ?? '',
    projection_id: signedInHelm && projection ? projection.id : '',
    drive_file_id: orphan?.drive_file_id ?? '',
    replaces: !editing && active ? active.id : '',
    edit: editing?.id ?? '',
    owner_party: source?.owner_party ?? last?.owner_party ?? home?.owner_full ?? home?.owner_last ?? '',
    executed_on:
      source?.executed_on ??
      (signedInHelm && projection?.contract_countersigned_at ? easternDay(projection.contract_countersigned_at) : ''),
    term_start: source?.term_start ?? '',
    term_end: source?.term_end ?? '',
    renewal_type: source?.renewal_type ?? (signedInHelm ? TEMPLATE_RENEWAL.renewal_type : 'auto_renew'),
    notice_days_initial: String(source?.notice_days_initial ?? (signedInHelm ? TEMPLATE_RENEWAL.notice_days_initial : '')),
    notice_days_renewal: String(source?.notice_days_renewal ?? (signedInHelm ? TEMPLATE_RENEWAL.notice_days_renewal : '')),
    fee_pct: String(source?.fee_pct ?? home?.management_fee_pct ?? ''),
    signed_via: source && source.signed_via !== 'helm' ? source.signed_via : 'external',
    drive_url: source?.drive_url ?? (signedInHelm ? projection?.contract_drive_url ?? '' : '') ?? '',
    notes: source?.notes ?? '',
  };
  if (orphan && !initial.drive_url) initial.drive_url = orphan.drive_url;

  const title = editing ? 'Correct this' : 'Register this';
  const emphasis = editing ? 'entry.' : 'agreement.';

  return (
    <Shell title={title} emphasis={emphasis} homeName={home?.name}>
      <div style={{ display: 'grid', gap: 8, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)', maxWidth: 640, marginBottom: 26 }}>
        {projection && !signedInHelm && (
          <p style={{ margin: 0, color: 'var(--signal)' }}>
            {projection.contract_signed_at
              ? 'The owner signed, but the agreement is not in force until Rising Tide countersigns. Countersign on the prospect page; there is nothing to register before then.'
              : 'The owner has not signed this contract yet, so there is nothing to register.'}{' '}
            <Link href={`/prospects/${projection.id}`} style={{ color: 'var(--tide-deep)' }}>
              Open the prospect page
            </Link>
          </p>
        )}
        {signedInHelm && projection && (
          <p style={{ margin: 0 }}>
            Signed in Helm and countersigned {fmtDate(projection.contract_countersigned_at ? easternDay(projection.contract_countersigned_at) : null)}.
            The terms below come from the signed contract.{' '}
            <a href={`/projections/${projection.id}/contract`} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)' }}>
              Open the signed contract ↗
            </a>
          </p>
        )}
        {orphan && (
          <p style={{ margin: 0 }}>
            From Drive: {orphan.title} ({orphan.folder_year}).{' '}
            <a href={orphan.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)' }}>
              Open the PDF ↗
            </a>
          </p>
        )}
        {params.drive && !orphan && (
          <p style={{ margin: 0, color: 'var(--ink-3)' }}>That Drive file is already registered or has left the Contracts folder.</p>
        )}
        {!editing && active && (
          <p style={{ margin: 0 }}>
            {home?.name} has a live agreement ({active.owner_party}, {fmtDate(active.term_start)} to {fmtDate(active.term_end)}
            {active.fee_pct != null ? `, ${Number(active.fee_pct)}%` : ''}). Registering this one replaces it; the current one moves to Earlier.
            To fix a mistake in it instead,{' '}
            <Link href={`/properties/contracts/register?property=${encodeURIComponent(active.property_id)}&edit=${active.id}`} style={{ color: 'var(--tide-deep)' }}>
              correct the entry
            </Link>
            .
          </p>
        )}
        {editing?.signed_via === 'helm' && (
          <p style={{ margin: 0 }}>Signed in Helm, so the terms it was registered with stay as they are.</p>
        )}
      </div>

      {projection && !signedInHelm ? null : (
        <RegisterAgreementForm
          initial={initial}
          locked={locked}
          homes={home ? null : homes.map((h) => ({ id: h.id, name: h.name }))}
          submitLabel={editing ? 'Save correction' : 'Register agreement'}
        />
      )}
    </Shell>
  );
}

function Shell({ title, emphasis, homeName, children }: { title: string; emphasis: string; homeName?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmBreadcrumb
        trail={[
          { label: 'Contracts', href: '/properties/contracts' },
          { label: homeName ?? 'Register' },
        ]}
      />
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingTop: 36, paddingBottom: 80, width: '100%', flex: 1 }}>
        <h1
          className="font-serif"
          style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '0 0 18px' }}
        >
          {title} <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>{emphasis}</em>
        </h1>
        {children}
      </section>
      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}
