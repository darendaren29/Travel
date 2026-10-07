import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore, useCurrentTrip } from '../store'
import { CATEGORY_META, type Activity, type Trip } from '../types'
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

const STRIP_START = 6 * 60 // 06:00
const STRIP_END = 24 * 60 // 24:00
const dayId = (i: number) => `day-${i}`

export default function Board() {
  const trip = useCurrentTrip()
  const { moveActivity, addDay } = useStore()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const locate = (id: string): { day: number; index: number } | null => {
    if (id.startsWith('day-')) return { day: Number(id.slice(4)), index: -1 }
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
  }

  const active = activeId ? trip.activities[activeId] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setOverDay(null)
      }}
    >
      <div className="board">
        {trip.days.map((_, i) => (
          <DayColumn key={trip.days[i].id} trip={trip} index={i} isOver={overDay === i} />
        ))}
        <button className="add-day" onClick={addDay}>
          ＋ 新增一天
        </button>
      </div>
      <DragOverlay>{active ? <CardView activity={active} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

function DayColumn({ trip, index, isOver }: { trip: Trip; index: number; isOver: boolean }) {
  const { addActivity, removeDay } = useStore()
  const activities = dayActivities(trip, index)
  const conflicts = findConflicts(activities)
  const color = dayColor(index)
  const { setNodeRef } = useDroppable({ id: dayId(index) })
  const cost = dayCost(trip, index)

  const onRemove = () => {
    if (trip.days.length <= 1) return
    if (activities.length && !confirm(`第 ${index + 1} 天有 ${activities.length} 個活動，確定刪除？`)) return
    removeDay(index)
  }

  return (
    <section className={`day-col ${isOver ? 'over' : ''}`}>
      <header className="day-head">
        <div className="title">
          <span className="dot" style={{ background: color }} />
          第 {index + 1} 天
          <button className="btn sm ghost remove" onClick={onRemove} disabled={trip.days.length <= 1} title="刪除此天">
            ✕
          </button>
        </div>
        <div className="sub">
          <span>{formatDate(addDays(trip.startDate, index))}</span>
          <span>
            {activities.length} 項 · {formatMoney(cost, trip.currency)}
          </span>
        </div>
        <DayStrip activities={activities} conflicts={conflicts} />
      </header>

      <SortableContext items={activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <div className="day-list" ref={setNodeRef}>
          {activities.length === 0 && <div className="empty-hint">尚無活動，拖曳卡片到這裡或點下方新增</div>}
          {activities.map((a, i) => (
            <div key={a.id}>
              {i > 0 && <Gap prev={activities[i - 1]} cur={a} />}
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

/** Horizontal 06:00–24:00 strip showing where the day's activities fall. */
function DayStrip({ activities, conflicts }: { activities: Activity[]; conflicts: Set<string> }) {
  const span = STRIP_END - STRIP_START
  return (
    <>
      <div className="day-strip" title="當日時間分布（06:00–24:00）">
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

function Gap({ prev, cur }: { prev: Activity; cur: Activity }) {
  const gap = toMinutes(cur.start) - toMinutes(prev.end)
  const hasGeo = prev.lat != null && prev.lng != null && cur.lat != null && cur.lng != null
  const km = hasGeo ? distanceKm({ lat: prev.lat!, lng: prev.lng! }, { lat: cur.lat!, lng: cur.lng! }) : null
  return (
    <div className={`gap ${gap < 0 ? 'conflict' : ''}`}>
      {gap < 0 ? `⚠ 時間重疊 ${formatDuration(-gap)}` : gap === 0 ? '→ 緊接' : `⏱ 空檔 ${formatDuration(gap)}`}
      {km != null && km > 0.05 && <span>· 📍 約 {km < 10 ? km.toFixed(1) : Math.round(km)} km</span>}
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
  const cls = ['card', selected && 'selected', conflict && 'conflict', dragging && 'dragging', overlay && 'overlay']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={{ '--cat': meta.color } as React.CSSProperties} onClick={() => select(a.id)}>
      <div className="bar" />
      <div className="body">
        <div className="time">
          {a.start} – {a.end}
          <span className="dur">{formatDuration(duration(a))}</span>
        </div>
        <div className="title" title={a.title}>
          <span>{meta.icon}</span>
          {a.title}
        </div>
        <div className="meta">
          {a.location && <span>📍 {a.location}</span>}
          {a.cost > 0 && <span>{formatMoney(a.cost, trip.currency)}</span>}
        </div>
      </div>
      {conflict && <span className="badge">衝突</span>}
    </div>
  )
}
