export function createScrollRestoreScheduler(requestFrame: (callback: () => void) => void) {
  let revision = 0;

  return {
    cancel() {
      revision += 1;
    },
    schedule(restore: () => void) {
      const scheduledRevision = revision;
      requestFrame(() => {
        requestFrame(() => {
          if (scheduledRevision === revision) restore();
        });
      });
    },
  };
}
