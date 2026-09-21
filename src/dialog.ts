/** Native modal inertness plus focus cycling and a reversible, position-preserving scroll lock. */
export class DialogController {
  private active: HTMLDialogElement | null = null;
  private opener: HTMLElement | null = null;
  private scroll = { x: 0, y: 0 };
  private bodyStyle = '';

  register(dialog: HTMLDialogElement, options: { backdrop?: boolean; onClose?: () => void } = {}): void {
    dialog.addEventListener('close', () => {
      if (this.active !== dialog) return;
      this.active = null;
      document.body.style.cssText = this.bodyStyle;
      window.scrollTo(this.scroll.x, this.scroll.y);
      options.onClose?.();
      if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
      this.opener = null;
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]')]
        .filter((item) => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    let beganOnBackdrop = false;
    dialog.addEventListener('pointerdown', (event) => { beganOnBackdrop = event.target === dialog; });
    dialog.addEventListener('click', (event) => {
      if (!options.backdrop || !beganOnBackdrop || event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }

  open(dialog: HTMLDialogElement, opener: HTMLElement, focus?: HTMLElement): boolean {
    if (this.active) return false;
    this.opener = opener;
    this.scroll = { x: window.scrollX, y: window.scrollY };
    this.bodyStyle = document.body.style.cssText;
    // Stable root gutter keeps the dashboard's width identical with and without the scrollbar.
    Object.assign(document.body.style, {
      position: 'fixed', top: `-${this.scroll.y}px`, left: `-${this.scroll.x}px`,
      width: '100%', overflow: 'hidden',
    });
    this.active = dialog;
    dialog.returnValue = '';
    dialog.showModal();
    (focus ?? dialog.querySelector<HTMLElement>('button, [tabindex]'))?.focus({ preventScroll: true });
    return true;
  }
}
