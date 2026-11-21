import { Alert, Button, Empty, Pagination, Space, Spin, Table, Tag } from 'antd';
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
    {result.error && <Problem error={result.error} data={result.data} />}
    {result.data ? children(result.data) : !result.error && <Spin tip={ru.loading}><div className="loading" /></Spin>}
  </>;
}
const colors: Record<State, string> = { AVAILABLE: 'green', UNAVAILABLE: 'red', NOT_CHECKED: 'default', DISABLED: 'blue', STALE: 'gold' };
export const states = Object.keys(colors) as State[];
export function Status({ state }: { state: State }) {
  return <Tag color={colors[state]}>{ru.state[state]}</Tag>;
}
export function Counter({ counts }: { counts: Counts }) {
  return <Space size={[2, 4]} wrap>
    <span>{ru.total} {counts.total}</span>
    {states.map(state => <Tag key={state} color={colors[state]}>
      {ru.state[state]} {counts[state.toLowerCase() as Lowercase<State>]}
    </Tag>)}
  </Space>;
}
export function Grid<T extends { id: string }>({ rows, columns, meta, onPage }: {
  rows: T[]; columns: ColumnsType<T>; meta: Reply<unknown>['meta']; onPage: (page: number, size: number) => void;
}) {
  return <>
    <div className="table-wrap" tabIndex={0} role="region" aria-label={ru.table}>
      <Table<T> rowKey="id" dataSource={rows} columns={columns} pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={ru.empty} /> }} />
    </div>
    <Pagination current={meta.page} pageSize={meta.page_size} total={meta.total} showSizeChanger
      pageSizeOptions={[10, 20, 50, 100]} onChange={(page, size) => onPage(size === meta.page_size ? page : 1, size)} />
    {!!meta.page && meta.page > 1 && !rows.length && <Button onClick={() => onPage(1, meta.page_size ?? 20)}>1</Button>}
  </>;
}
