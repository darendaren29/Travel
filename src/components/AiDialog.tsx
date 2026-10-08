import { useMemo, useState } from 'react'
import { useStore, useCurrentTrip } from '../store'
import { aiErrorDetails, describeAiError, generateItinerary, type ItineraryRequest } from '../ai'
import { signIn } from '../auth'
import { AI_MAX_DAYS } from '../config'
import { PACES } from '../aiPrompt'
import { datesInText, spanMismatch } from '../dateHints'

const md = (isoDate: string) => {
  const [, m, d] = isoDate.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function AiDialog({ onClose }: { onClose: () => void }) {
  const trip = useCurrentTrip()
  const { user, importTrip, replaceCurrentTrip } = useStore()
  const [form, setForm] = useState<ItineraryRequest>({
    destination: trip.destination,
    days: trip.days.length,
    startDate: trip.startDate,
    currency: trip.currency,
    budget: trip.budget,
    travelers: '2 位成人',
    pace: '適中',
    preferences: '',
  })
  const [target, setTarget] = useState<'new' | 'replace'>('new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])

  const set = <K extends keyof ItineraryRequest>(k: K, v: ItineraryRequest[K]) => setForm((f) => ({ ...f, [k]: v }))
  const hasActivities = Object.keys(trip.activities).length > 0

  // Flights / dates typed into the preferences that disagree with the start date or length.
  const span = useMemo(() => datesInText(form.preferences, form.startDate), [form.preferences, form.startDate])
  const suggestDays = span ? Math.min(AI_MAX_DAYS, span.days) : 0
  const showSpanHint = spanMismatch(span, form.startDate, form.days)
  const applySpan = () => span && setForm((f) => ({ ...f, startDate: span.first, days: suggestDays }))

  const run = async () => {
    if (!form.destination.trim()) {
      setError('請輸入目的地')
      return
    }
    if (target === 'replace' && hasActivities && !confirm(`會清掉「${trip.name}」現有的 ${Object.keys(trip.activities).length} 個活動，確定？`)) return
    setBusy(true)
    setError(null)
    setDetails([])
    try {
      const generated = await generateItinerary({ ...form, days: Math.min(AI_MAX_DAYS, Math.max(1, form.days)) })
      if (target === 'new') importTrip(generated)
      else replaceCurrentTrip(generated)
      onClose()
    } catch (e) {
      setError(describeAiError(e))
      setDetails(aiErrorDetails(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog ai-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>✨ 用 Claude 產生行程</h3>

        {!user ? (
          <>
            <p style={{ color: 'var(--muted)' }}>AI 功能需要先登入，產生的行程會直接存到你的雲端帳號。</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                關閉
              </button>
              <button className="btn primary" onClick={() => void signIn()}>
                Google 登入
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <div className="field" style={{ flex: 2 }}>
                <label>目的地</label>
                <input value={form.destination} onChange={(e) => set('destination', e.target.value)} placeholder="例：日本・大阪、京都" autoFocus disabled={busy} />
              </div>
              <div className="field">
                <label>天數</label>
                <input
                  type="number"
                  min={1}
                  max={AI_MAX_DAYS}
                  value={form.days}
                  onChange={(e) => set('days', Math.min(AI_MAX_DAYS, Number(e.target.value) || 1))}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>出發日</label>
                <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} disabled={busy} />
              </div>
              <div className="field">
                <label>旅客</label>
                <input value={form.travelers} onChange={(e) => set('travelers', e.target.value)} placeholder="2 位成人、1 位小孩" disabled={busy} />
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>幣別</label>
                <input value={form.currency} maxLength={4} onChange={(e) => set('currency', e.target.value.toUpperCase())} disabled={busy} />
              </div>
              <div className="field">
                <label>每人預算（0 = 不限）</label>
                <input type="number" min={0} value={form.budget || ''} placeholder="0" onChange={(e) => set('budget', Number(e.target.value) || 0)} disabled={busy} />
              </div>
              <div className="field">
                <label>步調</label>
                <select value={form.pace} onChange={(e) => set('pace', e.target.value as ItineraryRequest['pace'])} disabled={busy}>
                  {PACES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>偏好與需求</label>
              <textarea
                value={form.preferences}
                onChange={(e) => set('preferences', e.target.value)}
                placeholder="例：喜歡美食和動漫，想去秋葉原；不吃生食；第一天 14:00 抵達關西機場；住在難波附近"
                disabled={busy}
              />
            </div>

            {showSpanHint && span && (
              <div className="ai-hint-box">
                <span>
                  需求中提到 <b>{md(span.first)}</b>
                  {span.days > 1 && (
                    <>
                      {' '}– <b>{md(span.last)}</b>（{span.days} 天）
                    </>
                  )}
                  ，目前設定是 {md(form.startDate)} 起 {form.days} 天。
                  {span.days > AI_MAX_DAYS && ` 一次最多產生 ${AI_MAX_DAYS} 天。`}
                </span>
                <button className="btn sm" onClick={applySpan} disabled={busy}>
                  改為 {md(span.first)} 起 {suggestDays} 天
                </button>
              </div>
            )}

            <div className="field">
              <label>產生到</label>
              <div className="row">
                <label className="toggle">
                  <input type="radio" name="target" checked={target === 'new'} onChange={() => setTarget('new')} disabled={busy} />
                  新的旅程
                </label>
                <label className="toggle">
                  <input type="radio" name="target" checked={target === 'replace'} onChange={() => setTarget('replace')} disabled={busy} />
                  覆蓋目前旅程「{trip.name}」
                </label>
              </div>
            </div>

            {error && (
              <div className="ai-error">
                ⚠ {error}
                {details.length > 0 && (
                  <details>
                    <summary>技術細節</summary>
                    <ul>
                      {details.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <div className="actions">
              <button className="btn" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button className="btn primary" onClick={() => void run()} disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner" /> Claude 規劃中…（約 30 秒–2 分鐘）
                  </>
                ) : (
                  '✨ 產生行程'
                )}
              </button>
            </div>
            <p className="ai-hint">產生後請檢查地點座標與費用，AI 可能有誤；所有內容都可再手動調整。</p>
          </>
        )}
      </div>
    </div>
  )
}
