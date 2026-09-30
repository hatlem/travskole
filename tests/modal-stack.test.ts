import { describe, it, expect } from 'vitest';
import { ModalStack } from '@/lib/modal-stack';

describe('ModalStack', () => {
  it('only the most recently opened modal is on top', () => {
    const stack = new ModalStack();
    const dialog = stack.open();
    const confirm = stack.open();
    expect(stack.isTop(confirm)).toBe(true);
    expect(stack.isTop(dialog)).toBe(false);

    stack.close(confirm);
    expect(stack.isTop(dialog)).toBe(true);
    expect(stack.size).toBe(1);
  });

  it('closing out of order keeps the remaining order intact', () => {
    const stack = new ModalStack();
    const a = stack.open();
    const b = stack.open();
    stack.close(a);
    expect(stack.isTop(b)).toBe(true);
    stack.close(b);
    stack.close(b);
    expect(stack.size).toBe(0);
  });
});
