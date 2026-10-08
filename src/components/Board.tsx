import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
  type PointerSensorProps,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORY_META, TRAVEL_MODES, type Activity, type Trip } from '../types'
import {
  addDays,
  dayActivities,
  dayColor,
  dayCost,
  distanceKm,
  duration,
  findConflicts,
  formatDate,
  formatDuration,
  formatMoney,
  toMinutes,
} from '../utils'
import { canNavigate, dayRouteUrl, navLinks, openUrl } from '../nav'
import { dayLegs, formatDistance, hasGeo, legBetween, optimizeOrder, travelMinutes, tripMode, type DayLeg } from '../routes'
import { photoUrl, useGooglePlaces } from '../places'

const STRIP_START = 6 * 60 // 06:00
const STRIP_END = 24 * 60 // 24:00
const dayId = (i: number) => `day-${i}`
const chipId = (i: number) => `chip-${i}`
const isChip = (id: unknown) => String(id).startsWith('chip-')

/**
 * Touch: a long press anywhere on a card starts a drag (so a normal swipe still scrolls),
 * but pressing the card's grip strip starts it right away.
 */
class GripAwareTouchSensor extends TouchSensor {
  constructor(props: PointerSensorProps) {
    const onGrip = (props.event.target as Element | null)?.closest?.('[data-drag-handle]')
    super(onGrip ? { ...props, options: { ...props.options, activationConstraint: { distance: 4 } } } : props)
  }
}

/** Day chips win while the pointer is on one; otherwise the usual closest-corners sorting. */
const collision: CollisionDetection = (args) => {
  const chips = args.droppableContainers.filter((c) => isChip(c.id))
  const onChip = pointerWithin({ ...args, droppableContainers: chips })
  if (onChip.length) return onChip
  return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isChip(c.id)) })
}

/** Scroll the board so day `i` is the first column. */
const scrollToDay = (board: HTMLElement | null, i: number) => {
  const col = board?.querySelectorAll<HTMLElement>('.day-col')[i]
  if (board && col) board.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(board).paddingLeft), behavior: 'smooth' })
}

export default function Board() {
  const trip = useCurrentTrip()
  const { moveActivity, addDay } = useStore()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch devices so a normal swipe still scrolls the list.
    useSensor(GripAwareTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const locate = (id: string): { day: number; index: number } | null => {
    if (id.startsWith('day-')) return { day: Number(id.slice(4)), index: -1 }
    if (isChip(id)) return { day: Number(id.slice(5)), index: -1 }
    for (let d = 0; d < trip.days.length; d++) {
      const idx = trip.days[d].activityIds.indexOf(id)
      if (idx >= 0) return { day: d, index: idx }
    }
    return null
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragOver = (e: DragOverEvent) => {
    const over = e.over ? locate(String(e.over.id)) : null
    setOverDay(over ? over.day : null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setOverDay(null)
    if (!e.over) return
    const id = String(e.active.id)
    const from = locate(id)
    const to = locate(String(e.over.id))
    if (!from || !to) return

    let index = to.index
    if (index < 0) index = trip.days[to.day].activityIds.length // dropped on empty column area
    else if (from.day === to.day && from.index < to.index) index = to.index // moving down: after removal, slot shifts
    else if (from.day !== to.day) index = to.index

    if (from.day === to.day && from.index === index) return
    moveActivity(id, to.day, index)
    // Dropped on a day chip: bring that day into view so the move is visible.
    if (isChip(e.over.id)) setTimeout(() => scrollToDay(boardRef.current, to.day), 50)
  }

  const active = activeId ? trip.activities[activeId] : null
  const boardRef = useRef<HTMLDivElement>(null)
  useWheelToHorizontal(boardRef)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      // The wide drag preview would keep the chip row scrolling; only the board and day lists auto-scroll.
      autoScroll={{ canScroll: (el) => !el.classList.contains('day-chips') }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setOverDay(null)
      }}
    >
      <div className="board-wrap">
        <DayNav trip={trip} boardRef={boardRef} dragging={!!activeId} />
        <div className="board" ref={boardRef}>
          {trip.days.map((_, i) => (
            <DayColumn key={trip.days[i].id} trip={trip} index={i} isOver={overDay === i} />
          ))}
          <button className="add-day" onClick={addDay}>
            ＋ 新增一天
          </button>
        </div>
      </div>
      <DragOverlay>{active ? <CardView activity={active} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

/**
 * Mouse wheel over the board (outside a day's card list) scrolls sideways through the days,
 * so a plain mouse can reach later days without a horizontal scroll gesture.
 */
function useWheelToHorizontal(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      if ((e.target as Element).closest('.day-list')) return // cards scroll vertically as usual
      if (el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}

/** Day chips + prev/next above the board: shows which days are on screen, jumps to any day, and accepts dropped cards. */
function DayNav({ trip, boardRef, dragging }: { trip: Trip; boardRef: React.RefObject<HTMLDivElement | null>; dragging: boolean }) {
  const [visible, setVisible] = useState<Set<number>>(new Set([0]))
  const chipsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const cols = Array.from(board.querySelectorAll<HTMLElement>('.day-col'))
    const shown = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const i = cols.indexOf(en.target as HTMLElement)
          if (en.intersectionRatio >= 0.6) shown.add(i)
          else shown.delete(i)
        }
        setVisible(new Set(shown))
      },
      { root: board, threshold: [0, 0.6, 1] },
    )
    cols.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [boardRef, trip.days.length])

  // Keep the first visible day's chip in view when the chip row itself overflows.
  const first = visible.size ? Math.min(...visible) : 0
  useEffect(() => {
    const chip = chipsRef.current?.children[first] as HTMLElement | undefined
    const row = chipsRef.current
    if (chip && row && (chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth))
      row.scrollTo({ left: chip.offsetLeft - 8, behavior: 'smooth' })
  }, [first])

  const goTo = (i: number) => scrollToDay(boardRef.current, i)
  const last = visible.size ? Math.max(...visible) : 0
  const n = trip.days.length
  // Arrows page by however many days fit on screen (one on phones).
  const step = Math.max(1, visible.size)
  if (n <= 1) return null

  return (
    <nav className={`day-nav ${dragging ? 'dragging' : ''}`} aria-label="切換天數">
      <button className="btn sm ghost" onClick={() => goTo(Math.max(0, first - step))} disabled={first <= 0} aria-label="前一天">
        ◀
      </button>
      <div className="day-chips" ref={chipsRef}>
        {trip.days.map((d, i) => (
          <DayChip key={d.id} trip={trip} index={i} on={visible.has(i)} current={i === first} onClick={() => goTo(i)} />
        ))}
      </div>
      <span className="drop-hint" aria-hidden={!dragging}>
        放到日期 → 移到該天
      </span>
      <button className="btn sm ghost" onClick={() => goTo(Math.min(n - 1, first + step))} disabled={last >= n - 1} aria-label="後一天">
        ▶
      </button>
    </nav>
  )
}

function DayChip({ trip, index: i, on, current, onClick }: { trip: Trip; index: number; on: boolean; current: boolean; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: chipId(i) })
  const date = addDays(trip.startDate, i)
  return (
    <button
      ref={setNodeRef}
      className={`day-chip ${on ? 'on' : ''} ${isOver ? 'drop' : ''}`}
      style={{ '--day': dayColor(i) } as React.CSSProperties}
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      title={`第 ${i + 1} 天 · ${formatDate(date)}（可把活動拖到這裡）`}
    >
      <b>{String(i + 1).padStart(2, '0')}</b>
      <span>
        {date.getMonth() + 1}/{date.getDate()}
      </span>
    </button>
  )
}

/** Travel minutes needed before each activity (index-aligned; 0 when unknown). */
const travelBefore = (trip: Trip, activities: Activity[]): number[] =>
  activities.map((a, i) => {
    if (i === 0) return 0
    const leg = legBetween(trip, activities[i - 1], a)
    return leg ? travelMinutes(leg) : 0
  })

function DayColumn({ trip, index, isOver }: { trip: Trip; index: number; isOver: boolean }) {
  const { addActivity, removeDay, retimeDay, reorderDay } = useStore()
  const activities = dayActivities(trip, index)
  const conflicts = findConflicts(activities)
  const color = dayColor(index)
  const { setNodeRef } = useDroppable({ id: dayId(index) })
  const cost = dayCost(trip, index)
  const routeUrl = dayRouteUrl(trip, activities)
  const routesEnabled = useGooglePlaces(trip.destination)
  const legs = dayLegs(trip, activities)
  const travel = travelBefore(trip, activities)
  const [optimizing, setOptimizing] = useState(false)
  const pendingRetime = useRef(false)

  // Some gap is shorter than the travel it needs → offer to push things later.
  const needsRetime = activities.some((a, i) => i > 0 && travel[i] > 0 && toMinutes(a.start) - toMinutes(activities[i - 1].end) < travel[i])
  const allLegsReady = legs.length > 0 && legs.every((l) => l.leg)
  const canOptimize = routesEnabled && activities.length >= 3 && activities.every(hasGeo)

  // After "best order", legs for the new pairs arrive asynchronously; re-time once they are in.
  useEffect(() => {
    if (pendingRetime.current && allLegsReady) {
      pendingRetime.current = false
      retimeDay(index, travel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLegsReady, trip.legs])

  const onRemove = () => {
    if (trip.days.length <= 1) return
    if (activities.length && !confirm(`第 ${index + 1} 天有 ${activities.length} 個活動，確定刪除？`)) return
    removeDay(index)
  }

  const onOptimize = async () => {
    if (!confirm(`依移動時間重排第 ${index + 1} 天的順序？第一站與最後一站固定，其餘重新排列並重新安排時間。`)) return
    setOptimizing(true)
    try {
      const order = await optimizeOrder(trip, activities.filter(hasGeo))
      reorderDay(index, order)
      pendingRetime.current = true
    } catch (e) {
      alert(`無法最佳化：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <section className={`day-col ${isOver ? 'over' : ''}`} style={{ '--day': color, '--i': index } as React.CSSProperties}>
      <header className="day-head">
        <div className="title">
          <span className="day-badge" aria-hidden="true">
            <small>DAY</small>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="day-name">第 {index + 1} 天</span>
          <span className="day-tools">
            {routeUrl && (
              <button className="btn sm ghost" onClick={() => openUrl(routeUrl)} title="在 Google 地圖開啟當日路線">
                🧭
              </button>
            )}
            {canOptimize && (
              <button className="btn sm ghost" onClick={() => void onOptimize()} disabled={optimizing} title="依移動時間自動排出最佳順序">
                {optimizing ? '…' : '🔀'}
              </button>
            )}
            {needsRetime && (
              <button className="btn sm ghost warn" onClick={() => retimeDay(index, travel)} title="有活動趕不上：依交通時間把後面的活動往後推">
                ⏩
              </button>
            )}
            <button className="btn sm ghost remove" onClick={onRemove} disabled={trip.days.length <= 1} title="刪除此天">
              ✕
            </button>
          </span>
        </div>
        <div className="sub">
          <span>{formatDate(addDays(trip.startDate, index))}</span>
          <span>
            {activities.length} 項 · {formatMoney(cost, trip.currency)}
          </span>
        </div>
        <DayStrip activities={activities} conflicts={conflicts} travel={travel} />
      </header>

      <SortableContext items={activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <div className="day-list" ref={setNodeRef}>
          {activities.length === 0 && <div className="empty-hint">尚無活動，拖曳卡片到這裡或點下方新增</div>}
          {activities.map((a, i) => (
            <div key={a.id}>
              {i > 0 && <Gap trip={trip} prev={activities[i - 1]} cur={a} leg={legs.find((l) => l.to.id === a.id)} routesEnabled={routesEnabled} />}
              <SortableCard activity={a} conflict={conflicts.has(a.id)} />
            </div>
          ))}
        </div>
      </SortableContext>

      <footer className="day-foot">
        <button className="btn sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => addActivity(index)}>
          ＋ 新增活動
        </button>
      </footer>
    </section>
  )
}

/** Horizontal 06:00–24:00 strip: activities in category colour, travel time in grey (red when it overruns). */
function DayStrip({ activities, conflicts, travel }: { activities: Activity[]; conflicts: Set<string>; travel: number[] }) {
  const span = STRIP_END - STRIP_START
  const pct = (m: number) => `${((Math.max(STRIP_START, Math.min(STRIP_END, m)) - STRIP_START) / span) * 100}%`
  return (
    <>
      <div className="day-strip" title="當日時間分布（06:00–24:00）；灰色為移動時間">
        {activities.map((a, i) => {
          if (i === 0 || !travel[i]) return null
          const from = toMinutes(activities[i - 1].end)
          const to = from + travel[i]
          const late = to > toMinutes(a.start)
          return <span key={`t-${a.id}`} className={`travel ${late ? 'late' : ''}`} style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }} />
        })}
        {activities.map((a) => {
          const s = Math.max(STRIP_START, toMinutes(a.start))
          const e = Math.min(STRIP_END, Math.max(toMinutes(a.end), s + 10))
          if (e <= STRIP_START || s >= STRIP_END) return null
          return (
            <span
              key={a.id}
              style={{
                left: `${((s - STRIP_START) / span) * 100}%`,
                width: `${((e - s) / span) * 100}%`,
                background: conflicts.has(a.id) ? 'var(--danger)' : CATEGORY_META[a.category].color,
              }}
            />
          )
        })}
      </div>
      <div className="day-strip-labels">
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </>
  )
}

function Gap({ trip, prev, cur, leg, routesEnabled }: { trip: Trip; prev: Activity; cur: Activity; leg?: DayLeg; routesEnabled: boolean }) {
  const gap = toMinutes(cur.start) - toMinutes(prev.end)
  const mode = TRAVEL_MODES[tripMode(trip)]
  const geo = hasGeo(prev) && hasGeo(cur)
  const km = geo ? distanceKm(prev, cur) : null

  if (gap < 0) return <div className="gap conflict">⚠ 時間重疊 {formatDuration(-gap)}</div>

  if (leg?.leg) {
    const mins = travelMinutes(leg.leg)
    const late = mins > gap
    return (
      <div className={`gap ${late ? 'conflict' : ''}`}>
        {mode.icon} {formatDuration(mins)} · {formatDistance(leg.leg.distanceM)}
        {late ? ` · ⚠ 只有 ${formatDuration(gap)}，趕不上` : gap - mins >= 10 ? ` · 餘 ${formatDuration(gap - mins)}` : ''}
      </div>
    )
  }

  return (
    <div className="gap">
      {gap === 0 ? '→ 緊接' : `⏱ 空檔 ${formatDuration(gap)}`}
      {km != null && km > 0.05 && <span>· 📍 約 {km < 10 ? km.toFixed(1) : Math.round(km)} km</span>}
      {routesEnabled && geo && <span className="muted">· 計算中…</span>}
    </div>
  )
}

function SortableCard({ activity, conflict }: { activity: Activity; conflict: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: activity.id })
  const style = { transform: CSS.Translate.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardView activity={activity} conflict={conflict} dragging={isDragging} />
    </div>
  )
}

function CardView({
  activity: a,
  conflict,
  dragging,
  overlay,
}: {
  activity: Activity
  conflict?: boolean
  dragging?: boolean
  overlay?: boolean
}) {
  const selected = useStore((s) => s.selectedActivityId === a.id)
  const select = useStore((s) => s.select)
  const trip = useCurrentTrip()
  const meta = CATEGORY_META[a.category]
  const cls = ['card', selected && 'selected', conflict && 'conflict', dragging && 'dragging', overlay && 'overlay', a.photo && 'has-photo']
    .filter(Boolean)
    .join(' ')
  const nav = canNavigate(a) ? navLinks(trip, a)[0] : null
  const attachments = Object.values(trip.docs ?? {}).filter((d) => d.activityId === a.id).length
  return (
    <div className={cls} style={{ '--cat': meta.color } as React.CSSProperties} onClick={() => select(a.id)}>
      <div className="bar" data-drag-handle title="拖曳以調整順序或移到其他天">
        <span className="grip" aria-hidden="true" />
      </div>
      <div className="body">
        <div className="time">
          {a.start} – {a.end}
          <span className="dur">{formatDuration(duration(a))}</span>
        </div>
        <div className="title" title={a.title}>
          <span className="cat-ic">{meta.icon}</span>
          <span className="t">{a.title}</span>
        </div>
        <div className="meta">
          {a.location && <span>📍 {a.location}</span>}
          {a.cost > 0 && <span>{formatMoney(a.cost, trip.currency)}</span>}
          {attachments > 0 && (
            <span className="clip" title={`${attachments} 個票券 / 附件`}>
              📎 {attachments}
            </span>
          )}
        </div>
      </div>
      {a.photo && <img className="thumb" src={photoUrl(a.photo, 120)} alt="" loading="lazy" draggable={false} />}
      {conflict && <span className="badge">衝突</span>}
      {nav && !overlay && (
        <button
          className="nav"
          title={`用 ${nav.name} 導航`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            openUrl(nav.url)
          }}
        >
          🧭
        </button>
      )}
    </div>
  )
}
