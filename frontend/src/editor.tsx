import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, query, type Api, type List, type Rack, type Reply } from './api';
import { ru, time } from './ru';
import { errorText } from './ui';

type Value = string | number | boolean | null;
type Values = Record<string, Value>;
type Field = { key: string; label: string; max?: number; required?: boolean; nullable?: boolean;
  range?: [number, number]; choices?: Record<string, string>; kind?: 'rack' | 'switch' | 'textarea' };
export type Kind = 'rack' | 'equipment' | 'target' | 'settings';
export type Edit = { kind: Kind; path: string; mode: 'create' | 'edit' | 'delete'; toggle?: boolean };
const monitoring: Field = { key: 'monitoring_enabled', label: ru.monitoring, kind: 'switch' };
export const fields: Record<Kind, Field[]> = {
  rack: [{ key: 'name', label: ru.name, required: true, max: 100 },
    { key: 'location', label: ru.location, nullable: true, max: 200 },
    { key: 'description', label: ru.description, nullable: true, max: 2000, kind: 'textarea' }],
  equipment: [{ key: 'rack_id', label: ru.rack, required: true, kind: 'rack' },
    { key: 'name', label: ru.name, required: true, max: 200 },
    { key: 'inventory_number', label: ru.inventory, required: true, max: 100 },
    { key: 'type', label: ru.type, required: true, choices: ru.types },
    { key: 'address', label: ru.address, required: true, max: 253 }, monitoring],
  target: [{ key: 'tcp_port', label: ru.port, range: [1, 65535] },
    { key: 'label', label: ru.label, nullable: true, max: 100 }, monitoring],
  settings: [{ key: 'interval_seconds', label: ru.interval, range: [10, 3600] },
    { key: 'timeout_ms', label: ru.timeout, range: [100, 10000] },
    { key: 'concurrency', label: ru.concurrency, range: [1, 200] },
    { key: 'stale_after_seconds', label: ru.stale, range: [11, 86400] },
    { key: 'retention_days', label: ru.retention, range: [1, 30] }],
};

export const settingsGroups = [
  { title: ru.probes, fields: fields.settings.slice(0, 3) },
  { title: ru.observations, fields: fields.settings.slice(3) },
];

export function validateFields(kind: Kind, values: Values) {
  const errors: Record<string, string> = {};
  for (const field of fields[kind]) {
    const value = values[field.key];
    if (field.required && (typeof value !== 'string' || !value.trim())) errors[field.key] = ru.required;
    if (field.max && typeof value === 'string' && [...value].length > field.max) errors[field.key] = ru.max(field.max);
    if (field.range && (typeof value !== 'number' || !Number.isInteger(value) || value < field.range[0] || value > field.range[1])) {
      errors[field.key] = ru.range(...field.range);
    }
  }
  const address = values.address;
  if (kind === 'equipment' && typeof address === 'string' && address.length && !errors.address) {
    const dns = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i;
    let valid = dns.test(address);
    if (address.includes(':') && /^[a-f0-9:.]+$/i.test(address)) {
      try { valid = !!new URL(`http://[${address}]/`).hostname; } catch { valid = false; }
    }
    if (/^[\d.]+$/.test(address) && address.includes('.')) {
      valid = /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address) && address.split('.').every(part => Number(part) <= 255);
    }
    if (!valid) errors.address = ru.invalidAddress;
  }
  if (kind === 'settings') {
    const { interval_seconds: interval, timeout_ms: timeout, stale_after_seconds: stale } = values;
    if (!errors.interval_seconds && !errors.timeout_ms && Number(timeout) >= Number(interval) * 1000) errors.timeout_ms = ru.timeoutRange;
    if (!errors.stale_after_seconds && Number(stale) < Number(interval) + Math.ceil(Number(timeout) / 1000)) errors.stale_after_seconds = ru.staleRange;
  }
  return errors;
}

export function useRacks(api: Api, enabled: boolean) {
  const [result, setResult] = useState<{ rows: Rack[]; error?: ApiError; loading: boolean }>({ rows: [], loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
      setResult(previous => ({ ...previous, loading: true, error: undefined }));
      try {
        const rows: Rack[] = [];
        let page = 1;
        while (true) {
          const reply = await api.request<List<Rack>>(query('/racks', { page, page_size: 100 }), { signal: controller.signal });
          rows.push(...reply.data.items);
          if (!reply.data.items.length || page * (reply.meta.page_size ?? 100) >= (reply.meta.total ?? rows.length)) break;
          page++;
        }
        if (!controller.signal.aborted) setResult({ rows, loading: false });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ rows: [], error: error as ApiError, loading: false });
      }
    }
    void load();
    return () => controller.abort();
  }, [api, enabled]);
  return result;
}

const addTitle = { rack: ru.addRack, equipment: ru.addEquipment, target: ru.addPort, settings: ru.settings };
const deleteText = { rack: ru.deleteRack, equipment: ru.deleteEquipment, target: ru.deleteTarget, settings: '' };
const display = (value: Value | undefined) => value === true ? ru.on : value === false ? ru.off : value ?? ru.missing;

export function Editor({ edit, api, racks, onClose, onSaved }: {
  edit: Edit; api: Api; racks: ReturnType<typeof useRacks>; onClose: () => void; onSaved: () => void;
}) {
  const [form] = Form.useForm<Values>();
  const [version, setVersion] = useState<Reply<Values>>();
  const original = useRef<Values | undefined>(undefined);
  const [comparison, setComparison] = useState(false);
  const [loading, setLoading] = useState(edit.mode !== 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [retry, setRetry] = useState(0);
  const [readRevision, setReadRevision] = useState(0);
  const read = useRef<AbortController | undefined>(undefined);
  const write = useRef<AbortController | undefined>(undefined);
  const { kind, mode, path, toggle } = edit;
  const definition = fields[kind];
  const title = mode === 'create' ? addTitle[kind] : mode === 'delete' ? ru.confirm : ru.edit;

  useEffect(() => () => { read.current?.abort(); write.current?.abort(); }, []);
  useEffect(() => {
    if (!error?.retryAt) return;
    const timer = setTimeout(() => setRetry(0), Math.max(0, error.retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (mode === 'create') return;
    const controller = new AbortController();
    read.current = controller;
    const compare = comparison;
    void api.request<Values>(path, { signal: controller.signal }).then(reply => {
      if (!reply.etag) throw new ApiError(0, 'MISSING_ETAG', ru.missingEtag);
      if (controller.signal.aborted) return;
      setVersion(reply);
      if (!compare && mode === 'edit') {
        original.current = reply.data;
        form.setFieldsValue({ ...reply.data, ...(toggle ? { monitoring_enabled: !reply.data.monitoring_enabled } : {}) });
      }
      setError(undefined);
    }).catch((failure: ApiError) => {
      if (!controller.signal.aborted) {
        setError(failure);
        setRetry(failure.retryAt);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, comparison, form, mode, path, readRevision, toggle]);

  function reread() {
    setLoading(true);
    setComparison(error?.status === 412 || comparison);
    // A failed comparison can be requested again without touching the draft.
    setReadRevision(value => value + 1);
  }

  async function submit() {
    if (write.current || loading || retry > Date.now() || error?.status === 412) return;
    if (mode !== 'create' && !version?.etag) return;
    const values = form.getFieldsValue(true);
    const body: Values = {};
    if (mode !== 'delete') {
      for (const field of definition) {
        const value = values[field.key];
        body[field.key] = typeof value === 'string' && field.required ? value.trim() : value ?? (field.nullable ? null : value);
      }
      if (mode === 'edit' && version) {
        for (const key of Object.keys(body)) {
          if (body[key] === original.current?.[key] || body[key] === version.data[key]) delete body[key];
        }
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
      }
      const errors = validateFields(kind, { ...version?.data, ...body });
      if (Object.keys(errors).length) {
        form.setFields(Object.entries(errors).map(([name, message]) => ({ name, errors: [message] })));
        return;
      }
    }
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      await api.request(path, { method: mode === 'create' ? 'POST' : mode === 'edit' ? 'PATCH' : 'DELETE',
        body: mode === 'delete' ? undefined : body, etag: version?.etag ?? undefined, signal: controller.signal });
      if (!controller.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.signal.aborted) return;
      const apiError = failure as ApiError;
      setError(apiError);
      setRetry(apiError.retryAt);
      if (apiError.status === 412) setVersion(undefined);
      form.setFields(Object.entries(apiError.fields).map(([name, message]) => ({ name, errors: [message] })));
    } finally {
      write.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const renderField = (field: Field) => <Form.Item key={field.key} name={field.key} label={field.label}
    required={field.required || !!field.range} valuePropName={field.kind === 'switch' ? 'checked' : 'value'}>
    {field.kind === 'switch' ? <Switch aria-label={field.label} checkedChildren={ru.on} unCheckedChildren={ru.off} /> :
      field.kind === 'rack' ? <Select aria-label={field.label} showSearch optionFilterProp="label" loading={racks.loading}
        options={racks.rows.map(rack => ({ value: rack.id, label: rack.name }))} /> :
      field.choices ? <Select aria-label={field.label} options={Object.entries(field.choices).map(([value, label]) => ({ value, label }))} /> :
      field.range ? <InputNumber className="stack" /> :
      field.kind === 'textarea' ? <Input.TextArea rows={3} /> : <Input />}
  </Form.Item>;

  return <Modal open focusTriggerAfterClose={false} title={title} onCancel={onClose} closable={!busy} maskClosable={false} keyboard={!busy}
    footer={<Space wrap><Button disabled={busy} onClick={onClose}>{ru.cancel}</Button>
      <Button type="primary" danger={mode === 'delete'} loading={busy}
        disabled={loading || (mode !== 'create' && !version) || retry > Date.now()}
        htmlType={mode === 'delete' ? 'button' : 'submit'} form="resource-editor"
        onClick={mode === 'delete' ? () => void submit() : undefined}>{mode === 'delete' ? ru.remove : ru.save}</Button>
    </Space>}>
    <Space direction="vertical" className="stack">
      {error && <Alert type="error" showIcon message={errorText(error)} description={error.status === 429 && error.retryAt > Date.now() ? `${ru.wait} ${time(error.retryAt)}` : undefined}
        action={mode !== 'create' && !version && !loading && retry <= Date.now() ?
          <Button onClick={reread}>{ru.reread}</Button> : undefined} />}
      {loading && <div role="status"><Spin tip={ru.loading}><div className="loading" /></Spin></div>}
      {mode === 'delete' ? <div>{deleteText[kind]} {version && display(version.data.name ?? version.data.tcp_port)}</div> :
        <Form className="editor-form" id="resource-editor" form={form} layout="vertical" initialValues={{ monitoring_enabled: true, type: 'SERVER' }}
          disabled={busy || loading} onFinish={() => void submit()} onValuesChange={changed => {
            form.setFields(Object.keys(changed).map(name => ({ name, errors: [] })));
          }}>
          {kind === 'settings' ? settingsGroups.map(group => <fieldset key={group.title} className="settings-fields">
            <legend>{group.title}</legend>
            {group.fields.map(renderField)}
          </fieldset>) : definition.map(renderField)}
        </Form>}
      {kind === 'equipment' && mode !== 'delete' && racks.error && <Alert type="error" message={errorText(racks.error)} />}
      {comparison && version && mode === 'edit' && <Alert type="info" message={ru.current} description={<>
        <p>{ru.conflictHelp}</p><Descriptions size="small" column={1} items={definition.map(field => ({
          key: field.key, label: field.label, children: display(version.data[field.key]),
        }))} /></>} />}
    </Space>
  </Modal>;
}
