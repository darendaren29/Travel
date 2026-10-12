import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCurrentTrip } from '../store'
import { aiErrorDetails, describeAiError, diffDay, reviseSpares, spareRequest } from '../ai'
import { SPARE_QUICK_ASKS } from '../aiPrompt'
import { signIn } from '../auth'
import { CATEGORY_META, type Activity, type SpareGroup } from '../types'
import { formatMoney, spareGroupActivities } from '../utils'
import { useEscape } from '../useEscape'

interface Round {
  instruction: string
  summary?: string
  error?: { message: string; details: string[] }
}

const SPARE_COLOR = '#8a8276'

/**
 * "AI 協作" for one 備用景點 block: ask Claude for candidates that fit the block (its name is the
 * region / country / dates), or to tidy the ones already there. Nothing changes until "套用".
 */
export default function SpareAiDialog({ group, onClose }: { group: SpareGroup; onClose: () => void }) {
  const trip = useCurrentTrip()
  const user = useStore((s) => s.user)
  const replaceSpareGroup = useStore((s) => s.replaceSpareGroup)
  const current = useMemo(() => spareGroupActivities(trip, group), [trip, group])
  const [proposal, setProposal] = useState<Activity[] | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

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
      const base = proposal ?? current
      const res = await reviseSpares(spareRequest(trip, group, base, instruction, history), base)
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
  useEscape(close, !busy)

  const apply = () => {
    if (!proposal) return
    replaceSpareGroup(group.id, proposal, `備用區塊「${group.name}」`)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog day-ai spare-ai" style={{ '--day': SPARE_COLOR } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        <header className="day-ai-head">
          <span className="day-ai-stamp" aria-hidden="true">
            <small>SPARE</small>📌
          </span>
          <div className="day-ai-title">
            <h3>AI 協作</h3>
            <span>備用區塊「{group.name}」 · 不排時間</span>
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
            <section className="day-ai-plan" aria-label={proposal ? 'AI 提案' : '目前備用景點'}>
              <div className="plan-head">
                <b>{proposal ? 'AI 提案' : '目前備用景點'}</b>
                <span>
                  {shown.length} 個 · {formatMoney(total, trip.currency)}
                </span>
                {proposal && (
                  <button className="btn sm ghost" onClick={() => setProposal(null)} disabled={busy} title="回到目前清單">
                    捨棄提案
                  </button>
                )}
              </div>
              <ol className="plan-list">
                {shown.length === 0 && <li className="plan-empty">這個區塊還是空的 — 請 AI 推薦幾個吧</li>}
                {shown.map((a) => {
                  const ch = diff?.changes.get(a.id)
                  return (
                    <li key={a.id} className={`plan-item ${ch?.kind ?? ''}`} style={{ '--cat': CATEGORY_META[a.category].color } as React.CSSProperties}>
                      <span className="plan-time plan-pin" aria-hidden="true">
                        📌
                      </span>
                      <span className="plan-main">
                        <span className="plan-title">
                          {CATEGORY_META[a.category].icon} {a.title}
                        </span>
                        {a.location && <span className="plan-loc">📍 {a.location}</span>}
                        {a.notes && <span className="plan-loc">{a.notes}</span>}
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
                    <s key={a.id}>{a.title}</s>
                  ))}
                </div>
              )}
            </section>

            <section className="day-ai-chat" aria-label="與 AI 討論">
              <div className="chat-log" ref={logRef}>
                {rounds.length === 0 && (
                  <div className="chat-intro">
                    這個區塊的名稱「{group.name}」就是範圍。告訴我想要什麼，例如「推薦 5 個雨天備案」「這一區有什麼在地小吃」「把清單整理一下並補上停留時間」。我會先給提案，你確認後再套用；已經排進行程的地點不會重複推薦。
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
                    <span className="spinner" /> Claude 整理中…
                  </div>
                )}
              </div>

              <div className="quick-asks">
                {SPARE_QUICK_ASKS.map((q) => (
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
                  placeholder={proposal ? '繼續調整提案…（Ctrl+Enter 送出）' : '想在這個區塊放什麼？（Ctrl+Enter 送出）'}
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
            ✓ 套用到「{group.name}」
          </button>
        </footer>
      </div>
    </div>
  )
}
