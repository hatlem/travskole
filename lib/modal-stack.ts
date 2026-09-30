// Holder styr på åpne modaler så Escape bare lukker den øverste (f.eks. en
// bekreftelse oppå en dialog), og så body-scroll låses til siste modal lukkes.

export class ModalStack {
  private ids: symbol[] = [];

  open(): symbol {
    const id = Symbol('modal');
    this.ids.push(id);
    return id;
  }

  close(id: symbol): void {
    const i = this.ids.indexOf(id);
    if (i !== -1) this.ids.splice(i, 1);
  }

  isTop(id: symbol): boolean {
    return this.ids[this.ids.length - 1] === id;
  }

  get size(): number {
    return this.ids.length;
  }
}

export const modalStack = new ModalStack();
