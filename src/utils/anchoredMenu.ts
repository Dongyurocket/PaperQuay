export interface MenuAnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface AnchoredMenuPlacement {
  left: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
  top?: number;
  bottom?: number;
}

export function placeAnchoredMenu(input: {
  anchor: MenuAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth: number;
  preferredMaxHeight?: number;
  minUsefulHeight?: number;
  gap?: number;
  padding?: number;
}): AnchoredMenuPlacement {
  const padding = input.padding ?? 12;
  const gap = input.gap ?? 8;
  const preferredMaxHeight = input.preferredMaxHeight ?? 420;
  const minUsefulHeight = input.minUsefulHeight ?? 220;
  const availableWidth = Math.max(160, input.viewportWidth - padding * 2);
  const width = Math.min(availableWidth, Math.max(input.preferredWidth, Math.round(input.anchor.width)));
  const left = Math.max(padding, Math.min(input.anchor.left, input.viewportWidth - width - padding));
  const spaceBelow = input.viewportHeight - input.anchor.bottom - gap - padding;
  const spaceAbove = input.anchor.top - gap - padding;
  const placement = spaceBelow < minUsefulHeight && spaceAbove > spaceBelow ? 'above' : 'below';
  const available = Math.max(96, placement === 'above' ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(preferredMaxHeight, available);

  if (placement === 'above') {
    return {
      placement,
      left,
      width,
      maxHeight,
      bottom: Math.max(padding, input.viewportHeight - input.anchor.top + gap),
    };
  }

  return {
    placement,
    left,
    width,
    maxHeight,
    top: input.anchor.bottom + gap,
  };
}
