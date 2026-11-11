import type { CleanerStayReport } from '@/lib/cleaner-stay-report';
import styles from './CleanerStayPortal.module.css';

const labels = {
  en: { title: 'Arrivals & departures', subtitle: 'Your planning calendar', through: 'Arrivals through',
    arrival: 'Arrival', departure: 'Departure', ready: 'Ready by', guests: 'Guests', unknown: 'Not confirmed',
    current: 'Staying now', adjusted: 'Checkout adjusted', skip: 'No checkout cleaning', review: 'Confirm dates with the team',
    empty: 'No confirmed guest stays in this window.', stays: 'stays', stay: 'stay',
    note: 'Ready by is the cleaning deadline, not the guest’s check-in time. Dates include confirmed checkout changes.',
    footer: 'Planning information only. For cleaning assignments and owner stays, use the cleaning schedule.',
    schedule: 'Open cleaning schedule', help: 'Questions? Contact the team using your usual number.' },
  pt: { title: 'Entradas e saídas', subtitle: 'Seu calendário de planejamento', through: 'Entradas até',
    arrival: 'Entrada', departure: 'Saída', ready: 'Pronto até', guests: 'Hóspedes', unknown: 'Não confirmado',
    current: 'Em hospedagem', adjusted: 'Saída ajustada', skip: 'Sem limpeza na saída', review: 'Confirme as datas com a equipe',
    empty: 'Nenhuma estadia confirmada neste período.', stays: 'estadias', stay: 'estadia',
    note: 'Pronto até é o prazo da limpeza, não o horário de entrada do hóspede. As datas incluem alterações de saída confirmadas.',
    footer: 'Informações para planejamento. Para limpezas agendadas e estadias dos proprietários, consulte a agenda de limpezas.',
    schedule: 'Abrir agenda de limpezas', help: 'Dúvidas? Fale com a equipe pelo número de sempre.' },
};

export function CleanerStayPortal({ report, language, checkoutHref, embedded = false }: {
  report: CleanerStayReport; language: 'en' | 'pt'; checkoutHref?: string; embedded?: boolean;
}) {
  const Container = embedded ? 'section' : 'main', Heading = embedded ? 'h2' : 'h1';
  const text = labels[language], locale = language === 'pt' ? 'pt-BR' : 'en-US';
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
  const time = (value: string | null) => value ? new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(`2000-01-01T${value}:00Z`)) : text.unknown;
  return <Container className={styles.portal} lang={locale}>
    <header className={styles.mast}><span className={styles.mark} aria-hidden="true">R</span><div><strong>Rising Tide</strong><p>{text.subtitle}</p></div></header>
    <section className={styles.heading}>
      <p className={styles.eyebrow}>{report.propertyName}</p><Heading>{text.title}</Heading>
      <p>{text.through} {date(report.through)} <span aria-hidden="true">·</span> {report.stays.length} {report.stays.length === 1 ? text.stay : text.stays}</p>
    </section>
    <p className={styles.note}>{text.note}</p>
    {report.stays.length === 0 ? <p className={styles.empty}>{text.empty}</p> : <ol className={styles.stays}>
      {report.stays.map(stay => <li key={stay.checkIn} className={styles.card}>
        <div className={styles.dates}>
          <div><span className={styles.label}>{text.arrival}</span><time dateTime={stay.checkIn}>{date(stay.checkIn)}</time><p>{stay.arrivalTime ? `${text.ready} ${time(stay.arrivalTime)}` : text.unknown}</p></div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div><span className={styles.label}>{text.departure}</span><time dateTime={stay.checkOut}>{date(stay.checkOut)}</time><p>{time(stay.checkoutTime)}</p></div>
        </div>
        <div className={styles.cardFoot}><p><span>{text.guests}</span><strong>{stay.guests ?? '—'}</strong>{stay.guests === null && <small>{text.unknown}</small>}</p>
          <div className={styles.badges}>
            {stay.staying && <span>{text.current}</span>}{stay.adjusted && <span>{text.adjusted}</span>}
            {stay.noCleaning && <span>{text.skip}</span>}{stay.needsReview && <span className={styles.attention}>{text.review}</span>}
          </div>
        </div>
      </li>)}
    </ol>}
    <footer className={styles.footer}><p>{text.footer}</p>{checkoutHref && <a href={checkoutHref} rel="noreferrer">{text.schedule}<span aria-hidden="true"> →</span></a>}<p>{text.help}</p></footer>
  </Container>;
}
