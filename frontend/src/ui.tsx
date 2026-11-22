import { Alert, Button, Empty, Pagination, Spin, Table } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, FieldTimeOutlined, MinusCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import type { ApiError, Counts, Reply, State } from './api';
import { ru, time } from './ru';

export function errorText(error: ApiError) {
  return ru.errors[error.code] || error.message || ({ 403: ru.errors.FORBIDDEN,
    412: ru.errors.VERSION_CONFLICT, 429: ru.errors.RATE_LIMITED,
    503: ru.errors.SERVICE_UNAVAILABLE } as Record<number, string>)[error.status] || ru.unknown;
}
export function Problem({ error, data }: { error: ApiError; data?: Reply<unknown> }) {
  return <Alert showIcon type="error" message={errorText(error)} description={<>
    {data && <div>{ru.outdated}</div>}
    {error.status === 429 && error.retryAt > 0 && <div>{ru.wait} {time(error.retryAt)}</div>}
    <div>{data ? `${ru.lastSuccess} — ${time(data.receivedAt)}` : ru.noSuccess}</div>
  </>} />;
}
export function Read<T>({ result, children }: {
  result: { data?: Reply<T>; error?: ApiError }; children: (data: Reply<T>) => ReactNode;
}) {
  return <>
    {result.error ? <Problem error={result.error} data={result.data} /> : result.data &&
      <div className="read-info">{ru.lastSuccess} · <time dateTime={new Date(result.data.receivedAt).toISOString()}>
        {time(result.data.receivedAt)}
      </time></div>}
    {result.data ? children(result.data) : !result.error &&
      <div role="status"><Spin tip={ru.loading}><div className="loading" /></Spin></div>}
  </>;
}
const stateIcons: Record<State, typeof CheckCircleOutlined> = {
  AVAILABLE: CheckCircleOutlined, UNAVAILABLE: CloseCircleOutlined, NOT_CHECKED: MinusCircleOutlined,
  DISABLED: PauseCircleOutlined, STALE: FieldTimeOutlined,
};
const states = Object.keys(stateIcons) as State[];
const count = (counts: Counts, state: State) => counts[state.toLowerCase() as Lowercase<State>];

export function Status({ state, value }: { state: State; value?: number }) {
  const Icon = stateIcons[state];
  return <span className={`status-label state-${state}`}><Icon aria-hidden="true" />
    <span>{ru.state[state]}{value !== undefined && ` · ${value}`}</span>
  </span>;
}
export function Counter({ counts, overview }: { counts: Counts; overview?: boolean }) {
  if (overview) return <div className="state-overview">{states.map(state => <div key={state}>
    <Status state={state} /><div className="metric-value">{count(counts, state)}</div>
  </div>)}</div>;
  if (counts.total === 0) return <span className="read-info">{ru.noPorts}</span>;
  return <div className="status-counts">
    <span>{ru.total} {counts.total}</span>
    {states.filter(state => count(counts, state) > 0).map(state => <Status key={state} state={state} value={count(counts, state)} />)}
  </div>;
}
export function Grid<T extends { id: string }>({ rows, columns, meta, onPage, empty }: {
  rows: T[]; columns: ColumnsType<T>; meta: Reply<unknown>['meta']; onPage: (page: number, size: number) => void; empty: string;
}) {
  return <>
    <div className="table-wrap" tabIndex={0} role="region" aria-label={ru.table}>
      <Table<T> rowKey="id" dataSource={rows} columns={columns} pagination={false} size="small"
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} /> }} />
    </div>
    <Pagination className="monitor-pagination" size="small" current={meta.page} pageSize={meta.page_size} total={meta.total} showSizeChanger
      pageSizeOptions={[10, 20, 50, 100]} onChange={(page, size) => onPage(size === meta.page_size ? page : 1, size)} />
    {!!meta.page && meta.page > 1 && !rows.length && <Button onClick={() => onPage(1, meta.page_size ?? 20)}>{ru.firstPage}</Button>}
  </>;
}
