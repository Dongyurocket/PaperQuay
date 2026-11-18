import assert from 'node:assert/strict';
import test from 'node:test';
import { scrollInstantly } from '../src/features/pdf/instantScroll.ts';

test('history and citation scrolls bypass CSS smooth behavior while retaining it afterward', () => {
  const style = { scrollBehavior: 'smooth' } as CSSStyleDeclaration;
  let position = 0;
  const container = {
    style,
    scrollTo(options: ScrollToOptions) {
      assert.equal(style.scrollBehavior, 'auto');
      assert.equal(options.behavior, 'auto');
      position = options.top ?? 0;
    },
  } as Pick<HTMLElement, 'style' | 'scrollTo'>;
  scrollInstantly(container, { top: 202, left: 0 });
  assert.equal(position, 202);
  assert.equal(style.scrollBehavior, 'smooth');
});

test('scroll style is restored even when scrolling fails', () => {
  const style = { scrollBehavior: 'smooth' } as CSSStyleDeclaration;
  const container = {
    style,
    scrollTo() { throw new Error('scroll failed'); },
  } as Pick<HTMLElement, 'style' | 'scrollTo'>;
  assert.throws(() => scrollInstantly(container, { top: 202 }), /scroll failed/);
  assert.equal(style.scrollBehavior, 'smooth');
});
