import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TrendPoint } from '../../types/analytics'

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function AnalyticsTrendChart({
  trend,
}: {
  trend?: TrendPoint[] | null
}) {
  if (!Array.isArray(trend) || trend.length === 0) {
    return (
      <div className="flex min-h-64 items-center justify-center px-5 py-10 text-center" role="status">
        <div>
          <p className="text-sm font-medium text-slate-700">No trend points returned</p>
          <p className="mt-1 text-xs text-slate-500">
            The analysis response did not include trend data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-clip p-4 pt-5 sm:p-6">
      <div className="h-72 w-full sm:h-80" role="img" aria-label="Line chart of CPU and memory utilization by timestamp">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="#e8eeea" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(value: string) => formatTimestamp(value)}
              minTickGap={32}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={{ stroke: '#dce5df' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(value: number) => `${value}%`}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              labelFormatter={(value) => formatTimestamp(String(value))}
              formatter={(value, name) => [
                `${formatNumber(Number(value))}%`,
                name === 'cpu_utilization' ? 'CPU utilization' : 'Memory utilization',
              ]}
              contentStyle={{
                borderRadius: 10,
                borderColor: '#e2e9e4',
                boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
                fontSize: 12,
              }}
            />
            <Legend
              formatter={(value) =>
                value === 'cpu_utilization' ? 'CPU utilization' : 'Memory utilization'
              }
              wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
            />
            <Line
              type="monotone"
              dataKey="cpu_utilization"
              name="cpu_utilization"
              stroke="#166534"
              strokeWidth={2.5}
              dot={trend.length < 30}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="memory_utilization"
              name="memory_utilization"
              stroke="#4f8f77"
              strokeWidth={2.5}
              dot={trend.length < 30}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>Trend data returned by the analytics API</caption>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>CPU utilization (%)</th>
              <th>Memory utilization (%)</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((point, index) => (
              <tr key={`${point.timestamp}-${index}`}>
                <td>{point.timestamp}</td>
                <td>{point.cpu_utilization}</td>
                <td>{point.memory_utilization}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {trend.length} timestamped observation{trend.length === 1 ? '' : 's'} returned. Values are percentages.
      </p>
    </div>
  )
}
