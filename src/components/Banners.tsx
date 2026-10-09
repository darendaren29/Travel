import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { signIn } from '../auth'
import { inviteUrl, isInAppBrowser } from '../share'

/** Shown after opening an invite link while signed out: explains what to do, or how to leave an in-app browser. */
export function JoinBanner() {
  const pendingJoin = useStore((s) => s.pendingJoin)
  const user = useStore((s) => s.user)
  const [copied, setCopied] = useState(false)
  if (!pendingJoin || user) return null
  const inApp = isInAppBrowser()
  const copy = async () => {
    const url = inviteUrl(pendingJoin)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      prompt('請複製這個連結，貼到 Safari 或 Chrome 開啟：', url)
    }
  }
  return (
    <div className="join-banner" role="status">
      <span className="join-ic" aria-hidden="true">
        ✉️
      </span>
      {inApp ? (
        <>
          <span className="join-text">
            <b>你收到一個共編邀請</b>
            <small>這個 App 的內建瀏覽器無法使用 Google 登入。請點右上角「⋯」→「用瀏覽器開啟」，或複製連結到 Safari／Chrome。</small>
          </span>
          <button className="btn sm primary" onClick={() => void copy()}>
            {copied ? '✓ 已複製' : '複製連結'}
          </button>
        </>
      ) : (
        <>
          <span className="join-text">
            <b>你收到一個共編邀請</b>
            <small>用 Google 登入後就會加入這個行程，雙方修改即時同步。</small>
          </span>
          <button className="btn sm primary" onClick={() => void signIn()}>
            Google 登入加入
          </button>
        </>
      )}
    </div>
  )
}

/** Bottom toast for short messages (e.g. a share link was opened). */
export function NoticeBar() {
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  useEffect(() => {
    if (!notice || notice.endsWith('…')) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice, setNotice])
  if (!notice) return null
  return (
    <div className="undo-bar notice-bar" role="status">
      <span>{notice}</span>
      <button className="btn sm ghost" onClick={() => setNotice(null)} aria-label="關閉">
        ✕
      </button>
    </div>
  )
}

/**
 * Full-page welcome for someone who opened an invite link while signed out. Without it they would see
 * the local sample trip and think the shared itinerary was wrong.
 */
export function InviteGate({ onSkip }: { onSkip: () => void }) {
  const pendingJoin = useStore((s) => s.pendingJoin)
  const [copied, setCopied] = useState(false)
  if (!pendingJoin) return null
  const inApp = isInAppBrowser()
  const copy = async () => {
    const url = inviteUrl(pendingJoin)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      prompt('請複製這個連結，貼到 Safari 或 Chrome 開啟：', url)
    }
  }
  return (
    <div className="invite-gate">
      <div className="invite-card">
        <span className="invite-stamp" aria-hidden="true">
          ✉️
        </span>
        <h2>你收到一個共編邀請</h2>
        <p>朋友邀請你一起編輯他的旅程。用 Google 登入後，就會自動打開那份行程，雙方的修改會即時同步。</p>
        {inApp ? (
          <>
            <p className="invite-warn">這個 App 的內建瀏覽器無法使用 Google 登入。請點右上角「⋯」→「用瀏覽器開啟」，或複製連結到 Safari／Chrome。</p>
            <button className="btn primary" onClick={() => void copy()}>
              {copied ? '✓ 已複製連結' : '複製連結'}
            </button>
          </>
        ) : (
          <button className="btn primary invite-cta" onClick={() => void signIn()}>
            Google 登入並加入
          </button>
        )}
        <button className="invite-skip" onClick={onSkip}>
          先不要，看我自己的行程
        </button>
      </div>
    </div>
  )
}
