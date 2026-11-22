import { Alert, Button, Card, Descriptions, Form, Input, Select, Space, Statistic, Switch } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useState, type ReactNode } from 'react';
import { currentState, query, type Api, type ApiError, type Equipment, type EquipmentRow, type EquipmentView, type List, type Probe,
  type RackRow, type Settings, type Summary, type TargetRow } from './api';
import { settingsGroups, type Edit, type useRacks } from './editor';
import { usePoll } from './poll';
import { ru, time } from './ru';
import { Counter, Grid, Read, Status, errorText } from './ui';

type Filters = Record<string, string | undefined>;
type Filter = { key: string; label: string; options?: { value: string; label: string }[]; date?: boolean };
type Common = { api: Api; revision: number; admin: boolean; edit: (edit: Edit) => void };
type Navigate = (path: string) => void;
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const enabledOptions = [{ value: 'true', label: ru.on }, { value: 'false', label: ru.off }];
const search = { key: 'q', label: ru.search };
const diagnostic = (result?: { error_code: string | null; error_text: string | null } | null) =>
  [result?.error_code, result?.error_text].filter(Boolean).join(' · ') || ru.missing;
const duration = (value?: number) => value === undefined ? ru.missing : `${value} ${ru.ms}`;

function usePage() {
  const [page, set] = useState({ page: 1, page_size: 20 });
  return { page, setPage: (page: number, page_size: number) => set({ page, page_size }), reset: () => set(p => ({ ...p, page: 1 })) };
}
function FilterBar({ fields, apply, error }: { fields: Filter[]; apply: (values: Filters) => void; error?: ApiError }) {
  const [form] = Form.useForm<Filters>();
  useEffect(() => {
    if (error?.status === 422) form.setFields(Object.entries(error.fields).map(([name, message]) => ({ name, errors: [message] })));
  }, [form, error]);
  return <Form form={form} layout="vertical" className="filters" onFinish={values => {
    const from = values.from ? new Date(values.from) : undefined;
    const to = values.to ? new Date(values.to) : undefined;
    if (from && to && from >= to) {
      form.setFields([{ name: 'to', errors: [ru.period] }]);
      return;
    }
    apply({ ...values, ...(from ? { from: from.toISOString() } : {}), ...(to ? { to: to.toISOString() } : {}) });
  }}>
    {fields.map(field => <Form.Item key={field.key} name={field.key} label={field.date ? `${field.label} (${ru.localTime})` : field.label}>
      {field.options ? <Select aria-label={field.label} allowClear showSearch optionFilterProp="label" placeholder={ru.any} options={field.options} /> :
        <Input prefix={field.date ? undefined : <SearchOutlined aria-hidden="true" />} type={field.date ? 'datetime-local' : 'search'} maxLength={field.date ? undefined : 200} />}
    </Form.Item>)}
    <Space wrap className="filter-actions"><Button htmlType="submit">{ru.filters}</Button>
      <Button onClick={() => { form.resetFields(); apply({}); }}>{ru.reset}</Button></Space>
  </Form>;
}
function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="heading"><h1>{title}</h1>{children}</div>;
}
function Actions({ kind, path, edit, compact }: { kind: Edit['kind']; path: string; edit: Common['edit']; compact?: boolean }) {
  if (compact) return <div className="row-actions">
    <Button size="small" icon={<EditOutlined aria-hidden="true" />} aria-label={ru.edit} title={ru.edit}
      onClick={() => edit({ kind, path, mode: 'edit' })} />
    <Button size="small" danger type="text" icon={<DeleteOutlined aria-hidden="true" />} aria-label={ru.remove} title={ru.remove}
      onClick={() => edit({ kind, path, mode: 'delete' })} />
  </div>;
  return <Space wrap>
    <Button icon={<EditOutlined aria-hidden="true" />} onClick={() => edit({ kind, path, mode: 'edit' })}>{ru.edit}</Button>
    <Button danger type="text" icon={<DeleteOutlined aria-hidden="true" />} onClick={() => edit({ kind, path, mode: 'delete' })}>{ru.remove}</Button>
  </Space>;
}
function Monitoring({ value, change }: { value: boolean; change?: () => void }) {
  return <Space>
    {change && <Switch aria-label={ru.monitoring} checked={value} onChange={change} />}
    <span>{value ? ru.on : ru.off}</span>
  </Space>;
}

export function SummaryScreen({ api, revision }: Common) {
  const result = usePoll<Summary>(api, '/summary', revision);
  return <>
    <Heading title={ru.summary} />
    <Read result={result}>{({ data }) => <>
      <div className="metrics">
        <Card><Statistic className="metric-value" title={ru.racks} value={data.racks_total} /></Card>
        <Card><Statistic className="metric-value" title={ru.equipment} value={data.equipment_total} /></Card>
        <Card><Statistic className="metric-value" title={ru.ports} value={data.targets.total} /></Card>
      </div>
      <Card title={ru.portState}><Counter counts={data.targets} overview /></Card>
    </>}</Read>
  </>;
}

export function RacksScreen({ api, revision, admin, edit }: Common) {
  const paging = usePage();
  const [filters, setFilters] = useState<Filters>({});
  const result = usePoll<List<RackRow>>(api, query('/racks', { ...filters, ...paging.page }), revision);
  return <>
    <Heading title={ru.racks}>{admin && <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => edit({ kind: 'rack', path: '/racks', mode: 'create' })}>{ru.addRack}</Button>}</Heading>
    <FilterBar error={result.error} fields={[search]} apply={values => { setFilters(values); paging.reset(); }} />
    <Read result={result}>{({ data, meta }) => <Grid empty={Object.values(filters).some(Boolean) ? ru.noMatches : ru.noRacks} rows={data.items} meta={meta} onPage={paging.setPage} columns={[
      { title: ru.name, dataIndex: 'name', className: 'row-name' }, { title: ru.location, render: (_, row) => row.location ?? ru.missing },
      { title: ru.description, render: (_, row) => row.description ?? ru.missing },
      { title: ru.equipment, dataIndex: 'equipment_count' },
      ...(admin ? [{ title: ru.actions, render: (_: unknown, row: RackRow) => <Actions compact kind="rack" path={'/racks/' + row.id} edit={edit} /> }] : []),
    ]} />}</Read>
  </>;
}

export function EquipmentScreen({ api, revision, admin, edit, racks, navigate }: Common & {
  racks: ReturnType<typeof useRacks>; navigate: Navigate;
}) {
  const paging = usePage();
  const [filters, setFilters] = useState<Filters>({});
  const result = usePoll<List<EquipmentRow>>(api, query('/equipment', { ...filters, ...paging.page }), revision);
  return <>
    <Heading title={ru.equipment}>{admin && <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => edit({ kind: 'equipment', path: '/equipment', mode: 'create' })}>{ru.addEquipment}</Button>}</Heading>
    {racks.error && <Alert type="error" message={errorText(racks.error)} />}
    <FilterBar error={result.error} fields={[search, { key: 'rack_id', label: ru.rack, options: racks.rows.map(row => ({ value: row.id, label: row.name })) },
      { key: 'type', label: ru.type, options: options(ru.types) }, { key: 'monitoring_enabled', label: ru.monitoring, options: enabledOptions },
      { key: 'target_state', label: ru.portState, options: options(ru.state) }]} apply={values => { setFilters(values); paging.reset(); }} />
    <Read result={result}>{({ data, meta }) => <Grid empty={Object.values(filters).some(Boolean) ? ru.noMatches : ru.noEquipment} rows={data.items} meta={meta} onPage={paging.setPage} columns={[
      { title: ru.name, className: 'row-name', render: (_, row) => <Button type="link" onClick={() => navigate('/equipment/' + row.id)}>{row.name}</Button> },
      { title: ru.inventory, dataIndex: 'inventory_number' }, { title: ru.type, render: (_, row) => ru.types[row.type] },
      { title: ru.rack, dataIndex: 'rack_name' }, { title: ru.address, dataIndex: 'address' },
      { title: ru.monitoring, render: (_, row) => <Monitoring value={row.monitoring_enabled} change={admin ? () => edit({
        kind: 'equipment', path: '/equipment/' + row.id, mode: 'edit', toggle: true,
      }) : undefined} /> },
      { title: ru.ports, render: (_, row) => <Counter counts={row.target_counts} /> },
      ...(admin ? [{ title: ru.actions, render: (_: unknown, row: EquipmentRow) => <Actions compact kind="equipment" path={'/equipment/' + row.id} edit={edit} /> }] : []),
    ]} />}</Read>
  </>;
}

function EquipmentDetails({ equipment, rack }: { equipment: Equipment; rack: string }) {
  return <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
    { key: 'inventory', label: ru.inventory, children: equipment.inventory_number },
    { key: 'type', label: ru.type, children: ru.types[equipment.type] },
    { key: 'rack', label: ru.rack, children: rack },
    { key: 'address', label: ru.address, children: equipment.address },
    { key: 'monitoring', label: ru.monitoring, children: <Monitoring value={equipment.monitoring_enabled} /> },
  ]} />;
}

export function DetailScreen({ api, revision, admin, edit, id, navigate }: Common & { id: string; navigate: Navigate }) {
  const paging = usePage();
  const path = '/equipment/' + id;
  const result = usePoll<EquipmentView>(api, query(path + '/view', paging.page), revision);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const reply = result.data;
    if (!reply) return;
    const serverTime = Date.parse(reply.meta.server_time);
    const elapsed = serverTime + performance.now() - reply.received;
    const deadlines = reply.data.targets.flatMap(target => target.stale_at && (target.state === 'AVAILABLE' || target.state === 'UNAVAILABLE')
      ? [Date.parse(target.stale_at)] : []).filter(deadline => deadline > elapsed).sort((a, b) => a - b);
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      setNow(performance.now());
      if (timer) clearTimeout(timer);
      const next = deadlines.find(deadline => deadline > serverTime + performance.now() - reply!.received);
      if (next !== undefined) timer = setTimeout(schedule, Math.max(1, next - serverTime - performance.now() + reply!.received));
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [result.data]);
  return <>
    <Button type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} className="back" onClick={() => navigate('/equipment')}>{ru.back}</Button>
    <Read result={result}>{reply => {
      const { data, meta } = reply;
      return <>
        <Heading title={data.equipment.name}>{admin && <Actions kind="equipment" path={path} edit={edit} />}</Heading>
        <EquipmentDetails equipment={data.equipment} rack={data.rack.name} />
        <div className="heading"><h2>{ru.ports}</h2>
          {admin && <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => edit({ kind: 'target', path: path + '/targets', mode: 'create' })}>{ru.addPort}</Button>}
        </div>
        <Grid empty={ru.noTargets} rows={data.targets} meta={meta} onPage={paging.setPage} columns={[
          { title: ru.port, dataIndex: 'tcp_port' }, { title: ru.label, render: (_, row) => row.label ?? ru.missing },
          { title: ru.monitoring, render: (_, row) => <div>
            <Monitoring value={row.monitoring_enabled} change={admin ? () => edit({ kind: 'target', path: '/targets/' + row.id,
              mode: 'edit', toggle: true }) : undefined} />
            {row.monitoring_enabled && !row.effective_monitoring_enabled && <div>{ru.effectiveOff}</div>}
          </div> },
          { title: ru.portState, render: (_, row) => {
            const state = currentState(row, reply, Math.max(now, reply.received));
            return <><Status state={state} />{state === 'STALE' && row.last_result &&
              <div className="read-info status-detail">{ru.lastOutcome} · <Status state={row.last_result.status} /></div>}</>;
          } },
          { title: ru.lastCheck, render: (_, row) => time(row.last_result?.checked_at) },
          { title: ru.duration, render: (_, row) => duration(row.last_result?.duration_ms) },
          { title: ru.diagnostic, render: (_, row) => diagnostic(row.last_result) },
          { title: ru.history, render: (_, row) => <Button onClick={() => navigate(`${path}/ports/${row.id}/history`)}>{ru.history} · {row.tcp_port}</Button> },
          ...(admin ? [{ title: ru.actions, render: (_: unknown, row: TargetRow) => <Actions compact kind="target" path={'/targets/' + row.id} edit={edit} /> }] : []),
        ]} />
      </>;
    }}</Read>
  </>;
}

export function HistoryScreen({ api, revision, id, target, navigate }: Common & { id: string; target: string; navigate: Navigate }) {
  const [filters, setFilters] = useState<Filters>({});
  const paging = usePage();
  const result = usePoll<List<Probe>>(api, query(`/targets/${target}/history`, { ...filters, ...paging.page }), revision);
  return <>
    <Button type="text" icon={<ArrowLeftOutlined aria-hidden="true" />} className="back" onClick={() => navigate('/equipment/' + id)}>{ru.backPorts}</Button>
    <Heading title={ru.history} />
    <FilterBar error={result.error} fields={[{ key: 'from', label: ru.from, date: true }, { key: 'to', label: ru.to, date: true },
      { key: 'status', label: ru.outcome, options: options({ AVAILABLE: ru.state.AVAILABLE, UNAVAILABLE: ru.state.UNAVAILABLE }) }]}
      apply={values => { setFilters(values); paging.reset(); }} />
    <Read result={result}>{({ data, meta }) => <>
      {meta.retention_cutoff && <div className="read-info">{ru.cutoff} — {time(meta.retention_cutoff)}</div>}
      <Grid empty={Object.values(filters).some(Boolean) ? ru.noMatches : ru.noHistory} rows={data.items} meta={meta} onPage={paging.setPage} columns={[
        { title: ru.checked, render: (_, row) => time(row.finished_at) },
        { title: ru.address, dataIndex: 'address_snapshot' }, { title: ru.port, dataIndex: 'port_snapshot' },
        { title: ru.outcome, render: (_, row) => <Status state={row.status} /> },
        { title: ru.duration, render: (_, row) => duration(row.duration_ms) },
        { title: ru.diagnostic, render: (_, row) => diagnostic(row) },
      ]} />
    </>}</Read>
  </>;
}

export function SettingsScreen({ api, revision, admin, edit }: Common) {
  const result = usePoll<Settings>(api, '/settings', revision);
  return <>
    <Heading title={ru.settings}>{admin && <Button type="primary" icon={<EditOutlined aria-hidden="true" />} onClick={() => edit({ kind: 'settings', path: '/settings', mode: 'edit' })}>{ru.edit}</Button>}</Heading>
    <Read result={result}>{({ data }) => <div className="settings-groups">
      {settingsGroups.map(group => <section key={group.title}>
        <h2>{group.title}</h2>
        <Descriptions bordered size="small" column={1} items={group.fields.map(field => ({
          key: field.key, label: field.label, children: data[field.key as keyof Settings],
        }))} />
      </section>)}
    </div>}</Read>
  </>;
}
