import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  broken: boolean
}

/**
 * Keeps a view's crash from blanking the whole app.
 *
 * Google Maps can throw from inside an AdvancedMarker's cleanup when the map is torn down while
 * its markers are still mounting (switching tabs quickly). React 19 treats an uncaught error during
 * that commit as fatal and unmounts the root, leaving an empty page. This boundary, which stays
 * mounted across view switches, catches it and simply remounts its children on the next tick: the
 * map is gone by then, so the new view renders normally.
 */
export default class ViewBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { broken: false }

  static getDerivedStateFromError(): State {
    return { broken: true }
  }

  private resetting = false

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // One commit can report many errors (one per marker); log and reset once per burst.
    if (this.resetting) return
    this.resetting = true
    console.warn('View crashed; remounting.', error, info.componentStack)
    setTimeout(() => {
      this.resetting = false
      this.setState({ broken: false })
    }, 0)
  }

  render() {
    return this.state.broken ? null : this.props.children
  }
}
