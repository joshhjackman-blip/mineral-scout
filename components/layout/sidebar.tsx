"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import {
  Building2Icon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LogOutIcon,
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
  { label: "COA Documents", href: "/coa", icon: FileTextIcon },
  { label: "Watchlist", href: "/watchlist", icon: ListChecksIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
]

export function AppSidebar({ userEmail }: AppSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "PT"

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
    <aside className="flex min-h-screen w-72 flex-col border-r border-slate-700 bg-[#1E293B] text-white">
      <div className="border-b border-slate-700 px-6 py-6">
        <Link href="/dashboard" className="block">
          <p className="text-lg font-semibold tracking-tight">PharmaTrace</p>
          <p className="text-xs text-slate-300">Supplier Intelligence Platform</p>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-slate-800 text-white"
                      : "text-slate-200 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full",
                      isActive ? "bg-[#2563EB]" : "bg-transparent"
                    )}
                  />
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-700 px-4 py-4">
        <div className="flex items-center gap-3 rounded-md bg-slate-800/70 px-3 py-2">
          <Avatar size="sm">
            <AvatarFallback className="bg-[#2563EB] text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xs text-slate-100">{userEmail ?? "Unknown user"}</p>
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSigningOut}
              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-300 transition-colors hover:text-white disabled:opacity-60"
            >
              <LogOutIcon className="size-3.5" />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
        {signOutError ? <p className="mt-2 text-xs text-red-300">{signOutError}</p> : null}
      </div>
    </aside>
  )
}
