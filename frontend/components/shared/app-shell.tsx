"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LogOut, Menu, User as UserIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NotificationBell } from "@/components/shared/notification-bell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type AppShellProps = {
  navItems: NavItem[];
  children: React.ReactNode;
};

function initialsFor(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function SidebarNav({ navItems, onNavigate }: { navItems: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Shared app shell used by every role route group's layout.tsx (doc 02):
 * header (school name/logo placeholder + notification bell placeholder +
 * user menu) and a role-scoped sidebar nav.
 */
export function AppShell({ navItems, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="bg-muted/20 flex min-h-screen flex-col">
      <header className="bg-background sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
              <GraduationCap className="text-primary size-5" />
              EduManage
            </div>
            <SidebarNav navItems={navItems} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2 font-semibold">
          <GraduationCap className="text-primary size-5" />
          <span className="hidden sm:inline">EduManage</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="size-7">
                  <AvatarFallback>{user ? initialsFor(user.email) : <UserIcon className="size-4" />}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-40 truncate text-sm sm:inline">{user?.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="bg-background sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r md:block">
          <SidebarNav navItems={navItems} />
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
