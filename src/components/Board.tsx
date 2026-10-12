import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DayAiDialog from './DayAiDialog'
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
import { CATEGORY_META, DEFAULT_SPARE_NAME, TRAVEL_MODES, type Activity, type SpareGroup, type Trip } from '../types'
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
  spareGroupActivities,
  spareGroupsOf,
  todayIndex,
  toMinutes,
} from '../utils'
import { canNavigate, dayRouteUrl, navLinks, openUrl } from '../nav'
import { dayLegs, formatDistance, hasGeo, legBetween, optimizeOrder, travelMinutes, tripMode, type DayLeg } from '../routes'
import { photoUrl, useGooglePlaces } from '../places'
import { FAR_HOP_KM, dayBrief, formatKm } from '../brief'

const STRIP_START = 6 * 60 // 06:00
const STRIP_END = 24 * 60 // 24:00
const dayId = (i: number) => `day-${i}`
const chipId = (i: number) => `chip-${i}`
const isChip = (id: unknown) => String(id).startsWith('chip-')
/** 備用景點 blocks: `SPARE` doubles as their "day index"; the block id rides along in `group`. */
const SPARE = -1
const spareColId = (gid: string) => `spare:${gid}`
const spareChipId = (gid: string) => `chip-spare:${gid}`
/** Block id behind a spare column / chip droppable id, else null. */
const spareIdOf = (id: string): string | null => (id.startsWith('spare:') ? id.slice(6) : id.startsWith('chip-spare:') ? id.slice(11) : null)

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
const scrollToDay = (board: HTMLElement | null, i: number, behavior: ScrollBehavior = 'smooth') => {
  const col = board?.querySelectorAll<HTMLElement>('.day-col')[i]
  if (board && col) board.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(board).paddingLeft), behavior })
}

export default function Board() {
  const trip = useCurrentTrip()
  const { moveActivity, moveToSpare, addDay, addSpareGroup } = useStore()
  const [activeId, setActiveId] = useState<string | null>(null)
  /** Droppable currently hovered: a day's id or a spare column's id. */
  const [over, setOver] = useState<string | null>(null)
  const [aiDay, setAiDay] = useState<number | null>(null)
  const groups = spareGroupsOf(trip)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch devices so a normal swipe still scrolls the list.
    useSensor(GripAwareTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  type Loc = { day: number; index: number; group?: string }
  const locate = (id: string): Loc | null => {
    const gid = spareIdOf(id)
    if (gid) return { day: SPARE, index: -1, group: gid }
    if (id.startsWith('day-')) return { day: Number(id.slice(4)), index: -1 }
    if (isChip(id)) return { day: Number(id.slice(5)), index: -1 }
    for (let d = 0; d < trip.days.length; d++) {
      const idx = trip.days[d].activityIds.indexOf(id)
      if (idx >= 0) return { day: d, index: idx }
    }
    for (const g of groups) {
      const si = g.activityIds.indexOf(id)
      if (si >= 0) return { day: SPARE, index: si, group: g.id }
    }
    return null
  }
  const overKey = (l: Loc | null) => (!l ? null : l.day === SPARE ? spareColId(l.group!) : dayId(l.day))

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragOver = (e: DragOverEvent) => setOver(overKey(e.over ? locate(String(e.over.id)) : null))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setOver(null)
    if (!e.over) return
    const id = String(e.active.id)
    const from = locate(id)
    const to = locate(String(e.over.id))
    if (!from || !to) return

    if (to.day === SPARE) {
      // Into a spare block: loses its time slot; within the same block, just reorders.
      if (from.day === SPARE && from.group === to.group && from.index === to.index) return
      moveToSpare(id, to.group, to.index < 0 ? undefined : to.index)
      if (String(e.over.id).startsWith('chip-spare:')) {
        const gi = groups.findIndex((g) => g.id === to.group)
        setTimeout(() => scrollToDay(boardRef.current, trip.days.length + Math.max(0, gi)), 50)
      }
      return
    }

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

  // While the trip is under way, open on today's column.
  const today = todayIndex(trip)
  useEffect(() => {
    if (today > 0) scrollToDay(boardRef.current, today, 'auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

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
        setOver(null)
      }}
    >
      <div className="board-wrap">
        <DayNav trip={trip} boardRef={boardRef} dragging={!!activeId} />
        <div className="board" ref={boardRef}>
          {trip.days.map((_, i) => (
            <DayColumn key={trip.days[i].id} trip={trip} index={i} isOver={over === dayId(i)} today={i === today} onAi={() => setAiDay(i)} />
          ))}
          <button className="add-day" onClick={addDay}>
            ＋ 新增一天
          </button>
          {groups.map((g, gi) => (
            <SpareColumn key={g.id} trip={trip} group={g} position={gi} count={groups.length} isOver={over === spareColId(g.id)} />
          ))}
          <button className="add-day add-spare-group" onClick={() => addSpareGroup()} title="再開一個備用區塊：依國家、地區或日期分開放">
            📌 新增備用區塊
          </button>
        </div>
      </div>
      {aiDay != null && aiDay < trip.days.length && createPortal(<DayAiDialog dayIndex={aiDay} onClose={() => setAiDay(null)} />, document.body)}
      <DayUndoBar />
      <DeleteUndoBar />
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
  const today = todayIndex(trip)
  const groups = spareGroupsOf(trip)

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
  }, [boardRef, trip.days.length, groups.length])

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
  // Columns: the days plus one per 備用景點 block.
  const n = trip.days.length + groups.length
  // Arrows page by however many days fit on screen (one on phones).
  const step = Math.max(1, visible.size)

  return (
    <nav className={`day-nav ${dragging ? 'dragging' : ''}`} aria-label="切換天數">
      <button className="btn sm ghost" onClick={() => goTo(Math.max(0, first - step))} disabled={first <= 0} aria-label="前一天">
        ◀
      </button>
      <div className="day-chips" ref={chipsRef}>
        {trip.days.map((d, i) => (
          <DayChip key={d.id} trip={trip} index={i} on={visible.has(i)} current={i === first} today={i === today} onClick={() => goTo(i)} />
        ))}
        {groups.map((g, gi) => {
          const ci = trip.days.length + gi
          return <SpareChip key={g.id} group={g} on={visible.has(ci)} current={first === ci} onClick={() => goTo(ci)} />
        })}
      </div>
      <span className="drop-hint" aria-hidden={!dragging}>
        放到日期 → 移到該天 · 放到備用 → 取消時間
      </span>
      <button className="btn sm ghost" onClick={() => goTo(Math.min(n - 1, first + step))} disabled={last >= n - 1} aria-label="後一天">
        ▶
      </button>
    </nav>
  )
}

function DayChip({ trip, index: i, on, current, today, onClick }: { trip: Trip; index: number; on: boolean; current: boolean; today: boolean; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: chipId(i) })
  const date = addDays(trip.startDate, i)
  return (
    <button
      ref={setNodeRef}
      className={`day-chip ${on ? 'on' : ''} ${isOver ? 'drop' : ''} ${today ? 'today' : ''}`}
      style={{ '--day': dayColor(i) } as React.CSSProperties}
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      title={`第 ${i + 1} 天 · ${formatDate(date)}${today ? ' · 今天' : ''}（可把活動拖到這裡）`}
    >
      <b>{String(i + 1).padStart(2, '0')}</b>
      <span>
        {date.getMonth() + 1}/{date.getDate()}
      </span>
    </button>
  )
}

/** Chip for one 備用景點 block: jump to it, or drop a card on it to take the card off the schedule. */
function SpareChip({ group, on, current, onClick }: { group: SpareGroup; on: boolean; current: boolean; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: spareChipId(group.id) })
  const count = group.activityIds.length
  return (
    <button
      ref={setNodeRef}
      className={`day-chip spare-chip ${on ? 'on' : ''} ${isOver ? 'drop' : ''}`}
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      title={`備用區塊「${group.name}」：不排時間的候選地點（把活動拖到這裡會取消它的時間）`}
    >
      <b>📌{count > 0 ? ` ${count}` : ''}</b>
      <span className="spare-chip-name">{group.name}</span>
    </button>
  )
}

/**
 * One 備用景點 block as a column: candidates without a time slot, grouped however the traveller
 * likes (a region, a country, a date range). Drag one onto a day (or its chip) to schedule it, drag
 * a day's card here to take it off the schedule. The name is edited in place.
 */
function SpareColumn({ trip, group, position, count, isOver }: { trip: Trip; group: SpareGroup; position: number; count: number; isOver: boolean }) {
  const { addSpare, renameSpareGroup, removeSpareGroup, moveSpareGroup } = useStore()
  const spares = spareGroupActivities(trip, group)
  const { setNodeRef } = useDroppable({ id: spareColId(group.id) })
  // The default block shown while a trip has none is virtual: nothing to remove yet.
  const real = Boolean(trip.spareGroups?.some((g) => g.id === group.id))
  const onRemove = () => {
    if (spares.length && !confirm(`刪除備用區塊「${group.name}」及其中 ${spares.length} 個備用景點？`)) return
    removeSpareGroup(group.id)
  }
  return (
    <section className={`day-col spare-col ${isOver ? 'over' : ''}`} style={{ '--i': trip.days.length + position } as React.CSSProperties}>
      <header className="day-head">
        <div className="title">
          <span className="day-badge" aria-hidden="true">
            <small>SPARE</small>📌
          </span>
          <span className="day-title">
            <input
              className="spare-name"
              value={group.name}
              onChange={(e) => renameSpareGroup(group.id, e.target.value)}
              onBlur={(e) => !e.target.value.trim() && renameSpareGroup(group.id, DEFAULT_SPARE_NAME)}
              placeholder="區塊名稱（地區、國家、日期…）"
              aria-label="備用區塊名稱"
              title="點一下改名"
            />
            <span className="day-date">不排時間 · {spares.length} 個</span>
          </span>
          <span className="day-tools">
            {count > 1 && (
              <>
                <button className="btn sm ghost" onClick={() => moveSpareGroup(group.id, -1)} disabled={position === 0} title="往前移">
                  ◀
                </button>
                <button className="btn sm ghost" onClick={() => moveSpareGroup(group.id, 1)} disabled={position === count - 1} title="往後移">
                  ▶
                </button>
              </>
            )}
            {real && (
              <button className="btn sm ghost remove" onClick={onRemove} title="刪除這個備用區塊">
                ✕
              </button>
            )}
          </span>
        </div>
        {position === 0 && <p className="spare-hint">拖到某一天就會排進去；行程有變時從這裡挑。可依地區、國家或日期再開新的區塊。</p>}
      </header>
      <SortableContext items={spares.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <div className="day-list" ref={setNodeRef}>
          {spares.length === 0 && <div className="empty-hint">還沒有備用景點。把某天的活動拖到這裡，或點下方新增。</div>}
          {spares.map((a) => (
            <SortableCard key={a.id} activity={a} conflict={false} />
          ))}
        </div>
      </SortableContext>
      <footer className="day-foot">
        <button className="btn sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => addSpare(undefined, group.id)}>
          ＋ 新增備用景點
        </button>
      </footer>
    </section>
  )
}

/** Travel minutes needed before each activity (index-aligned; 0 when unknown). */
const travelBefore = (trip: Trip, activities: Activity[]): number[] =>
  activities.map((a, i) => {
    if (i === 0) return 0
    const leg = legBetween(trip, activities[i - 1], a)
    return leg ? travelMinutes(leg) : 0
  })

/** "Deleted X · undo" bar: replaces a confirm dialog, shown for a few seconds after a delete. */
function DeleteUndoBar() {
  const deleted = useStore((s) => s.deleted)
  const undoDelete = useStore((s) => s.undoDelete)
  const dismiss = useStore((s) => s.dismissDeleted)
  const tripId = useStore((s) => s.currentTripId)
  useEffect(() => {
    if (!deleted) return
    const t = setTimeout(dismiss, 8000)
    return () => clearTimeout(t)
  }, [deleted, dismiss])
  if (!deleted || deleted.tripId !== tripId) return null
  return (
    <div className="undo-bar" role="status">
      <span>🗑 已刪除「{deleted.activity.title}」</span>
      <button className="btn sm" onClick={undoDelete}>
        ↶ 復原
      </button>
      <button className="btn sm ghost" onClick={dismiss} aria-label="關閉">
        ✕
      </button>
    </div>
  )
}

/** "AI updated day N · undo" bar shown for a while after applying an AI co-editing proposal. */
function DayUndoBar() {
  const undo = useStore((s) => s.dayUndo)
  const tripId = useStore((s) => s.currentTripId)
  const undoDay = useStore((s) => s.undoDay)
  const dismiss = useStore((s) => s.dismissDayUndo)
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(dismiss, 15000)
    return () => clearTimeout(t)
  }, [undo, dismiss])
  if (!undo || undo.tripId !== tripId) return null
  return (
    <div className="undo-bar" role="status">
      <span>✨ 已套用 AI 提案到{undo.label}</span>
      <button className="btn sm" onClick={undoDay}>
        ↶ 復原
      </button>
      <button className="btn sm ghost" onClick={dismiss} aria-label="關閉">
        ✕
      </button>
    </div>
  )
}

function DayColumn({ trip, index, isOver, today, onAi }: { trip: Trip; index: number; isOver: boolean; today: boolean; onAi: () => void }) {
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
    <section className={`day-col ${isOver ? 'over' : ''} ${today ? 'today' : ''}`} style={{ '--day': color, '--i': index } as React.CSSProperties}>
      <header className="day-head">
        <div className="title">
          <span className="day-badge" aria-hidden="true">
            <small>DAY</small>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="day-title">
            <span className="day-name">第 {index + 1} 天</span>
            <span className="day-date">
              {formatDate(addDays(trip.startDate, index))}
              {today && <em className="today-tag">今天</em>}
            </span>
          </span>
          <span className="day-tools">
            <button className="btn sm ghost ai-day" onClick={onAi} title="AI 協作：用一句話調整這一天">
              ✨
            </button>
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
        <DayBriefLine activities={activities} cost={formatMoney(cost, trip.currency)} />
        <DayStrip activities={activities} conflicts={conflicts} travel={travel} />
      </header>

      <SortableContext items={activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <div className="day-list" ref={setNodeRef}>
          {activities.length === 0 && <div className="empty-hint">尚無活動：拖曳卡片到這裡、點下方新增，或按右上角 ✨ 請 AI 安排</div>}
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

/** Under the day title: what the day is about, the major places it moves between, and the tally. */
function DayBriefLine({ activities, cost }: { activities: Activity[]; cost: string }) {
  const brief = useMemo(() => dayBrief(activities), [activities])
  const single = brief.route.length === 1
  if (!activities.length)
    return (
      <div className="day-brief">
        <p className="brief-meta">
          <span className="cost">0 項 · {cost}</span>
        </p>
      </div>
    )
  return (
    <div className="day-brief">
      <p className="brief-sum" title={activities.map((a) => a.title).join('、')}>
        <span className="k" aria-hidden="true">
          ✦
        </span>
        <span className="t">{brief.summary}</span>
      </p>
      {brief.route.length > 0 && (
        <p className="brief-route" title="當日主要移動（相距 15 km 內視為同一地區）">
          <span className="k" aria-hidden="true">
            📍
          </span>
          {brief.route.map((s, i) => (
            <span key={i} className="leg">
              {i > 0 && (
                <span className={`arrow ${s.hopKm != null && s.hopKm >= FAR_HOP_KM ? 'far' : ''}`}>
                  {s.hopKm != null && s.hopKm >= FAR_HOP_KM ? <small>{formatKm(s.hopKm)}</small> : null}→
                </span>
              )}
              <span className="stop">
                {s.label}
                {s.count > 1 && <small>×{s.count}</small>}
              </span>
            </span>
          ))}
          {single && brief.route[0].count > 1 && <span className="stay">全天同一地區</span>}
        </p>
      )}
      <p className="brief-meta">
        <span className="tally">
          {brief.tally.map(([c, n]) => (
            <span key={c} style={{ '--c': CATEGORY_META[c].color } as React.CSSProperties} title={CATEGORY_META[c].label}>
              {CATEGORY_META[c].icon}
              {n}
            </span>
          ))}
        </span>
        <span className="cost">
          {activities.length} 項 · {cost}
        </span>
      </p>
    </div>
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
  const spare = !a.start && !a.end
  return (
    <div className={`${cls}${spare ? ' spare' : ''}`} style={{ '--cat': meta.color } as React.CSSProperties} onClick={() => select(a.id)}>
      <div className="bar" data-drag-handle title={spare ? '拖到某一天排進行程' : '拖曳以調整順序、移到其他天，或放到備用景點'}>
        <span className="grip" aria-hidden="true" />
      </div>
      <div className="body">
        <div className="time">
          {spare ? (
            <span className="unscheduled">未排時間</span>
          ) : (
            <>
              {a.start} – {a.end}
              <span className="dur">{formatDuration(duration(a))}</span>
            </>
          )}
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
