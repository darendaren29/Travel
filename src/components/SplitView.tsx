import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORIES, CATEGORY_META, type Category, type Expense, type Person, type Trip } from '../types'
import { addDays, dayActivities, formatDate, formatMoney } from '../utils'
import { balances, personColor, settlements, shareOf, summaryText, totalSpent, type Balance } from '../split'
import { useEscape } from '../useEscape'

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const EPS = 0.005

/** A traveller's initial in their colour: the same mark everywhere they appear on this page. */
function Avatar({ person, people, size }: { person: Person | undefined; people: Person[]; size?: 'sm' }) {
  return (
    <span className={`pavatar ${size ?? ''}`} style={{ '--pc': person ? personColor(people, person.id) : 'var(--muted)' } as React.CSSProperties} aria-hidden="true">
      {(person?.name ?? '?').trim().slice(0, 1) || '?'}
    </span>
  )
}

/** "第 2 天 · 11/21 (六)" when the date falls inside the trip, else just the date. */
const dateHeading = (trip: Trip, iso: string): string => {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  const idx = Math.round((d.getTime() - addDays(trip.startDate, 0).getTime()) / 86400000)
  const label = formatDate(d)
  return idx >= 0 && idx < trip.days.length ? `第 ${idx + 1} 天 · ${label}` : label
}

/** 分帳: who paid, who shares, who still owes whom. */
export default function SplitView() {
  const trip = useCurrentTrip()
  const { user, addPerson, renamePerson, removePerson, addExpense, deleteExpense, setNotice } = useStore()
  const people = trip.people ?? []
  const expenses = useMemo(() => [...(trip.expenses ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt), [trip.expenses])
  const bals = useMemo(() => balances(trip), [trip])
  const settle = useMemo(() => settlements(bals), [bals])
  const total = totalSpent(trip)
  const money = (n: number) => formatMoney(n, trip.currency)
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  // Newest day first, one group per date.
  const byDate = useMemo(() => {
    const groups: { date: string; items: Expense[] }[] = []
    for (const e of expenses) {
      const g = groups[groups.length - 1]
      if (g && g.date === e.date) g.items.push(e)
      else groups.push({ date: e.date, items: [e] })
    }
    return groups
  }, [expenses])
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [newName, setNewName] = useState('')

  const add = () => {
    const name = newName.trim()
    if (!name) return
    addPerson(name)
    setNewName('')
  }

  const remove = (p: Person) => {
    if (!removePerson(p.id)) alert(`「${p.name}」還有支出紀錄，先刪除或改掉那些紀錄才能移除。`)
  }

  const markPaid = (from: Person, to: Person, amount: number) => {
    addExpense({ kind: 'transfer', title: `${from.name} 還給 ${to.name}`, amount, paidBy: from.id, participants: [to.id], date: isoDate(new Date()), category: 'other' })
  }

  const copySummary = async () => {
    const text = summaryText(trip, money)
    try {
      await navigator.clipboard.writeText(text)
      setNotice('已複製分帳摘要，可以貼到 LINE 群組')
    } catch {
      prompt('請手動複製：', text)
    }
  }

  // Empty state: add the first travellers.
  if (people.length === 0)
    return (
      <div className="split">
        <div className="docs-locked split-intro">
          <div className="stamp">🧾</div>
          <h3>分帳</h3>
          <p>先加入一起出遊的旅伴（不需要帳號），之後每筆花費記下誰付的、哪些人分攤，最後算出誰該還誰多少。</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={user?.name ? `例如：${user.name}` : '旅伴名字'} autoFocus />
            <button className="btn primary" type="submit" style={{ flex: '0 0 auto' }} disabled={!newName.trim()}>
              ＋ 加入
            </button>
          </form>
          {user?.name && !newName && (
            <button className="btn sm ghost" onClick={() => addPerson(user.name)}>
              先加入我（{user.name}）
            </button>
          )}
        </div>
      </div>
    )

  return (
    <div className="split">
      <div className="kpis">
        <div className="kpi">
          <div className="label">總支出</div>
          <div className="value">{money(total)}</div>
        </div>
        <div className="kpi">
          <div className="label">旅伴</div>
          <div className="value">{people.length} 人</div>
        </div>
        <div className="kpi">
          <div className="label">每人平均</div>
          <div className="value">{money(total / people.length)}</div>
        </div>
        <div className="kpi">
          <div className="label">待結清</div>
          <div className={`value ${settle.length ? 'over' : ''}`}>{settle.length ? money(settle.reduce((s, t) => s + t.amount, 0)) : '已結清 🎉'}</div>
        </div>
      </div>

      <div className="budget-cards">
        <div className="panel-card">
          <h3>⚖️ 收支</h3>
          <ul className="balance-list">
            {bals.map((b) => (
              <BalanceRow key={b.person.id} b={b} people={people} money={money} max={Math.max(1, ...bals.map((x) => Math.max(x.paid, x.share)))} />
            ))}
          </ul>
          <p className="bal-legend" aria-hidden="true">
            <i className="paid" /> 付了 <i className="share" /> 應付
          </p>
          <h4 className="split-sub">結清方式（最少轉帳）</h4>
          {settle.length === 0 ? (
            <p className="muted-note">大家都結清了，沒有人欠誰。</p>
          ) : (
            <ul className="settle-list">
              {settle.map((t, i) => (
                <li key={i}>
                  <span className="who">
                    <Avatar person={t.from} people={people} size="sm" />
                    <b>{t.from.name}</b>
                    <span className="arrow">→</span>
                    <Avatar person={t.to} people={people} size="sm" />
                    <b>{t.to.name}</b>
                  </span>
                  <span className="amt">{money(t.amount)}</span>
                  <button className="btn sm" onClick={() => markPaid(t.from, t.to, t.amount)} title="記一筆還款，收支就會歸零">
                    ✓ 已還
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => void copySummary()}>
              📋 複製分帳摘要
            </button>
          </div>
        </div>

        <div className="panel-card">
          <h3>👥 旅伴</h3>
          <ul className="people-list">
            {people.map((p) => (
              <li key={p.id}>
                <Avatar person={p} people={people} />
                <input className="person-name" value={p.name} onChange={(e) => renamePerson(p.id, e.target.value)} aria-label="旅伴名字" />
                <button className="btn sm ghost" onClick={() => remove(p)} title="移除旅伴" aria-label={`移除 ${p.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="再加一位旅伴" />
            <button className="btn" type="submit" style={{ flex: '0 0 auto' }} disabled={!newName.trim()}>
              ＋ 加入
            </button>
          </form>
        </div>
      </div>

      <div className="panel-card expenses-card">
        <div className="expenses-head">
          <h3>🧾 支出紀錄</h3>
          <div className="actions">
            <FromItinerary trip={trip} onPick={(e) => setEditing(e)} />
            <button className="btn primary" onClick={() => setEditing('new')}>
              ＋ 新增支出
            </button>
          </div>
        </div>
        {expenses.length === 0 ? (
          <p className="muted-note">還沒有支出。按「＋ 新增支出」，或從行程帶入一筆。</p>
        ) : (
          <div className="expense-days">
            {byDate.map((g) => (
              <section key={g.date} className="expense-day">
                <h4 className="expense-date">
                  <span>{dateHeading(trip, g.date)}</span>
                  {g.items.some((e) => e.kind === 'expense') && <small>{money(g.items.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0))}</small>}
                </h4>
                <ul className="expense-list">
                  {g.items.map((e) => {
                    const payer = byId.get(e.paidBy)
                    const parts = e.participants.map((id) => byId.get(id)?.name ?? '？')
                    return (
                      <li key={e.id} className={`expense ${e.kind}`} onClick={() => setEditing(e)} title="點一下編輯">
                        <span className="ex-ic" style={{ '--cat': CATEGORY_META[e.category].color } as React.CSSProperties}>
                          {e.kind === 'transfer' ? '↩︎' : CATEGORY_META[e.category].icon}
                        </span>
                        <span className="ex-main">
                          <b>{e.title || (e.kind === 'transfer' ? '還款' : '（未命名）')}</b>
                          <small>
                            <Avatar person={payer} people={people} size="sm" />
                            {e.kind === 'transfer'
                              ? `${payer?.name ?? '？'} 還給 ${parts[0] ?? '？'}`
                              : `${payer?.name ?? '？'} 付 · ${parts.length === people.length ? '全員' : parts.join('、')}分攤${e.shares ? '（自訂）' : ''}`}
                          </small>
                        </span>
                        <span className="ex-amt">{e.kind === 'transfer' ? '↩︎ ' : ''}{money(e.amount)}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {editing &&
        createPortal(
          <ExpenseDialog
            trip={trip}
            expense={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onDelete={(id) => {
              deleteExpense(id)
              setEditing(null)
            }}
          />,
          document.body,
        )}
    </div>
  )
}

function BalanceRow({ b, people, money, max }: { b: Balance; people: Person[]; money: (n: number) => string; max: number }) {
  const state = b.net > EPS ? 'plus' : b.net < -EPS ? 'minus' : 'zero'
  return (
    <li className={`balance ${state}`} style={{ '--pc': personColor(people, b.person.id) } as React.CSSProperties}>
      <Avatar person={b.person} people={people} />
      <div className="bal-body">
        <div className="bal-head">
          <b>{b.person.name}</b>
          <span className="bal-net">{state === 'plus' ? `應收 ${money(b.net)}` : state === 'minus' ? `應付 ${money(-b.net)}` : '✓ 結清'}</span>
        </div>
        <div className="bal-bars" aria-hidden="true">
          <span className="paid" style={{ width: `${(b.paid / max) * 100}%` }} />
          <span className="share" style={{ width: `${(b.share / max) * 100}%` }} />
        </div>
        <small>
          付了 {money(b.paid)} · 應付 {money(b.share)}
          {Math.abs(b.transferred) > EPS && ` · ${b.transferred > 0 ? '已還' : '已收'} ${money(Math.abs(b.transferred))}`}
        </small>
      </div>
    </li>
  )
}

/** "從行程帶入": pick an activity with a cost; the per-person cost times everyone becomes the amount. */
function FromItinerary({ trip, onPick }: { trip: Trip; onPick: (e: Expense) => void }) {
  const people = trip.people ?? []
  const options = useMemo(
    () =>
      trip.days.flatMap((_, i) =>
        dayActivities(trip, i)
          .filter((a) => a.cost > 0)
          .map((a) => ({ a, day: i })),
      ),
    [trip],
  )
  if (!options.length) return null
  return (
    <select
      className="from-itinerary"
      value=""
      onChange={(e) => {
        const o = options.find((x) => x.a.id === e.target.value)
        if (!o) return
        onPick({
          id: '',
          kind: 'expense',
          title: o.a.title,
          amount: Math.round(o.a.cost * people.length * 100) / 100,
          paidBy: people[0]?.id ?? '',
          participants: people.map((p) => p.id),
          date: isoDate(addDays(trip.startDate, o.day)),
          category: o.a.category,
          activityId: o.a.id,
          createdAt: 0,
        })
      }}
      title="用行程裡的活動建立一筆支出（每人費用 × 人數）"
    >
      <option value="">從行程帶入…</option>
      {options.map(({ a, day }) => (
        <option key={a.id} value={a.id}>
          第 {day + 1} 天 · {a.title} · {formatMoney(a.cost, trip.currency)}/人
        </option>
      ))}
    </select>
  )
}

/** Add / edit one expense or repayment. */
function ExpenseDialog({ trip, expense, onClose, onDelete }: { trip: Trip; expense: Expense | null; onClose: () => void; onDelete: (id: string) => void }) {
  const { addExpense, updateExpense } = useStore()
  const people = trip.people ?? []
  const isNew = !expense?.id
  const [kind, setKind] = useState<Expense['kind']>(expense?.kind ?? 'expense')
  const [title, setTitle] = useState(expense?.title ?? '')
  const [amount, setAmount] = useState(expense?.amount ? String(expense.amount) : '')
  const [paidBy, setPaidBy] = useState(expense?.paidBy || people[0]?.id || '')
  const [participants, setParticipants] = useState<string[]>(expense?.participants?.length ? expense.participants : kind === 'transfer' ? [] : people.map((p) => p.id))
  const [custom, setCustom] = useState<Record<string, string> | null>(expense?.shares ? Object.fromEntries(Object.entries(expense.shares).map(([k, v]) => [k, String(v)])) : null)
  const [date, setDate] = useState(expense?.date || isoDate(new Date()))
  const [category, setCategory] = useState<Category>(expense?.category ?? 'food')
  const [note, setNote] = useState(expense?.note ?? '')
  useEscape(onClose)

  const amt = Number(amount) || 0
  const customSum = custom ? participants.reduce((s, id) => s + (Number(custom[id]) || 0), 0) : 0
  const remainder = Math.round((amt - customSum) * 100) / 100
  const preview = useMemo(
    () => shareOf({ id: '', kind: 'expense', title: '', amount: amt, paidBy, participants, shares: custom ? Object.fromEntries(participants.map((id) => [id, Number(custom[id]) || 0])) : undefined, date, category, createdAt: 0 }),
    [amt, paidBy, participants, custom, date, category],
  )
  const valid = amt > 0 && paidBy && participants.length > 0 && (kind === 'expense' ? !custom || Math.abs(remainder) < 0.005 : participants.length === 1)

  const toggle = (id: string) =>
    setParticipants((ps) => (kind === 'transfer' ? [id] : ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]))

  const save = () => {
    if (!valid) return
    const data: Omit<Expense, 'id' | 'createdAt'> = {
      kind,
      title: title.trim() || (kind === 'transfer' ? '還款' : '支出'),
      amount: Math.round(amt * 100) / 100,
      paidBy,
      participants: kind === 'transfer' ? participants.slice(0, 1) : participants,
      ...(kind === 'expense' && custom ? { shares: Object.fromEntries(participants.map((id) => [id, Math.round((Number(custom[id]) || 0) * 100) / 100])) } : {}),
      date,
      category: kind === 'transfer' ? 'other' : category,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(expense?.activityId ? { activityId: expense.activityId } : {}),
    }
    if (isNew) addExpense(data)
    else updateExpense(expense!.id, { ...data, ...(custom ? {} : { shares: undefined }) })
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog expense-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? '🧾 新增' : '🧾 編輯'}{kind === 'transfer' ? '還款' : '支出'}</h3>
        {isNew && (
          <div className="segmented" role="tablist" style={{ marginBottom: 12 }}>
            <button className={kind === 'expense' ? 'active' : ''} onClick={() => setKind('expense')}>
              共同花費
            </button>
            <button
              className={kind === 'transfer' ? 'active' : ''}
              onClick={() => {
                setKind('transfer')
                setParticipants((ps) => ps.filter((id) => id !== paidBy).slice(0, 1))
                setCustom(null)
              }}
            >
              還款
            </button>
          </div>
        )}
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>{kind === 'transfer' ? '說明' : '名稱'}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'transfer' ? '例如：還上次的晚餐' : '例如：第一天晚餐'} autoFocus />
          </div>
          <div className="field">
            <label>金額（{trip.currency}）</label>
            <input type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>{kind === 'transfer' ? '誰還錢' : '誰付的'}</label>
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>日期</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>{kind === 'transfer' ? '還給誰' : '誰分攤'}</label>
          <div className="people-pick">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className={participants.includes(p.id) ? 'on' : ''}
                style={{ '--pc': personColor(people, p.id) } as React.CSSProperties}
                onClick={() => toggle(p.id)}
                disabled={kind === 'transfer' && p.id === paidBy}
              >
                <Avatar person={p} people={people} size="sm" />
                {p.name}
                {kind === 'expense' && participants.includes(p.id) && amt > 0 && <small>{formatMoney(preview[p.id] ?? 0, trip.currency)}</small>}
              </button>
            ))}
            {kind === 'expense' && (
              <button type="button" className="ghost" onClick={() => setParticipants(participants.length === people.length ? [] : people.map((p) => p.id))}>
                {participants.length === people.length ? '全部取消' : '全選'}
              </button>
            )}
          </div>
        </div>
        {kind === 'expense' && (
          <div className="field">
            <label>分法</label>
            <div className="segmented">
              <button className={!custom ? 'active' : ''} onClick={() => setCustom(null)}>
                平均分
              </button>
              <button className={custom ? 'active' : ''} onClick={() => setCustom((c) => c ?? Object.fromEntries(participants.map((id) => [id, ''])))}>
                自訂金額
              </button>
            </div>
            {custom && (
              <div className="custom-shares">
                {participants.map((id) => (
                  <label key={id}>
                    <Avatar person={people.find((p) => p.id === id)} people={people} size="sm" />
                    <span>{people.find((p) => p.id === id)?.name}</span>
                    <input type="number" inputMode="decimal" min={0} step="any" value={custom[id] ?? ''} onChange={(e) => setCustom({ ...custom, [id]: e.target.value })} placeholder="0" />
                  </label>
                ))}
                <p className={`share-tip ${Math.abs(remainder) >= 0.005 ? 'warn' : ''}`}>
                  {Math.abs(remainder) < 0.005 ? '✓ 金額剛好分完' : remainder > 0 ? `還差 ${formatMoney(remainder, trip.currency)} 沒分到` : `多分了 ${formatMoney(-remainder, trip.currency)}`}
                </p>
              </div>
            )}
          </div>
        )}
        {kind === 'expense' && (
          <div className="field">
            <label>類別</label>
            <div className="cat-grid">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className={category === c ? 'active' : ''} style={{ '--cat': CATEGORY_META[c].color } as React.CSSProperties} onClick={() => setCategory(c)}>
                  {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>備註</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填" />
        </div>
        <div className="actions">
          {!isNew && (
            <button className="btn danger" onClick={() => confirm('刪除這筆紀錄？') && onDelete(expense!.id)} style={{ marginRight: 'auto' }}>
              🗑 刪除
            </button>
          )}
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={!valid}>
            {isNew ? '新增' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
