import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import { useSpecimenStore } from '../../stores/specimenStore';
import { usePrepProgress } from '../../hooks/usePrepProgress';
import { toLocalInputValue } from '../../utils/format';
import type { Specimen } from '../../types/specimen';

export interface DeliveryDialogProps {
  open: boolean;
  specimen: Specimen | null;
  onClose: () => void;
  /** 交付成功后的回调（一般用于弹提示） */
  onDelivered: (message: string) => void;
}

/**
 * 交付统一办理入口：
 * - 存在待办 / 已回退节点时列出卡点，禁止交付；
 * - 全部完成后登记交付人、接收单位与交接时间，归档为「已交付」。
 */
export function DeliveryDialog({ open, specimen, onClose, onDelivered }: DeliveryDialogProps) {
  const deliver = useSpecimenStore((s) => s.deliver);
  const progress = usePrepProgress(specimen?.id);

  const [deliverer, setDeliverer] = useState('');
  const [receiver, setReceiver] = useState('');
  const [handoverAt, setHandoverAt] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开时重置表单，交接时间默认当前时刻
  useEffect(() => {
    if (open) {
      setDeliverer('');
      setReceiver('');
      setHandoverAt(toLocalInputValue(Date.now()));
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  if (!specimen) return null;

  const blockers = progress.list.filter((n) => n.state !== 'done');
  const canDeliver = blockers.length === 0;

  const submit = async () => {
    if (!deliverer.trim()) {
      setError('交付人必填');
      return;
    }
    if (!receiver.trim()) {
      setError('接收单位必填');
      return;
    }
    const ts = new Date(handoverAt).getTime();
    if (!handoverAt || !Number.isFinite(ts)) {
      setError('请填写有效的交接时间');
      return;
    }
    setSubmitting(true);
    try {
      await deliver(specimen.id, {
        deliverer: deliverer.trim(),
        receiver: receiver.trim(),
        handoverAt: ts,
      });
      onDelivered(`标本「${specimen.specimenNo}」已交付 ${receiver.trim()}，档案归档为只读`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '交付失败，请重试');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>办理交付 · {specimen.specimenNo}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            工序完成度 {progress.done}/{progress.total}
            {progress.rolledback > 0 ? ` · 已回退 ${progress.rolledback} 个` : ''}
          </Typography>

          {!canDeliver ? (
            <>
              <Alert severity="warning" data-testid="delivery-blockers">
                还有 {blockers.length} 个工序节点未完成，暂不能交付。请先回到时间线处理以下卡点：
              </Alert>
              <Stack spacing={0.75}>
                {blockers.map((n) => (
                  <Paper key={n.id} variant="outlined" sx={{ p: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={`#${n.seq}`} color="primary" variant="outlined" />
                      <Typography variant="body2" fontWeight={700}>
                        {n.stepType} · {n.nodeName}
                      </Typography>
                      <Chip
                        size="small"
                        label={n.state === 'rolledback' ? '已回退' : '待办'}
                        color={n.state === 'rolledback' ? 'error' : 'default'}
                      />
                      <Typography variant="caption" color="text.secondary">
                        责任人 {n.operator}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </>
          ) : (
            <>
              <Alert severity="success">
                {progress.total > 0
                  ? `全部 ${progress.total} 个工序节点已完成，可办理交付。交付后档案归档，标本、工序与时间线仅可查看。`
                  : '该标本尚无工序节点。交付后档案归档，标本、工序与时间线仅可查看。'}
              </Alert>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                size="small"
                label="交付人"
                required
                value={deliverer}
                onChange={(e) => setDeliverer(e.target.value)}
              />
              <TextField
                size="small"
                label="接收单位"
                required
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
              />
              <TextField
                size="small"
                label="交接时间"
                required
                type="datetime-local"
                value={handoverAt}
                onChange={(e) => setHandoverAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{canDeliver ? '取消' : '关闭'}</Button>
        {canDeliver ? (
          <Button variant="contained" color="success" disabled={submitting} onClick={submit}>
            确认交付并归档
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

export default DeliveryDialog;
