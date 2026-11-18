export function scrollInstantly(
  container: Pick<HTMLElement, 'style' | 'scrollTo'>,
  position: Pick<ScrollToOptions, 'top' | 'left'>,
) {
  const previousScrollBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = 'auto';
  try {
    container.scrollTo({ ...position, behavior: 'auto' });
  } finally {
    container.style.scrollBehavior = previousScrollBehavior;
  }
}
