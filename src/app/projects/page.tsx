'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Select, { StylesConfig } from 'react-select';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import ConfirmModal from '@/components/ConfirmModal';
import StatusBadge from '@/components/StatusBadge';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FolderKanban, ListTodo, User, Calendar, GripVertical } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  emoji: string;
  leaderIds?: string[];
  priority?: number;
  createdAt: string;
  totalCount?: number;
  todayCount?: number;
  _count: { tasks: number };
}

interface Task {
  id: string;
  title: string;
  status: string;
  user: { id: string; name: string };
}

interface Member {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

interface FilterOption {
  value: string;
  label: string;
}

const boxedMultiSelectStyles: StylesConfig<FilterOption, true> = {
  control: (base) => ({
    ...base,
    border: 'none',
    boxShadow: 'none',
    minHeight: '20px',
    backgroundColor: 'transparent',
  }),
  valueContainer: (base) => ({ ...base, padding: 0, gap: '4px' }),
  input: (base) => ({ ...base, margin: 0, padding: 0 }),
  indicatorsContainer: (base) => ({ ...base, height: '20px' }),
  dropdownIndicator: (base) => ({ ...base, padding: 2, color: '#9ca3af' }),
  clearIndicator: (base) => ({ ...base, padding: 2, color: '#9ca3af' }),
  indicatorSeparator: (base) => ({ ...base, marginTop: 2, marginBottom: 2, backgroundColor: '#e5e7eb' }),
  placeholder: (base) => ({ ...base, margin: 0, color: '#6b7280' }),
  multiValue: (base) => ({ ...base, margin: 0, borderRadius: '9999px', backgroundColor: '#f3f4f6' }),
  multiValueLabel: (base) => ({ ...base, fontSize: '11px', color: '#374151' }),
  multiValueRemove: (base) => ({ ...base, borderRadius: '9999px' }),
  menuPortal: (base) => ({ ...base, zIndex: 200 }),
};

const EMOJI_OPTIONS = ['🔷', '🟢', '🔴', '🟡', '🟣', '🟠', '📱', '🌐', '🤖', '📊', '🎯', '🚀', '💡', '📚', '🛠️'];

export default function ProjectsPage() {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [todayTasksModalOpen, setTodayTasksModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [statusUpdatingTaskId, setStatusUpdatingTaskId] = useState<string | null>(null);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [completionTimeUsedHours, setCompletionTimeUsedHours] = useState('');
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [taskFilterUserIds, setTaskFilterUserIds] = useState<string[]>([]);
  const [taskFilterDate, setTaskFilterDate] = useState(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
  });
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔷');

  const role = session?.user?.role;
  const isAdmin = role === 'admin';
  const isLeader = role === 'leader';
  const canManageProjects = isAdmin || isLeader;
  const showDualSections = false;
  const canReorderProjects = false;
  const leaderOptions = members.filter((member) => member.role === 'leader');
  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>([]);

  const getTodayLocalDateString = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
  };

  const parseTimeToHours = (value: string): number | null => {
    const input = value.trim();
    if (!input) return null;

    if (input.includes(':')) {
      const [hoursPart, minutesPart] = input.split(':');
      if (minutesPart === undefined) return Number.NaN;

      const hours = Number(hoursPart);
      const minutes = Number(minutesPart);
      if (
        !Number.isFinite(hours) ||
        !Number.isFinite(minutes) ||
        hours < 0 ||
        minutes < 0 ||
        minutes >= 60
      ) {
        return Number.NaN;
      }

      return Math.round((hours + minutes / 60) * 100) / 100;
    }

    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
    return Math.round(parsed * 100) / 100;
  };

  const fetchMembers = async () => {
    if (!canManageProjects) return;
    const res = await fetch('/api/members');
    if (!res.ok) return;
    const data = await res.json();
    setMembers(Array.isArray(data) ? data : []);
  };

  const memberFilterOptions: FilterOption[] = (() => {
    const base = members.map((member) => ({
      value: member.id,
      label: member.name,
    }));

    const currentUserId = session?.user?.id;
    if (!isLeader || !currentUserId) return base;

    const currentUserName = session?.user?.name || 'Me';
    const hasMe = base.some((option) => option.value === currentUserId);

    if (hasMe) {
      return base.map((option) =>
        option.value === currentUserId
          ? { ...option, label: `${option.label} (Me)` }
          : option
      );
    }

    return [{ value: currentUserId, label: `${currentUserName} (Me)` }, ...base];
  })();

  const fetchTasksForProject = async (project: Project, date: string, userIds?: string[]) => {
    setTasksLoading(true);
    const params = new URLSearchParams({
      projectId: project.id,
      date,
    });
    if (canManageProjects && userIds && userIds.length > 0) {
      userIds.forEach((userId) => params.append('userIds', userId));
    }

    try {
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      setTodayTasks(Array.isArray(data) ? data : []);
    } catch {
      setTodayTasks([]);
      toast.error('Failed to load tasks');
    }

    setTasksLoading(false);
  };

  const openTodayTasksForProject = (project: Project) => {
    const today = getTodayLocalDateString();
    setSelectedProject(project);
    setTaskFilterUserIds([]);
    setTaskFilterDate(today);
    setTodayTasksModalOpen(true);
    fetchTasksForProject(project, today);
  };

  const updateTaskStatus = async (task: Task, status: string) => {
    if (status === 'done' && task.status !== 'done') {
      setCompletionTask(task);
      setCompletionTimeUsedHours('');
      return;
    }

    setStatusUpdatingTaskId(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update status');
      }

      setTodayTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status } : item)));
      toast.success('Status updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    }
    setStatusUpdatingTaskId(null);
  };

  const handleCompleteTask = async () => {
    if (!completionTask) return;

    const parsedHours = parseTimeToHours(completionTimeUsedHours);
    if (Number.isNaN(parsedHours)) {
      toast.error('Invalid time format. Use HH:MM (e.g. 1:30) or decimal (e.g. 1.5)');
      return;
    }
    if (parsedHours === null) {
      toast.error('Please enter completed time before marking done');
      return;
    }

    setSavingCompletion(true);
    setStatusUpdatingTaskId(completionTask.id);
    try {
      const res = await fetch(`/api/tasks/${completionTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'done',
          timeUsedHours: parsedHours,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update status');
      }

      setTodayTasks((prev) =>
        prev.map((item) =>
          item.id === completionTask.id
            ? {
                ...item,
                status: 'done',
              }
            : item
        )
      );

      toast.success('Task marked as done');
      setCompletionTask(null);
      setCompletionTimeUsedHours('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    }
    setSavingCompletion(false);
    setStatusUpdatingTaskId(null);
  };

  useEffect(() => {
    fetchMembers();
  }, [canManageProjects]);

  useEffect(() => {
    if (!todayTasksModalOpen || !selectedProject) return;
    fetchTasksForProject(selectedProject, taskFilterDate, taskFilterUserIds);
  }, [taskFilterDate, taskFilterUserIds, todayTasksModalOpen, selectedProject]);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects?scope=all');
      const data = await res.json();
      const normalized = Array.isArray(data) ? data : [];
      setProjects(normalized);
      setAllProjects(normalized);
    } catch {
      setProjects([]);
      setAllProjects([]);
      toast.error('Failed to load projects');
    }
    setLoading(false);
  };

  const persistProjectOrder = async (orderedProjects: Project[]) => {
    if (!canManageProjects) return;

    setReordering(true);
    try {
      const res = await fetch('/api/projects/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: orderedProjects.map((project) => project.id) }),
      });

      if (!res.ok) {
        throw new Error();
      }

      toast.success('Project order updated');
      fetchProjects();
    } catch {
      toast.error('Failed to update project order');
      fetchProjects();
    }
    setReordering(false);
  };

  const handleDragStart = (projectId: string) => {
    if (!canReorderProjects) return;
    setDraggedProjectId(projectId);
  };

  const handleDragOverCard = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canReorderProjects) return;
    e.preventDefault();
  };

  const handleDropOnCard = (targetProjectId: string) => {
    if (!canReorderProjects || !draggedProjectId || draggedProjectId === targetProjectId) return;

    const fromIndex = projects.findIndex((project) => project.id === draggedProjectId);
    const toIndex = projects.findIndex((project) => project.id === targetProjectId);

    if (fromIndex < 0 || toIndex < 0) return;

    const reorderedProjects = [...projects];
    const [movedProject] = reorderedProjects.splice(fromIndex, 1);
    reorderedProjects.splice(toIndex, 0, movedProject);

    setProjects(reorderedProjects);
    setDraggedProjectId(null);
    persistProjectOrder(reorderedProjects);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const openCreate = () => {
    setEditingProject(null);
    setName('');
    setEmoji('🔷');
    setSelectedLeaderIds([]);
    setModalOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setEmoji(project.emoji);
    setSelectedLeaderIds(Array.isArray(project.leaderIds) ? project.leaderIds : []);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProject) {
        const res = await fetch(`/api/projects/${editingProject.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            emoji,
            ...(isAdmin ? { leaderIds: selectedLeaderIds } : {}),
          }),
        });
        if (!res.ok) throw new Error();
        toast.success('Project updated!');
      } else {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            emoji,
          }),
        });
        if (!res.ok) throw new Error();
        toast.success('Project created!');
      }
      setModalOpen(false);
      setSelectedLeaderIds([]);
      fetchProjects();
    } catch {
      toast.error('Failed to save project');
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingProject(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Project deleted');
      fetchProjects();
      setDeletingProjectId(null);
    } catch {
      toast.error('Failed to delete project');
    }
    setDeletingProject(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
            <p className="text-gray-500 mt-1">Manage your team projects</p>
          </div>
          {canManageProjects && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
            >
              <Plus size={18} />
              New Project
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <FolderKanban size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No projects yet.</p>
            {canManageProjects && (
              <button
                onClick={openCreate}
                className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
              >
                Create your first project →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {showDualSections && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">All Projects</h2>
                {allProjects.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
                    <p className="text-sm text-gray-500">No projects available.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {allProjects.map((project) => (
                      <div
                        key={`all-${project.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openTodayTasksForProject(project)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openTodayTasksForProject(project);
                          }
                        }}
                        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{project.emoji}</span>
                            <div>
                              <h3 className="font-semibold text-gray-900">{project.name}</h3>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {(project.totalCount ?? project._count.tasks)} total • {(project.todayCount ?? 0)} today
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              {showDualSections && (
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Selected Projects</h2>
              )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                draggable={canReorderProjects}
                onClick={() => openTodayTasksForProject(project)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openTodayTasksForProject(project);
                  }
                }}
                onDragStart={() => handleDragStart(project.id)}
                onDragOver={handleDragOverCard}
                onDrop={() => handleDropOnCard(project.id)}
                onDragEnd={() => setDraggedProjectId(null)}
                className={`bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer ${draggedProjectId === project.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {canReorderProjects && <GripVertical size={16} className="text-gray-300 mt-1" />}
                    <span className="text-2xl">{project.emoji}</span>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {project.name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {(project.totalCount ?? project._count.tasks)} total • {(project.todayCount ?? 0)} today
                      </p>
                    </div>
                  </div>
                  {canManageProjects && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(project);
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProjectId(project.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
            </div>
          </div>
        )}

        {canReorderProjects && reordering && (
          <p className="text-xs text-gray-500">Updating project order...</p>
        )}

        {/* Create/Edit Modal */}
        <Modal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSelectedLeaderIds([]);
          }}
          title={editingProject ? 'Edit Project' : 'New Project'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. NuPath, DCN..."
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>

            {isAdmin && editingProject && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Visible to Leaders
                </label>
                <select
                  multiple
                  value={selectedLeaderIds}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions).map((option) => option.value);
                    setSelectedLeaderIds(values);
                  }}
                  className="w-full min-h-[120px] px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  {leaderOptions.map((leader) => (
                    <option key={leader.id} value={leader.id}>
                      {leader.name}{leader.email ? ` (${leader.email})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  If no leader is selected, leaders will not see this project.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Icon
              </label>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setEmoji(em)}
                    className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                      emoji === em
                        ? 'bg-primary-100 ring-2 ring-primary-500 scale-110'
                        : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
              >
                {editingProject ? 'Update' : 'Create'} Project
              </button>
            </div>
          </form>
        </Modal>

        <ConfirmModal
          isOpen={Boolean(deletingProjectId)}
          title="Delete Project"
          message="Delete this project? All tasks in this project will also be deleted."
          confirmText="Delete"
          isLoading={deletingProject}
          onClose={() => {
            if (deletingProject) return;
            setDeletingProjectId(null);
          }}
          onConfirm={() => {
            if (!deletingProjectId) return;
            handleDelete(deletingProjectId);
          }}
        />

        <Modal
          isOpen={todayTasksModalOpen}
          onClose={() => setTodayTasksModalOpen(false)}
          title={selectedProject ? `${selectedProject.emoji} ${selectedProject.name} • Tasks` : 'Tasks'}
          size="2xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <Calendar size={16} className="text-gray-400" />
                <input
                  type="date"
                  value={taskFilterDate}
                  onChange={(e) => setTaskFilterDate(e.target.value)}
                  className="outline-none text-sm text-gray-700 bg-transparent w-full"
                />
              </div>
              {canManageProjects && (
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                  <User size={16} className="text-gray-400" />
                  <div className="w-full">
                    <Select
                      isMulti
                      options={memberFilterOptions}
                      value={memberFilterOptions.filter((option) => taskFilterUserIds.includes(option.value))}
                      onChange={(selected) => setTaskFilterUserIds(selected.map((item) => item.value))}
                      placeholder="All members (or Me)"
                      className="text-sm"
                      classNamePrefix="project-member-filter"
                      styles={boxedMultiSelectStyles}
                      menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                    />
                  </div>
                </div>
              )}
            </div>

            {tasksLoading ? (
              <div className="flex items-center justify-center h-28">
                <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : todayTasks.length === 0 ? (
              <div className="text-center py-8">
                <ListTodo size={36} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">No tasks for selected date.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {todayTasks.map((task) => (
                  <div
                    key={task.id}
                    className="border border-gray-100 rounded-lg p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-words">{task.title}</p>
                      <p className="text-xs text-gray-500 mt-1">👤 {task.user.name}</p>
                    </div>
                    {canManageProjects ? (
                      <select
                        value={task.status}
                        onChange={(e) => updateTaskStatus(task, e.target.value)}
                        disabled={statusUpdatingTaskId === task.id}
                        className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:opacity-60"
                      >
                        {task.status === 'todo' && <option value="todo">📋 To Do</option>}
                        <option value="in-progress">🔄 In Progress</option>
                        <option value="pause">⏸️ Pause</option>
                        <option value="done">✅ Done</option>
                      </select>
                    ) : (
                      <StatusBadge status={task.status} size="sm" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(completionTask)}
          onClose={() => {
            if (savingCompletion) return;
            setCompletionTask(null);
            setCompletionTimeUsedHours('');
          }}
          title={completionTask ? `Complete Task: ${completionTask.title}` : 'Complete Task'}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter completed time before marking this task as done.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Completed Time (hours)
              </label>
              <input
                type="text"
                value={completionTimeUsedHours}
                onChange={(e) => setCompletionTimeUsedHours(e.target.value)}
                placeholder="e.g. 1:30 or 1.5"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (savingCompletion) return;
                  setCompletionTask(null);
                  setCompletionTimeUsedHours('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCompleteTask}
                disabled={savingCompletion}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {savingCompletion ? 'Saving...' : 'Mark Done'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
