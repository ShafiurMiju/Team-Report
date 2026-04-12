'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  FolderKanban,
  ListTodo,
  Users,
  FileText,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  User,
} from 'lucide-react';
import { useState } from 'react';

const menuItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/my-projects', label: 'My Project', icon: FolderKanban, leaderOnly: true, adminHidden: true },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/team', label: 'Team', icon: Users, leaderOnly: true },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  const userRole = (session?.user as any)?.role || 'member';
  const displayName = session?.user?.name || 'User';
  const displayEmail = session?.user?.email || '';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');

  const filteredMenu = menuItems.filter((item) => {
    if (item.adminHidden && userRole === 'admin') return false;
    if (item.leaderOnly) return userRole === 'leader' || userRole === 'admin';
    return true;
  });

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 shadow-sm flex flex-col transition-all duration-300 z-50 ${
        collapsed ? 'w-[72px]' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-16 border-b border-gray-100">
        {!collapsed && (
          <h1 className="text-lg font-bold text-primary-700 truncate">
            📋 Team Reports
          </h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {filteredMenu.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary-50 text-primary-700 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={20} className="flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-100 p-3">
        <div className={`${collapsed ? 'p-2' : 'p-1'} transition-all`}>
          <div
            className={`flex items-center gap-3 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <div className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-semibold">
              {collapsed ? (
                <User size={15} />
              ) : (
                initials || 'U'
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {displayName}
                </p>
                <p className="text-[11px] text-gray-500 truncate">{displayEmail}</p>
              </div>
            )}
          </div>

          <button
            onClick={() => signOut({ callbackUrl: `${window.location.origin}/login` })}
            className={`flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-colors mt-3 ${
              collapsed ? 'justify-center px-0 mt-2' : ''
            }`}
            title="Sign out"
          >
            <LogOut size={17} />
            {!collapsed && <span className="font-medium">Sign Out</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
