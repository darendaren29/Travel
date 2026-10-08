import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCurrentTrip } from '../store'
import { aiErrorDetails, dayRequest, describeAiError, diffDay, reviseDay } from '../ai'
import { DAY_QUICK_ASKS } from '../aiPrompt'
import { signIn } from '../auth'
import { CATEGORY_META, type Activity } from '../types'
import { addDays, dayActivities, dayColor, formatDate, formatMoney } from '../utils'

interface Round {
  instruction: string
  summary?: string
  error?: { message: string; details: string[] }
}

/**
 * "AI 協作" for one day: the user asks for changes in plain words, the AI proposes a revised day,
 * the user can keep refining the proposal, and nothing changes until "套用".
 */
export default function DayAiDialog({ dayIndex, onClose }: { dayIndex: number; onClose: () => void }) {
  const trip = useCurrentTrip()
  const user = useStore((s) => s.user)
  const replaceDayActivities = useStore((s) => s.replaceDayActivities)
  const current = useMemo(() => dayActivities(trip, dayIndex), [trip, dayIndex])
  const [proposal, setProposal] = useState<Activity[] | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const date = addDays(trip.startDate, dayIndex)
  const shown = proposal ?? current
  const diff = useMemo(() => (proposal ? diffDay(current, proposal) : null), [current, proposal])
  const total = shown.reduce((n, a) => n + a.cost, 0)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [rounds, busy])

  const send = async (text: string) => {
    const instruction = text.trim()
    if (!instruction || busy) return
    setInput('')
    setBusy(true)
    const history = rounds.filter((r) => r.summary).map((r) => r.instruction)
    setRounds((rs) => [...rs, { instruction }])
    try {
      // Refine the pending proposal if there is one, otherwise the live day.
      const base = proposal ?? current
      const res = await reviseDay(dayRequest(trip, dayIndex, base, instruction, history), base)
      setProposal(res.activities)
      setRounds((rs) => rs.map((r, i) => (i === rs.length - 1 ? { ...r, summary: res.summary || '已更新提案。' } : r)))
    } catch (e) {
      setRounds((rs) => rs.map((r, i) => (i === rs.length - 1 ? { ...r, error: { message: describeAiError(e), details: aiErrorDetails(e) } } : r)))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    if (proposal && !confirm('提案還沒有套用，確定關閉？')) return
    onClose()
  }

  const apply = () => {
    if (!proposal) return
    replaceDayActivities(dayIndex, proposal, `第 ${dayIndex + 1} 天`)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog day-ai" style={{ '--day': dayColor(dayIndex) } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        <header className="day-ai-head">
          <span className="day-ai-stamp" aria-hidden="true">
            <small>DAY</small>
            {String(dayIndex + 1).padStart(2, '0')}
          </span>
          <div className="day-ai-title">
            <h3>AI 協作</h3>
            <span>
              第 {dayIndex + 1} 天 · {formatDate(date)}
            </span>
          </div>
          <span className="day-ai-by">by Claude</span>
        </header>

        {!user ? (
          <div className="day-ai-signin">
            <p>AI 協作需要先登入。</p>
            <button className="btn primary" onClick={() => void signIn()}>
              Google 登入
            </button>
          </div>
        ) : (
          <div className="day-ai-body">
            <section className="day-ai-plan" aria-label={proposal ? 'AI 提案' : '目前行程'}>
              <div className="plan-head">
                <b>{proposal ? 'AI 提案' : '目前行程'}</b>
                <span>
                  {shown.length} 項 · {formatMoney(total, trip.currency)}
                </span>
                {proposal && (
                  <button className="btn sm ghost" onClick={() => setProposal(null)} disabled={busy} title="回到目前行程">
                    捨棄提案
                  </button>
                )}
              </div>
              <ol className="plan-list">
                {shown.length === 0 && <li className="plan-empty">這天還沒有活動 — 請 AI 幫你排吧</li>}
                {shown.map((a) => {
                  const ch = diff?.changes.get(a.id)
                  return (
                    <li key={a.id} className={`plan-item ${ch?.kind ?? ''}`} style={{ '--cat': CATEGORY_META[a.category].color } as React.CSSProperties}>
                      <span className="plan-time">
                        {a.start}
                        <br />
                        {a.end}
                      </span>
                      <span className="plan-main">
                        <span className="plan-title">
                          {CATEGORY_META[a.category].icon} {a.title}
                        </span>
                        {a.location && <span className="plan-loc">📍 {a.location}</span>}
                        {ch?.kind === 'changed' && <span className="plan-what">{ch.what.join(' · ')}</span>}
                      </span>
                      {ch?.kind === 'added' && <span className="plan-badge add">新增</span>}
                      {ch?.kind === 'changed' && <span className="plan-badge chg">修改</span>}
                    </li>
                  )
                })}
              </ol>
              {diff && diff.removed.length > 0 && (
                <div className="plan-removed">
                  <span className="plan-badge del">刪除</span>
                  {diff.removed.map((a) => (
                    <s key={a.id}>
                      {a.start} {a.title}
                    </s>
                  ))}
                </div>
              )}
            </section>

            <section className="day-ai-chat" aria-label="與 AI 討論">
              <div className="chat-log" ref={logRef}>
                {rounds.length === 0 && (
                  <div className="chat-intro">
                    告訴我想怎麼調整這一天，例如「下午改成室內行程」「晚餐想吃海鮮」「10 點才出門」。我會先給提案，你確認後再套用。
                  </div>
                )}
                {rounds.map((r, i) => (
                  <div key={i} className="chat-round">
                    <div className="msg user">{r.instruction}</div>
                    {r.summary && <div className="msg ai">{r.summary}</div>}
                    {r.error && (
                      <div className="msg ai error">
                        ⚠ {r.error.message}
                        {r.error.details.length > 0 && (
                          <details>
                            <summary>技術細節</summary>
                            <ul>
                              {r.error.details.map((d, j) => (
                                <li key={j}>{d}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="msg ai typing">
                    <span className="spinner" /> Claude 規劃中…
                  </div>
                )}
              </div>

              <div className="quick-asks">
                {DAY_QUICK_ASKS.map((q) => (
                  <button key={q} className="quick-ask" onClick={() => void send(q)} disabled={busy}>
                    {q}
                  </button>
                ))}
              </div>

              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  void send(input)
                }}
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void send(input)
                    }
                  }}
                  placeholder={proposal ? '繼續調整提案…（Ctrl+Enter 送出）' : '想怎麼調整這一天？（Ctrl+Enter 送出）'}
                  rows={2}
                  maxLength={1000}
                  disabled={busy}
                  autoFocus
                />
                <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
                  送出
                </button>
              </form>
            </section>
          </div>
        )}

        <footer className="actions">
          <button className="btn" onClick={close} disabled={busy}>
            關閉
          </button>
          <button className="btn primary" onClick={apply} disabled={!proposal || busy}>
            ✓ 套用到第 {dayIndex + 1} 天
          </button>
        </footer>
      </div>
    </div>
  )
}
