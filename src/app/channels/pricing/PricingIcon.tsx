export default function PricingIcon({name}: {name: 'previous' | 'next' | 'refresh' | 'close' | 'calendar' | 'table' | 'lock' | 'sliders' | 'columns' | 'more'}) {
  const paths = {
    previous: 'm14 6-6 6 6 6', next: 'm10 6 6 6-6 6', close: 'm6 6 12 12M6 18 18 6',
    refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.2 3.2M4.7 14.7a8 8 0 0 0 13.2 3.2',
    calendar: 'M7 3v4M17 3v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2',
    table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z',
    sliders: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    columns: 'M4 5h16v14H4zM10 5v14M16 5v14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name==='more'?3:1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
