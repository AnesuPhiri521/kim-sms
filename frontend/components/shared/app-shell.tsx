"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, GraduationCap, LogOut, Menu, User as UserIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

export type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  icon: LucideIcon;
  items: NavLink[];
};

export type NavItem = NavLink | NavGroup;

function isNavGroup(item: NavItem): item is NavGroup {
  return "items" in item;
}

type AppShellProps = {
  navItems: NavItem[];
  children: React.ReactNode;
};

function initialsFor(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function isLinkActive(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
}

function NavLinkItem({
  item,
  active,
  onNavigate,
  indent,
}: {
  item: NavLink;
  active: boolean;
  onNavigate?: () => void;
  indent?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        indent && "pl-9",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function NavGroupItem({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string | null;
  onNavigate?: () => void;
}) {
  const hasActiveChild = group.items.some((item) => isLinkActive(pathname, item.href));
  const [open, setOpen] = useState(hasActiveChild);
  const Icon = group.icon;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            hasActiveChild && !open
              ? "text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Icon className="size-4" />
          <span className="flex-1 text-left">{group.label}</span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 pt-1">
        {group.items.map((item) => (
          <NavLinkItem
            key={item.href}
            item={item}
            active={isLinkActive(pathname, item.href)}
            onNavigate={onNavigate}
            indent
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SidebarNav({ navItems, onNavigate }: { navItems: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map((item) =>
        isNavGroup(item) ? (
          <NavGroupItem key={item.label} group={item} pathname={pathname} onNavigate={onNavigate} />
        ) : (
          <NavLinkItem
            key={item.href}
            item={item}
            active={isLinkActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        )
      )}
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
