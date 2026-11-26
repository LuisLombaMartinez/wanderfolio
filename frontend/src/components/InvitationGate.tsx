import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { BootScreen } from '@/components/BootScreen'
import { Invitation, type Origin } from '@/components/Invitation'
import { Transition, type TransitionOutcome } from '@/components/Transition'
import { ApiError, acceptInvitation, listPendingInvitations, type PendingInvitation } from '@/lib/api'
import { appendPending } from '@/lib/invitation'
import { ACCEPT_FAILED } from '@/lib/messages'
import { useInvitationLayer } from '@/lib/useInvitationLayer'
import { InvitationTakeoverContext } from '@/components/invitation-takeover'

/** Ask again on return only after the app was hidden this long (MASTER section 48). */
export const RESUME_AFTER_MS = 5 * 60 * 1000
/** At boot, give up waiting for the Pending list after this long and let the app through. */
export const BOOT_TIMEOUT_MS = 6000
/** A resume check may be slower than the boot one, but a hung request must not block later asks. */
export const RESUME_TIMEOUT_MS = 15_000
/** The next Invitation of a queue enters this long after the Trip page is revealed. */
export const NEXT_AFTER_MS = 1500
/** An accept that takes longer than this counts as failed (it is idempotent, so retrying is safe). */
const ACCEPT_TIMEOUT_MS = 10_000

type AcceptResult = 'accepted' | 'gone' | 'failed'

interface Saying {
  origin: Origin
  outcome: Promise<TransitionOutcome>
  memberId: string
}

interface Request {
  memberId: string
  ctrl: AbortController
  promise: Promise<void>
}

/** The API's two "it is not there any more" answers for an accept. */
const GONE_CODES = ['trip-not-found', 'invitation-not-found']

/**
 * Shows the current Member's Pending Invitations before any other screen (MASTER sections 48-50):
 * at session start (holding the boot screen until it knows) and when the app comes back after
 * RESUME_AFTER_MS hidden. One at a time, oldest first; "Sí" accepts and routes to the Trip.
 */
export function InvitationGate({ children }: { children: ReactNode }) {
  const { state, handleApiError } = useAuth()
  const memberId = state.status === 'signed-in' ? state.member.id : null
  const location = useLocation()
  const navigate = useNavigate()
  const onLogin = location.pathname === '/login'

  // The Member whose session start has been checked (null: not checked yet).
  const [checkedFor, setCheckedFor] = useState<string | null>(null)
  // The queue belongs to the Member it was fetched for; another login starts empty.
  const [pending, setPending] = useState<{ memberId: string | null; queue: PendingInvitation[] }>({
    memberId: null,
    queue: [],
  })
  const queue = pending.memberId === memberId ? pending.queue : []
  const setQueue = (q: PendingInvitation[]) => setPending({ memberId, queue: q })
  // False during the short stop between one accepted Invitation and the next.
  const [showing, setShowing] = useState(true)
  const [saying, setSaying] = useState<Saying | null>(null)
  const [alert, setAlert] = useState<string>()

  // Whenever the Member changes (login, logout, another login) the session state starts over, so
  // nothing of the last Member leaks into the next one and a re-login holds the boot screen again.
  const [lastMember, setLastMember] = useState(memberId)
  if (lastMember !== memberId) {
    setLastMember(memberId)
    setCheckedFor(null)
    setShowing(true)
    setSaying(null)
    setAlert(undefined)
  }

  // The Pending request in flight, if any: a second ask for the same Member joins it.
  const inFlight = useRef<Request | null>(null)
  const acceptCtrl = useRef<AbortController | null>(null)
  // Trips accepted or gone during this session: a stale answer must not bring them back.
  const settled = useRef(new Set<string>())
  const acceptResult = useRef<AcceptResult | null>(null)
  const hiddenAt = useRef<number | null>(null)
  const nextTimer = useRef<number | undefined>(undefined)

  const ask = useCallback(
    (forMember: string, timeoutMs: number) => {
      const running = inFlight.current
      if (running?.memberId === forMember) return running.promise
      running?.ctrl.abort()
      const ctrl = new AbortController()
      let timedOut = false
      const timer = window.setTimeout(() => {
        timedOut = true
        ctrl.abort()
      }, timeoutMs)
      const promise = listPendingInvitations(ctrl.signal)
        .then((list) => {
          if (ctrl.signal.aborted) return
          const fresh = list.filter((i) => !settled.current.has(i.tripId))
          setPending((p) => ({
            memberId: forMember,
            queue: p.memberId === forMember ? appendPending(p.queue, fresh) : fresh,
          }))
        })
        .catch((err: unknown) => {
          // Dropped on purpose (logout, another Member): nothing to say about it.
          if (ctrl.signal.aborted && !timedOut) return
          // Fails open: the API keeps the Trip hidden, so nothing is spoiled; it asks again on resume.
          handleApiError(err)
        })
        .finally(() => {
          window.clearTimeout(timer)
          if (inFlight.current?.ctrl === ctrl) inFlight.current = null
        })
      inFlight.current = { memberId: forMember, ctrl, promise }
      return promise
    },
    [handleApiError],
  )

  // Session start: a fresh login or a saved session. Leaving drops whatever this Member had in flight.
  useEffect(() => {
    if (!memberId) return
    let live = true
    const settledNow = settled.current
    void ask(memberId, BOOT_TIMEOUT_MS).finally(() => live && setCheckedFor(memberId))
    return () => {
      live = false
      inFlight.current?.ctrl.abort()
      inFlight.current = null
      acceptCtrl.current?.abort()
      acceptCtrl.current = null
      window.clearTimeout(nextTimer.current)
      settledNow.clear()
    }
  }, [memberId, ask])

  // Return from the background after a while.
  useEffect(() => {
    if (!memberId) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const since = hiddenAt.current
      hiddenAt.current = null
      if (since !== null && Date.now() - since >= RESUME_AFTER_MS) void ask(memberId, RESUME_TIMEOUT_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [memberId, ask])

  const current = showing && !onLogin && memberId ? queue[0] : undefined
  const active = current !== undefined

  useInvitationLayer(active)

  function sayYes(invitation: PendingInvitation, origin: Origin, forMember: string) {
    if (saying) return
    setAlert(undefined)
    const ctrl = new AbortController()
    acceptCtrl.current = ctrl
    const timer = window.setTimeout(() => ctrl.abort(), ACCEPT_TIMEOUT_MS)
    const result: Promise<AcceptResult> = acceptInvitation(invitation.tripId, ctrl.signal)
      .then((): AcceptResult => 'accepted')
      .catch((err: unknown): AcceptResult => {
        if (err instanceof ApiError && err.status === 404 && GONE_CODES.includes(err.code)) return 'gone'
        // Only the Invitee sees an Invitation: a refused accept says nothing about the login.
        if (err instanceof ApiError && err.status === 403 && err.code === 'not-the-invitee') return 'failed'
        handleApiError(err)
        return 'failed'
      })
      .finally(() => window.clearTimeout(timer))
    acceptResult.current = null
    // Registered first, so the value is there by the time the transition hears the outcome.
    void result.then((r) => (acceptResult.current = r))
    const outcome = result.then((r): TransitionOutcome => (r === 'failed' ? 'revert' : 'reveal'))
    setSaying({ origin, outcome, memberId: forMember })
  }

  function reveal() {
    const r = acceptResult.current
    if (!r || !current) return
    settled.current.add(current.tripId)
    const rest = queue.slice(1)
    setQueue(rest)
    if (r === 'accepted') {
      navigate(`/trips/${encodeURIComponent(current.tripId)}`, { replace: true })
      // The next one waits until the Trip page has been seen for a moment.
      if (rest.length > 0) setShowing(false)
    } else if (rest.length === 0 && location.pathname === '/') {
      navigate('/', { replace: true, state: { invitationGone: true } })
    }
  }

  function done(how: TransitionOutcome) {
    const owner = saying?.memberId
    setSaying(null)
    if (how === 'revert') {
      if (owner === memberId) setAlert(ACCEPT_FAILED)
      return
    }
    window.clearTimeout(nextTimer.current)
    nextTimer.current = window.setTimeout(() => setShowing(true), NEXT_AFTER_MS)
  }

  if (memberId && checkedFor !== memberId && !onLogin) return <BootScreen />

  return (
    <>
      {/* `contents` keeps the page's own layout; inert keeps focus and clicks off it. */}
      <div className="contents" inert={active || undefined} aria-hidden={active || undefined}>
        <InvitationTakeoverContext value={active}>{children}</InvitationTakeoverContext>
      </div>
      {current && (
        <div className="fixed inset-0 z-50">
          <Invitation
            key={current.tripId}
            question={current.question}
            destination={current.destination}
            startDate={current.startDate}
            endDate={current.endDate}
            backdrop={{ kind: 'gradient' }}
            leaving={saying !== null}
            busy={saying !== null}
            alert={alert}
            onYes={(origin) => memberId && sayYes(current, origin, memberId)}
          />
        </div>
      )}
      {saying && <Transition origin={saying.origin} outcome={saying.outcome} onReveal={reveal} onDone={done} />}
    </>
  )
}
