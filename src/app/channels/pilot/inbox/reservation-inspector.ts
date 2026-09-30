type Inspector = Pick<HTMLDialogElement, 'open' | 'contains' | 'close' | 'show' | 'showModal'>;
type FocusTarget = Pick<HTMLElement, 'focus'>;

/** Switch native dialog modes without leaving modal inertness or losing inspector focus. */
export function syncReservationInspector(
  panel: Inspector,
  mode: 'closed' | 'docked' | 'modal',
  activeElement: HTMLElement | null,
  returnFocus: FocusTarget | null,
) {
  const wasOpen = panel.open;
  const focused = activeElement && panel.contains(activeElement) ? activeElement : null;
  if (wasOpen) panel.close();
  if (mode === 'closed') {
    if (wasOpen) returnFocus?.focus();
    return;
  }
  if (mode === 'docked') panel.show();
  else panel.showModal();
  focused?.focus();
}
