import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from '@/state/AppContext'
import { TodayRoute } from '@/routes/Today'
import { HabitsRoute } from '@/routes/Habits'
import { HabitEditorRoute } from '@/routes/HabitEditor'
import { SettingsRoute } from '@/routes/Settings'
import { StyleGuideRoute } from '@/routes/StyleGuide'

/**
 * `HashRouter` rather than `BrowserRouter`: it works on any static host with no
 * rewrite rules, which matters for a PWA that may be served from a subpath. The
 * hash is invisible once the app is installed to the home screen.
 */
export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </HashRouter>
  )
}

function Shell() {
  const { ready } = useApp()

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-text-muted">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <main className="flex-1 px-4 pt-safe pb-safe-nav">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayRoute />} />
          <Route path="/habits" element={<HabitsRoute />} />
          <Route path="/habits/new" element={<HabitEditorRoute />} />
          <Route path="/habits/:id/edit" element={<HabitEditorRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          {/* Design-system swatch page. Dev-only: `import.meta.env.DEV` is
              statically false in a production build, so the route and the
              component are dropped by tree-shaking rather than shipped. */}
          {import.meta.env.DEV && (
            <Route path="/styleguide" element={<StyleGuideRoute />} />
          )}
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  )
}

function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg-base/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-stretch pb-safe">
        {/*
          Dashboard and History arrive in phase 4; "Today" is the plain logging
          screen that phase 4 will grow into the dashboard.
        */}
        <TabLink to="/today" label="Today" />
        <TabLink to="/habits" label="Habits" />
        <TabLink to="/settings" label="Settings" />
      </div>
    </nav>
  )
}

/**
 * Active state is carried by weight, colour *value*, and a fill indicator —
 * never by red text, which the palette rules forbid outright. The indicator is
 * a `primary` bar, and red as a fill is exactly what red is for here.
 *
 * Step 5 owns the fuller navigation treatment; this is the minimum needed to
 * keep the tab bar on-palette now that the page ground has moved to `bg-base`.
 */
function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'relative flex flex-1 items-center justify-center py-3 text-body transition-colors duration-fast',
          isActive
            ? 'font-semibold text-text-primary'
            : 'font-medium text-text-muted hover:text-text-secondary',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 mx-auto h-0.5 w-8 rounded-full bg-primary"
            />
          )}
          {label}
        </>
      )}
    </NavLink>
  )
}
