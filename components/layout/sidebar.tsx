"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  BellIcon,
  Building2Icon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LogOutIcon,
  SquareIcon,
  SettingsIcon,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type AppSidebarProps = {
  userEmail?: string | null
}

const navigationItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { label: "Suppliers", href: "/suppliers", icon: Building2Icon },
  { label: "Alerts", href: "/alerts", icon: BellIcon },
  { label: "COA Documents", href: "/coa", icon: FileTextIcon },
  { label: "Watchlist", href: "/watchlist", icon: ListChecksIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
]

export function AppSidebar({ userEmail }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [sessionEmail, setSessionEmail] = useState<string | null>(userEmail ?? null)

  useEffect(() => {
    let isMounted = true
    const loadSessionUser = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (isMounted && user?.email) {
          setSessionEmail(user.email)
        }
      } catch {
        // Keep fallback value from server-provided email.
      }
    }
    void loadSessionUser()
    return () => {
      isMounted = false
    }
  }, [])

  const displayEmail = sessionEmail ?? userEmail ?? "Unknown user"
  const initials = displayEmail ? displayEmail.slice(0, 2).toUpperCase() : "PT"

  const onSignOut = async () => {
    setSignOutError(null)
    setIsSigningOut(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    setIsSigningOut(false)

    if (error) {
      setSignOutError(error.message)
      return
    }

    router.push("/auth/login")
    router.refresh()
  }

  return (
    <aside className="flex min-h-screen w-72 flex-col border-r border-[#1f1f1f] bg-[#111111] text-white">
      <div className="border-b border-[#262626] px-5 py-5">
        <Link href="/dashboard" className="block">
          <div className="flex items-center gap-2">
            <SquareIcon className="size-3 fill-[#CC0000] text-[#CC0000]" />
            <p className="text-lg font-bold tracking-tight text-white">PharmaTrace</p>
          </div>
          <p className="mt-1 text-xs text-neutral-400">Supplier Intelligence Platform</p>
        </Link>
      </div>

      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "border-[#CC0000] bg-[#1a1a1a] text-[#CC0000]"
                      : "border-transparent text-neutral-100 hover:bg-[#1a1a1a] hover:text-white"
                  )}
                >
                  <item.icon className={cn("size-4", isActive ? "text-[#CC0000]" : "text-neutral-300")} />
                  <span className={cn("font-medium", isActive ? "text-[#CC0000]" : "text-neutral-100")}>
                    {item.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-[#262626] px-3 py-3">
        <div className="flex items-center gap-3 rounded-md border border-[#262626] bg-[#151515] px-3 py-2">
          <Avatar size="sm">
            <AvatarFallback className="bg-[#CC0000] text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xs text-neutral-200">{displayEmail}</p>
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSigningOut}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-neutral-400 transition-colors hover:text-[#CC0000] disabled:opacity-60"
            >
              <LogOutIcon className="size-3.5" />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
        {signOutError ? <p className="mt-2 text-xs text-red-400">{signOutError}</p> : null}
      </div>
    </aside>
  )
}
