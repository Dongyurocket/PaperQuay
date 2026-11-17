/** Serialize cache migration and generation writes, checking eligibility when a write starts. */
export function createOverviewCacheWriter() {
  let pending: Promise<void> = Promise.resolve();

  return (write: () => Promise<void>, isCurrent: () => boolean = () => true): Promise<void> => {
    const next = pending.then(async () => {
      if (isCurrent()) await write();
    });
    // A failed migration must not prevent a newer generated summary from being saved.
    pending = next.catch(() => undefined);
    return next;
  };
}
