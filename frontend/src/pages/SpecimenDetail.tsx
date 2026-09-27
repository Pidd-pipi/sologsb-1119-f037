import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import CompareIcon from '@mui/icons-material/Compare';
import SendIcon from '@mui/icons-material/Send';
import LockIcon from '@mui/icons-material/Lock';
import { useSpecimenStore } from '../stores/specimenStore';
import { useProcedureStore } from '../stores/procedureStore';
import { usePrepProgress } from '../hooks/usePrepProgress';
import { SpecimenCard } from '../components/common/SpecimenCard';
import { ProcedureTimeline } from '../components/common/ProcedureTimeline';
import { db } from '../utils/db';
import { PHOTO_STAGE_LABEL, type PrepPhoto } from '../types/photo';
import { OPEN_SPECIMEN_STATUSES, isSpecimenArchived, type SpecimenStatus } from '../types/specimen';
import { checkDeliveryBlockers, formatDateTime, fromDateTimeLocal, toDateTimeLocal } from '../utils/delivery';

/** /specimens/:id 详情 + 工序时间线 + 影像 */
export default function SpecimenDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const specimen = useSpecimenStore((s) => s.items.find((it) => it.id === id));
  const setStatus = useSpecimenStore((s) => s.setStatus);
  const deliver = useSpecimenStore((s) => s.deliver);
  const finish = useProcedureStore((s) => s.finish);
  const rollback = useProcedureStore((s) => s.rollback);
  const progress = usePrepProgress(id);
  const [photos, setPhotos] = useState<PrepPhoto[]>([]);
  const [toast, setToast] = useState('');

  // 交付对话框
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveredBy, setDeliveredBy] = useState('');
  const [receivingUnit, setReceivingUnit] = useState('');
  const [deliveredAtLocal, setDeliveredAtLocal] = useState(() => toDateTimeLocal(Date.now()));
  const [deliveryError, setDeliveryError] = useState('');

  const archived = specimen ? isSpecimenArchived(specimen) : false;

  /** 交付卡点：待办 / 回退 / 空节点 / 跳号，打开对话框时实时核算 */
  const blockers = useMemo(
    () => (id ? checkDeliveryBlockers(progress.list) : []),
    [id, progress.list],
  );

  const loadPhotos = useCallback(async () => {
    if (!id) return;
    const rows = await db.photos.where('specimenId').equals(id).toArray();
    rows.sort((a, b) => b.capturedAt - a.capturedAt);
    setPhotos(rows);
  }, [id]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  if (!specimen) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">未找到该标本（可能已被删除）。</Alert>
        <Button component={RouterLink} to="/specimens" variant="outlined">
          返回标本台账
        </Button>
      </Stack>
    );
  }

  const beforePhotos = photos.filter((p) => p.stage === 'before');
  const afterPhotos = photos.filter((p) => p.stage === 'after');
  const hasHandoverInfo = Boolean(specimen.deliveredBy || specimen.receivingUnit || specimen.deliveredAt);

  const openDelivery = () => {
    setDeliveredBy('');
    setReceivingUnit('');
    setDeliveredAtLocal(toDateTimeLocal(Date.now()));
    setDeliveryError('');
    setDeliveryOpen(true);
  };

  const submitDelivery = async () => {
    if (blockers.length > 0) {
      setDeliveryError(blockers[0].message);
      return;
    }
    const by = deliveredBy.trim();
    const unit = receivingUnit.trim();
    const at = fromDateTimeLocal(deliveredAtLocal);
    if (!by) {
      setDeliveryError('请填写交付人');
      return;
    }
    if (!unit) {
      setDeliveryError('请填写接收单位');
      return;
    }
    if (!at) {
      setDeliveryError('请选择交接时间');
      return;
    }
    try {
      await deliver(specimen.id, { deliveredBy: by, receivingUnit: unit, deliveredAt: at });
      setDeliveryOpen(false);
      setToast('已办理交付，标本归档，档案转为只读');
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : '交付失败');
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="h5" fontWeight={700}>
          标本详情 · {specimen.specimenNo}
        </Typography>
        {archived ? (
          <Chip size="small" color="success" icon={<LockIcon />} label="已归档 · 只读" />
        ) : null}
        <Box sx={{ flex: 1 }} />
        <TooltipForArchived archived={archived} hint="已归档标本不能再追加工序">
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={archived}
            onClick={() => navigate(`/procedures/new?specimenId=${specimen.id}`)}
          >
            追加工序节点
          </Button>
        </TooltipForArchived>
        <Button
          variant="outlined"
          startIcon={<CompareIcon />}
          onClick={() => navigate(`/compare/${specimen.id}`)}
        >
          前后对照
        </Button>
      </Stack>

      {archived ? (
        <Alert severity="info" icon={<LockIcon fontSize="inherit" />}>
          该标本已于 {formatDateTime(specimen.deliveredAt)} 交付归档，标本资料、工序与时间线仅可查看；如需改动请先联系档案管理员退回未交付状态。
        </Alert>
      ) : null}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '380px 1fr' }, gap: 2 }}>
        <Stack spacing={1.5}>
          <SpecimenCard item={specimen} />

          {archived ? (
            <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="handover-card">
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle2">交接信息</Typography>
                <Chip size="small" color="success" label="已交付" />
              </Stack>
              {hasHandoverInfo ? (
                <Stack spacing={0.5}>
                  <Typography variant="body2">交付人：{specimen.deliveredBy || '—'}</Typography>
                  <Typography variant="body2">接收单位：{specimen.receivingUnit || '—'}</Typography>
                  <Typography variant="body2">交接时间：{formatDateTime(specimen.deliveredAt)}</Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  历史档案（结构升级前交付），当时未登记交接信息。
                </Typography>
              )}
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                修复状态
              </Typography>
              <TextField
                select
                size="small"
                fullWidth
                value={specimen.status}
                onChange={async (e) => {
                  try {
                    await setStatus(specimen.id, e.target.value as SpecimenStatus);
                    setToast(`状态已更新为「${e.target.value}」`);
                  } catch (err) {
                    setToast(err instanceof Error ? err.message : '状态更新失败');
                  }
                }}
              >
                {OPEN_SPECIMEN_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                「已交付」不可直接选择，需通过下方交付入口办理。
              </Typography>
              <Button
                fullWidth
                variant="contained"
                color="success"
                startIcon={<SendIcon />}
                sx={{ mt: 1.25 }}
                onClick={openDelivery}
                data-testid="open-delivery"
              >
                办理交付
              </Button>
              {blockers.length > 0 ? (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                  当前存在 {blockers.length} 个交付卡点，全部节点完成后方可交付。
                </Typography>
              ) : null}
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2">工序完成度</Typography>
              <Chip size="small" label={`${progress.done}/${progress.total}`} />
              {progress.gaps.length > 0 ? (
                <Chip size="small" color="error" label={`跳号 ${progress.gaps.join(',')}`} />
              ) : (
                <Chip size="small" color="success" variant="outlined" label="序号连续" />
              )}
            </Stack>
            <LinearProgress variant="determinate" value={progress.percent} sx={{ height: 10, borderRadius: 5 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              当前待办：
              {progress.current ? `#${progress.current.seq} ${progress.current.stepType} · ${progress.current.nodeName}` : '全部节点已完成'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              已回退节点 {progress.rolledback} 个 · 完成率 {progress.percent}%
            </Typography>
          </Paper>
        </Stack>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              工序时间线
            </Typography>
            <ProcedureTimeline
              items={progress.list}
              readOnly={archived}
              onFinish={
                archived
                  ? undefined
                  : async (pid) => {
                      try {
                        await finish(pid);
                        setToast('节点已完成');
                      } catch (err) {
                        setToast(err instanceof Error ? err.message : '操作失败');
                      }
                    }
              }
              onRollback={
                archived
                  ? undefined
                  : async (pid) => {
                      try {
                        await rollback(pid);
                        setToast('节点已回退');
                      } catch (err) {
                        setToast(err instanceof Error ? err.message : '操作失败');
                      }
                    }
              }
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              修复影像留痕（{photos.length} 张）
            </Typography>
            {photos.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无影像条目，可在工序录入时挂接。
              </Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.5 }}>
                {photos.map((p) => (
                  <Paper key={p.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                    <Box component="img" src={p.dataUrl} alt={p.caption} sx={{ width: '100%', display: 'block' }} />
                    <Box sx={{ p: 1 }}>
                      <Chip size="small" label={PHOTO_STAGE_LABEL[p.stage]} />
                      <Typography variant="caption" display="block" noWrap title={p.caption}>
                        {p.caption}
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              修复前 {beforePhotos.length} 张 / 修复后 {afterPhotos.length} 张，全部存于浏览器本地 IndexedDB 影像表。
            </Typography>
          </Paper>
        </Stack>
      </Box>

      <Dialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} fullWidth maxWidth="sm" data-testid="delivery-dialog">
        <DialogTitle>办理标本交付 · {specimen.specimenNo}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {blockers.length > 0 ? (
              <Alert severity="warning" data-testid="delivery-blockers">
                <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                  节点未全部完成，暂不能交付，请先处理卡点：
                </Typography>
                <Stack spacing={0.25}>
                  {blockers.map((b, i) => (
                    <Typography key={b.kind} variant="body2">
                      {i + 1}. {b.message}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            ) : (
              <Alert severity="success" data-testid="delivery-ready">
                全部工序节点已完成，请登记交接信息后完成交付。交付后标本将归档，资料与工序转为只读。
              </Alert>
            )}

            <Divider sx={{ my: 0.5 }} />

            <TextField
              size="small"
              label="交付人"
              required
              disabled={blockers.length > 0}
              value={deliveredBy}
              onChange={(e) => setDeliveredBy(e.target.value)}
              inputProps={{ 'data-testid': 'delivery-by' }}
            />
            <TextField
              size="small"
              label="接收单位"
              required
              disabled={blockers.length > 0}
              value={receivingUnit}
              onChange={(e) => setReceivingUnit(e.target.value)}
              inputProps={{ 'data-testid': 'delivery-unit' }}
            />
            <TextField
              size="small"
              label="交接时间"
              type="datetime-local"
              required
              disabled={blockers.length > 0}
              value={deliveredAtLocal}
              onChange={(e) => setDeliveredAtLocal(e.target.value)}
              inputProps={{ 'data-testid': 'delivery-at' }}
              InputLabelProps={{ shrink: true }}
            />
            {deliveryError ? <Alert severity="error">{deliveryError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          {blockers.length > 0 ? (
            <Button variant="contained" onClick={() => setDeliveryOpen(false)}>
              知道了，去处理卡点
            </Button>
          ) : (
            <>
              <Button onClick={() => setDeliveryOpen(false)}>取消</Button>
              <Button variant="contained" color="success" startIcon={<SendIcon />} onClick={submitDelivery}>
                确认交付并归档
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2400} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}

/** 归档时给禁用按钮套一个说明性 Tooltip；未归档时直接渲染子元素 */
function TooltipForArchived({
  archived,
  hint,
  children,
}: {
  archived: boolean;
  hint: string;
  children: React.ReactElement;
}) {
  if (!archived) return children;
  return (
    <Tooltip title={hint}>
      <Box component="span">{children}</Box>
    </Tooltip>
  );
}
