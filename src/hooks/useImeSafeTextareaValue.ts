import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

export function isImeComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return Boolean(
    event.nativeEvent.isComposing ||
      event.key === 'Process' ||
      event.keyCode === 229,
  );
}

export function useImeSafeTextareaValue(
  value: string,
  onValueChange: (value: string) => void,
) {
  const [draftValue, setDraftValue] = useState(value);
  const isComposingRef = useRef(false);
  const draftValueRef = useRef(value);

  useEffect(() => {
    if (!isComposingRef.current) {
      draftValueRef.current = value;
      setDraftValue(value);
    }
  }, [value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      const previousValue = draftValueRef.current;
      const isDeleting = nextValue.length < previousValue.length;

      draftValueRef.current = nextValue;
      setDraftValue(nextValue);

      if (!isComposingRef.current || isDeleting) {
        onValueChange(nextValue);
      }
    },
    [onValueChange],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      const nextValue = event.currentTarget.value;
      isComposingRef.current = false;
      draftValueRef.current = nextValue;
      setDraftValue(nextValue);
      onValueChange(nextValue);
    },
    [onValueChange],
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLTextAreaElement>) => {
      const nextValue = event.currentTarget.value;
      isComposingRef.current = false;
      draftValueRef.current = nextValue;
      setDraftValue(nextValue);
      onValueChange(nextValue);
    },
    [onValueChange],
  );

  return {
    value: draftValue,
    isComposingRef,
    onChange: handleChange,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onBlur: handleBlur,
  };
}
