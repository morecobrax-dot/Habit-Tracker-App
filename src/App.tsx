import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from '@/state/AppContext'
import { TodayRoute } from '@/routes/Today'
import { HabitsRoute } from '@/routes/Habits'
import { HabitEditorRoute } from '@/routes/HabitEditor'
import { SettingsRoute } from '@/routes/Settings'
import { HabitDetailRoute } from '@/routes/HabitDetail'
import { StyleGuideRoute } from '@/routes/StyleGuide'
import { TodayIcon, HabitsIcon, SettingsIcon } from '@/components/icons/nav'
import { TodaySkeleton } from '@/components/Skeleton'

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

  // The shell waits on settings before it can compute "today", so this is the
  // very first paint. A centred spinner here would collapse to one line and
  // then expand into a full page — the exact layout jump skeletons exist to
  // prevent — so it shows the shape of the screen it is about to become.
  if (!ready) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <main className="flex-1 px-4 pt-safe pb-safe-nav">
          <TodaySkeleton />
        </main>
        <TabBar />
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
          <Route path="/habits/:id" element={<HabitDetailRoute />} />
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

/**
 * Bottom navigation.
 *
 * Fixed to the bottom edge and 56px tall so every destination sits inside the
 * thumb arc on a phone held one-handed — the top of the screen is the worst
 * place to put navigation you use constantly, and this app is used standing up
 * and half-distracted.
 *
 * Each tab carries an icon *and* a label. Icons alone save a few pixels and
 * cost recognition; labels alone are harder to hit accurately.
 */
function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg-base/95 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-lg items-stretch pb-safe">
        <TabLink to="/today" label="Today" Icon={TodayIcon} />
        <TabLink to="/habits" label="Habits" Icon={HabitsIcon} />
        <TabLink to="/settings" label="Settings" Icon={SettingsIcon} />
      </div>
    </nav>
  )
}

/**
 * Active state is carried four ways — indicator bar, icon weight, text colour
 * and font weight — and never by red text, which the palette rules forbid
 * outright. The indicator is a `primary` fill, which is exactly what red is for.
 *
 * `aria-current="page"` comes from `NavLink` automatically, so the state is not
 * visual-only.
 */
function TabLink({
  to,
  label,
  Icon,
}: {
  to: string
  label: string
  Icon: (props: { className?: string }) => React.ReactElement
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          // 56px: comfortably above the 44px minimum, because this is the
          // control most often hit without looking.
          'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-micro',
          'transition-colors duration-fast',
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
              className="absolute inset-x-0 top-0 mx-auto h-0.5 w-9 rounded-full bg-primary"
            />
          )}
          <Icon className={isActive ? 'h-5 w-5' : 'h-5 w-5 opacity-80'} />
          {label}
        </>
      )}
    </NavLink>
  )
}
