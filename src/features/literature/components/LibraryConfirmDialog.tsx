import { ConfirmDialog } from '../../../ui/dialog';

/**
 * 文库侧确认框。保留原有 props 以不触碰调用点；
 * 实现已收敛到共享的 ConfirmDialog（Portal、焦点陷阱、Esc、滚动锁统一由 src/ui/dialog.tsx 负责）。
 */
interface LibraryConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function LibraryConfirmDialog(props: LibraryConfirmDialogProps) {
  return <ConfirmDialog {...props} />;
}
