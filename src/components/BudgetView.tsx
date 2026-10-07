import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORIES, CATEGORY_META, type Category } from '../types'
import { addDays, dayActivities, formatDate, formatMoney, tripTotalCost } from '../utils'

export default function BudgetView() {
  const trip = useCurrentTrip()
  const updateTrip = useStore((s) => s.updateTrip)
  const total = tripTotalCost(trip)
  const cur = trip.currency

  const byCategory = useMemo(() => {
    const sums: Record<Category, number> = { sight: 0, food: 0, transport: 0, lodging: 0, shopping: 0, other: 0 }
    Object.values(trip.activities).forEach((a) => (sums[a.category] += a.cost || 0))
    return CATEGORIES.map((c) => ({ key: c, name: CATEGORY_META[c].label, value: sums[c], color: CATEGORY_META[c].color })).filter(
      (d) => d.value > 0,
    )
  }, [trip])

  const byDay = useMemo(
    () =>
      trip.days.map((_, i) => {
        const row: Record<string, number | string> = { name: `D${i + 1}`, date: formatDate(addDays(trip.startDate, i)) }
        let sum = 0
        CATEGORIES.forEach((c) => (row[c] = 0))
        dayActivities(trip, i).forEach((a) => {
          row[a.category] = (row[a.category] as number) + (a.cost || 0)
          sum += a.cost || 0
        })
        row.total = sum
        return row
      }),
    [trip],
  )

  const usedCategories = CATEGORIES.filter((c) => byDay.some((r) => (r[c] as number) > 0))
  const remaining = trip.budget - total
  const over = trip.budget > 0 && total > trip.budget
  const pct = trip.budget > 0 ? Math.min(100, (total / trip.budget) * 100) : 0
  const topDay = byDay.reduce((best, r) => ((r.total as number) > (best?.total as number) ? r : best), byDay[0])
  const money = (v: number) => formatMoney(v, cur)

  return (
    <div className="budget">
      <div className="kpis">
        <div className="kpi">
          <div className="label">總花費</div>
          <div className={`value ${over ? 'over' : ''}`}>{money(total)}</div>
          {trip.budget > 0 && (
            <div className="progress">
              <span className={over ? 'over' : ''} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="label">預算</div>
          <div className="value" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <input
              type="number"
              min={0}
              value={trip.budget || ''}
              placeholder="輸入預算"
              onChange={(e) => updateTrip({ budget: Number(e.target.value) || 0 })}
              style={{ fontSize: 18, fontWeight: 700, padding: '2px 6px' }}
            />
          </div>
        </div>
        <div className="kpi">
          <div className="label">{over ? '超支' : '剩餘'}</div>
          <div className={`value ${over ? 'over' : ''}`}>{trip.budget > 0 ? money(Math.abs(remaining)) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">每日平均</div>
          <div className="value">{money(total / Math.max(1, trip.days.length))}</div>
        </div>
        <div className="kpi">
          <div className="label">花費最高</div>
          <div className="value">{topDay ? `${topDay.name} · ${money(topDay.total as number)}` : '—'}</div>
        </div>
      </div>

      <div className="panel-card">
        <h3>依類別</h3>
        {byCategory.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>尚無花費資料。</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {byCategory.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <table>
              <thead>
                <tr>
                  <th>類別</th>
                  <th className="num">金額</th>
                  <th className="num">占比</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((d) => (
                  <tr key={d.key}>
                    <td>
                      <span className="chip">
                        <i style={{ background: d.color }} />
                        {CATEGORY_META[d.key].icon} {d.name}
                      </span>
                    </td>
                    <td className="num">{money(d.value)}</td>
                    <td className="num">{total ? ((d.value / total) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="panel-card">
        <h3>每日花費</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => Number(v).toLocaleString()} />
            <Tooltip
              formatter={(v, name) => [money(Number(v)), CATEGORY_META[name as Category]?.label ?? name]}
              labelFormatter={(label, payload) => `${label} · ${payload?.[0]?.payload?.date ?? ''}`}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
              cursor={{ fill: 'var(--surface-2)' }}
            />
            <Legend formatter={(value) => CATEGORY_META[value as Category]?.label ?? value} />
            {usedCategories.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                stackId="a"
                fill={CATEGORY_META[c].color}
                stroke="var(--surface)"
                strokeWidth={1}
                isAnimationActive={false}
                radius={i === usedCategories.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>天</th>
              <th>日期</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {byDay.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.date}</td>
                <td className="num">{money(r.total as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
