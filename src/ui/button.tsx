import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

/**
 * 统一按钮原语（D7-14）。
 *
 * 背景：仓库里 28/32px 的图标按钮此前各写固定像素高度，实心、描边、
 * 危险样式也各抄一份，尺寸与主题令牌容易漂移。这里收敛为两层：
 *   - Button：文字按钮，variant 复用 .pq-button / .pq-button-primary 与按钮级语义令牌；
 *   - IconButton：只有图标的方形按钮，复用 .pq-icon-button。
 *
 * 尺寸只来自 --pq-control-sm（28px）/ --pq-control-md（32px），由 index.css 的
 * :root 定义；不要在调用方再手写固定高度。颜色一律走 --pq-* 语义令牌，浅色与
 * 深色主题的对比度由 index.css 统一保证。
 */

export type ButtonSize = 'sm' | 'md';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** 文字按钮只固定高度，宽度交给内容与调用方。 */
const BUTTON_HEIGHT_CLASS: Record<ButtonSize, string> = {
  sm: 'h-[var(--pq-control-sm)]',
  md: 'h-[var(--pq-control-md)]',
};

/** 图标按钮默认等宽高，保证 28/32px 的方形点击目标。 */
const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-[var(--pq-control-sm)] w-[var(--pq-control-sm)]',
  md: 'h-[var(--pq-control-md)] w-[var(--pq-control-md)]',
};

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'pq-button-primary',
  secondary: 'pq-button',
  ghost:
    'rounded-[var(--pq-radius-sm)] font-semibold text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
  danger:
    'rounded-[var(--pq-radius-sm)] border border-transparent bg-[var(--pq-danger-button-bg)] font-semibold text-[var(--pq-danger-button-text)] transition hover:bg-[var(--pq-danger-button-bg-hover)]',
};

const ICON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--pq-accent-button-bg)] text-[var(--pq-accent-button-text)] hover:bg-[var(--pq-accent-button-bg-hover)] hover:text-[var(--pq-accent-button-text)]',
  secondary: 'border border-[var(--pq-border)]',
  ghost: '',
  danger:
    'bg-[var(--pq-danger-button-bg)] text-[var(--pq-danger-button-text)] hover:bg-[var(--pq-danger-button-bg-hover)] hover:text-[var(--pq-danger-button-text)]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 高度令牌：sm = 28px，md = 32px（默认）。 */
  size?: ButtonSize;
  /** 视觉层级：实心强调、描边、无底、危险。 */
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size = 'md', variant = 'secondary', type = 'button', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BUTTON_VARIANT_CLASS[variant], BUTTON_HEIGHT_CLASS[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** 等宽高令牌：sm = 28px，md = 32px（默认）。 */
  size?: ButtonSize;
  /** 视觉层级；默认 ghost（.pq-icon-button 原样）。 */
  variant?: ButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn('pq-icon-button', ICON_VARIANT_CLASS[variant], ICON_SIZE_CLASS[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
});
