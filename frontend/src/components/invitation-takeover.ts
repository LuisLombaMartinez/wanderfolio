import { createContext, useContext } from 'react'

/**
 * True while the InvitationGate shows a real (Pending) Invitation. A replay layer gives way to it
 * at once (MASTER section 61): a replay never sits in the gate's queue.
 */
export const InvitationTakeoverContext = createContext(false)

export const useInvitationTakeover = () => useContext(InvitationTakeoverContext)
