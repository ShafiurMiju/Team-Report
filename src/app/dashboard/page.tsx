'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/DashboardLayout';
import StatusBadge from '@/components/StatusBadge';
import {
  FolderKanban,
  Users,
  ListTodo,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
  RotateCcw,
  Activity,
  Target,
} from 'lucide-react';

interface RecentTask {
  id: string;
  title: string;
  status: string;
  user?: { name?: string };
  project?: { name?: string; emoji?: string };
}

interface ProjectSummary {
  id: string;
  name: string;
  emoji: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  completionHours?: number;
  completionRate: number;
}

interface MemberSummary {
  id: string;
  name: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  completionRate: number;
}

interface Stats {
  totalProjects: number;
  totalMembers: number;
  totalTasks: number;
  todayTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  todoTasks: number;
  pendingCarryOverTasks: number;
  completionRate: number;
  weeklySeries: {
    date: string;
    label: string;
    total: number;
    done: number;
  }[];
  projectSummary: ProjectSummary[];
  memberSummary: MemberSummary[];
  recentTasks: RecentTask[];
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const isLeader = session?.user?.role === 'leader' || session?.user?.role === 'admin';

  const weeklySeries = stats?.weeklySeries || [];
  const maxWeeklyValue = Math.max(
    1,
    ...weeklySeries.map((d) => Math.max(d.total || 0, d.done || 0))
  );

  const totalPoints = weeklySeries.length || 1;
  const totalPolyline = weeklySeries
    .map((point, idx) => {
      const x = totalPoints === 1 ? 0 : (idx / (totalPoints - 1)) * 100;
      const y = 100 - ((point.total || 0) / maxWeeklyValue) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  const donePolyline = weeklySeries
    .map((point, idx) => {
      const x = totalPoints === 1 ? 0 : (idx / (totalPoints - 1)) * 100;
      const y = 100 - ((point.done || 0) / maxWeeklyValue) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPolygon = totalPolyline
    ? `0,100 ${totalPolyline} 100,100`
    : '0,100 100,100';

  const totalStatus = (stats?.doneTasks || 0) + (stats?.inProgressTasks || 0) + (stats?.todoTasks || 0);
  const donePct = totalStatus > 0 ? Math.round(((stats?.doneTasks || 0) / totalStatus) * 100) : 0;
  const inProgressPct = totalStatus > 0 ? Math.round(((stats?.inProgressTasks || 0) / totalStatus) * 100) : 0;
  const todoPct = Math.max(0, 100 - donePct - inProgressPct);

  const statusDonutStyle = {
    background: `conic-gradient(#22c55e 0% ${donePct}%, #f59e0b ${donePct}% ${donePct + inProgressPct}%, #94a3b8 ${donePct + inProgressPct}% 100%)`,
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  const statCards = [
    ...(isLeader
      ? [
          {
            label: 'Projects',
            value: stats?.totalProjects || 0,
            icon: FolderKanban,
            color: 'bg-blue-50 text-blue-600',
          },
          {
            label: 'Team Members',
            value: stats?.totalMembers || 0,
            icon: Users,
            color: 'bg-purple-50 text-purple-600',
          },
        ]
      : []),
    {
      label: 'Completion Rate',
      value: `${stats?.completionRate || 0}%`,
      icon: TrendingUp,
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Carry Over',
      value: stats?.pendingCarryOverTasks || 0,
      icon: RotateCcw,
      color: 'bg-orange-50 text-orange-600',
    },
    {
      label: "Today's Tasks",
      value: stats?.todayTasks || 0,
      icon: ListTodo,
      color: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Completed',
      value: stats?.doneTasks || 0,
      icon: CheckCircle2,
      color: 'bg-green-50 text-green-600',
    },
    {
      label: 'In Progress',
      value: stats?.inProgressTasks || 0,
      icon: Clock,
      color: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'To Do',
      value: stats?.todoTasks || 0,
      icon: AlertCircle,
      color: 'bg-gray-50 text-gray-600',
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {session?.user?.name} 👋
          </h1>
          <p className="text-gray-500 mt-1">
            Here&apos;s what&apos;s happening with your team today.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {new Date().toLocaleDateString()} • {isLeader ? 'Manager view' : 'Member view'}
          </p>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {card.value}
                  </p>
                </div>
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center ${card.color}`}
                >
                  <card.icon size={22} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Today's Progress */}
        {stats && stats.todayTasks > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Today&apos;s Progress
              </h2>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round(
                      ((stats.doneTasks || 0) / (stats.todayTasks || 1)) * 100
                    )}%`,
                  }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-2">
                {stats.doneTasks} of {stats.todayTasks} tasks completed (
                {Math.round(
                  ((stats.doneTasks || 0) / (stats.todayTasks || 1)) * 100
                )}
                %)
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Status Split</h2>
              <div className="space-y-2 text-sm">
                <p className="text-gray-600">✅ Done: <span className="font-semibold text-gray-900">{stats.doneTasks}</span></p>
                <p className="text-gray-600">🔄 In Progress: <span className="font-semibold text-gray-900">{stats.inProgressTasks}</span></p>
                <p className="text-gray-600">📋 To Do: <span className="font-semibold text-gray-900">{stats.todoTasks}</span></p>
                <p className="text-gray-600">🔁 Carry Over: <span className="font-semibold text-gray-900">{stats.pendingCarryOverTasks}</span></p>
              </div>
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Activity size={18} className="text-primary-600" />
                  7-Day Performance Trend
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Total tasks vs completed tasks</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-500" /> Total
                </span>
                <span className="inline-flex items-center gap-1 text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Done
                </span>
              </div>
            </div>

            {weeklySeries.length > 0 ? (
              <>
                <div className="w-full h-56 rounded-lg bg-gradient-to-b from-primary-50/60 to-white border border-gray-100 p-3">
                  <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
                    <polyline
                      points="0,75 100,75"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points="0,50 100,50"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points="0,25 100,25"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke"
                    />

                    <polygon points={areaPolygon} fill="#dbeafe" opacity="0.6" />
                    <polyline
                      points={totalPolyline}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="1.6"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                    />
                    <polyline
                      points={donePolyline}
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="1.6"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div className="grid grid-cols-7 gap-1 mt-2 text-center">
                  {weeklySeries.map((point) => (
                    <div key={point.date}>
                      <p className="text-[11px] text-gray-500">{point.label}</p>
                      <p className="text-[11px] font-medium text-gray-700">{point.done}/{point.total}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-56 flex items-center justify-center text-sm text-gray-400 border border-dashed rounded-lg">
                Not enough data for trend chart.
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Target size={18} className="text-emerald-600" />
              Workload Distribution
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">Based on today&apos;s task statuses</p>

            <div className="flex items-center justify-center mb-4">
              <div className="relative w-40 h-40 rounded-full" style={statusDonutStyle}>
                <div className="absolute inset-6 rounded-full bg-white border border-gray-100 flex flex-col items-center justify-center">
                  <p className="text-[11px] text-gray-500">Completion</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.completionRate || 0}%</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Done</span>
                <span className="font-medium text-gray-900">{stats?.doneTasks || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />In Progress</span>
                <span className="font-medium text-gray-900">{stats?.inProgressTasks || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-gray-600"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" />To Do</span>
                <span className="font-medium text-gray-900">{stats?.todoTasks || 0}</span>
              </div>
              <div className="pt-2 border-t text-xs text-gray-500">Split: {donePct}% / {inProgressPct}% / {todoPct}%</div>
            </div>
          </div>
        </div>

        {/* Project Summary */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Today by Project</h2>
            <span className="text-xs text-gray-500">Top active projects</span>
          </div>
          <div className="divide-y divide-gray-50">
            {stats?.projectSummary?.length ? (
              stats.projectSummary.map((project) => (
                <div key={project.id} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium text-gray-900">
                      {project.emoji} {project.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {project.done}/{project.total} done • {project.completionRate}% • ⏱ {project.completionHours || 0}h
                    </p>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="h-2 bg-primary-500 rounded-full"
                      style={{ width: `${project.completionRate}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-gray-400">
                <FolderKanban size={28} className="mx-auto mb-2 opacity-50" />
                <p>No project activity today.</p>
              </div>
            )}
          </div>
        </div>

        {/* Leader Member Summary */}
        {isLeader && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Member Performance Today</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {stats?.memberSummary?.length ? (
                stats.memberSummary.map((member) => (
                  <div key={member.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        ✅ {member.done} • 🔄 {member.inProgress} • 📋 {member.todo}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{member.total} tasks</p>
                      <p className="text-xs text-gray-500">{member.completionRate}% done</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-5 py-8 text-center text-gray-400">
                  <Users size={28} className="mx-auto mb-2 opacity-50" />
                  <p>No member activity today.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recent Tasks */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">
              Today&apos;s Recent Activity
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats?.recentTasks && stats.recentTasks.length > 0 ? (
              stats.recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">
                      {task.project?.emoji || '🔷'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {task.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {task.project?.name} • {task.user?.name}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={task.status} size="sm" />
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-gray-400">
                <ListTodo size={32} className="mx-auto mb-2 opacity-50" />
                <p>No tasks for today yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
