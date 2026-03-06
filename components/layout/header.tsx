"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, LogOutIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { createClient } from "@/lib/supabase/client"

type AppHeaderProps = {
  userEmail?: string | null
}

export function AppHeader({ userEmail }: AppHeaderProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "PT"

  const onSignOut = async () => {
    setIsSigningOut(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    setIsSigningOut(false)

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success("Signed out successfully")
    router.push("/auth/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Dashboard</p>
          <p className="text-xs text-muted-foreground">Supplier intelligence workspace</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="hidden sm:inline-flex">
          Phase 1
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border px-2 py-1 hover:bg-accent">
            <Avatar size="sm">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuItem disabled>{userEmail ?? "Unknown user"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isSigningOut}
              onClick={onSignOut}
              variant="destructive"
            >
              <LogOutIcon />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
