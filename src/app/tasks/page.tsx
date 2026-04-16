'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Select, { MultiValue, StylesConfig } from 'react-select';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import ConfirmModal from '@/components/ConfirmModal';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, ListTodo, Calendar, User, FolderKanban, RefreshCw, Sparkles } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: 'low' | 'medium' | 'high';
  inProgressStartedAt?: string | null;
  doneAt?: string | null;
  timeUsedHours?: number | null;
  timeAutoCalculated?: boolean;
  date: string;
  transferredAt?: string | null;
  transferredToDate?: string | null;
  user: { id: string; name: string; email: string };
  project: { id: string; name: string; emoji: string };
}

interface SyncCandidateTask {
  id: string;
  title: string;
  status: string;
  date: string;
  user?: { id: string; name: string };
  project: { id: string; name: string; emoji: string };
}

interface BulkDraftTask {
  title: string;
  description?: string;
  projectId: string;
  userId: string;
  projectName: string;
  projectEmoji: string;
  userName: string;
}

interface Project {
  id: string;
  name: string;
  emoji: string;
}

interface Member {
  id: string;
  name: string;
  role?: string;
}

interface SyncUserOption {
  value: string;
  label: string;
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
    minHeight: '24px',
    backgroundColor: 'transparent',
  }),
  valueContainer: (base) => ({
    ...base,
    padding: 0,
    gap: '4px',
  }),
  input: (base) => ({
    ...base,
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base) => ({
    ...base,
    height: '24px',
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: 2,
    color: '#9ca3af',
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: 2,
    color: '#9ca3af',
  }),
  indicatorSeparator: (base) => ({
    ...base,
    marginTop: 2,
    marginBottom: 2,
    backgroundColor: '#e5e7eb',
  }),
  placeholder: (base) => ({
    ...base,
    margin: 0,
    color: '#6b7280',
  }),
  multiValue: (base) => ({
    ...base,
    margin: 0,
    borderRadius: '9999px',
    backgroundColor: '#f3f4f6',
  }),
  multiValueLabel: (base) => ({
    ...base,
    fontSize: '12px',
    color: '#374151',
  }),
  multiValueRemove: (base) => ({
    ...base,
    borderRadius: '9999px',
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 200,
  }),
};

const modalMultiSelectStyles: StylesConfig<SyncUserOption, true> = {
  control: (base) => ({
    ...base,
    minHeight: '40px',
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#d1d5db' },
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 200,
  }),
};

export default function TasksPage() {
  const { data: session } = useSession();
  const toDateInputValue = (value: string | Date) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const todayDate = toDateInputValue(new Date());
  const isManager = session?.user?.role === 'leader' || session?.user?.role === 'admin';
  const isAdmin = session?.user?.role === 'admin';
  const searchParams = useSearchParams();
  const LAST_PROJECT_KEY = 'tasks:lastSelectedProjectId';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionTask, setCompletionTask] = useState<Task | null>(null);
  const [completionTimeUsedHours, setCompletionTimeUsedHours] = useState('');
  const [completionTimeAutoCalculated, setCompletionTimeAutoCalculated] = useState(false);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [syncCandidates, setSyncCandidates] = useState<SyncCandidateTask[]>([]);
  const [selectedSyncTaskIds, setSelectedSyncTaskIds] = useState<string[]>([]);
  const [syncUserIds, setSyncUserIds] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [rewritingField, setRewritingField] = useState<'title' | 'description' | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkPrompt, setBulkPrompt] = useState('');
  const [bulkDrafts, setBulkDrafts] = useState<BulkDraftTask[]>([]);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkEditingIndex, setBulkEditingIndex] = useState<number | null>(null);
  const [bulkRewritingKey, setBulkRewritingKey] = useState<string | null>(null);

  const memberOptions = members.filter((member) => member.role !== 'leader');
  const syncUserOptions = members;
  const syncUserOptionsWithMe =
    session?.user?.role === 'leader' && session?.user?.id
      ? [
          {
            id: session.user.id,
            name: session.user.name || 'Me',
            role: 'leader',
          },
          ...syncUserOptions,
        ]
      : syncUserOptions;
  const projectFilterOptions: FilterOption[] = projects.map((project) => ({
    value: project.id,
    label: `${project.emoji} ${project.name}`,
  }));
  const memberFilterOptions: FilterOption[] = members.map((member) => ({
    value: member.id,
    label: member.name,
  }));
  const memberFilterOptionsWithMe: FilterOption[] =
    session?.user?.role === 'leader' && session?.user?.id
      ? [
          {
            value: session.user.id,
            label: `${session.user.name || 'Me'} (Me)`,
          },
          ...memberFilterOptions,
        ]
      : memberFilterOptions;
  const syncUserSelectOptions: SyncUserOption[] = syncUserOptionsWithMe.map((member) => ({
    value: member.id,
    label: `${member.name}${member.id === session?.user?.id ? ' (Me)' : ''}`,
  }));
  const syncAllowedUserIds = new Set(syncUserSelectOptions.map((option) => option.value));

  const bulkAssigneeOptions: Array<{ id: string; name: string }> = (() => {
    const base = members.map((member) => ({ id: member.id, name: member.name }));
    const meId = session?.user?.id;
    if (!meId) return base;
    const hasMe = base.some((item) => item.id === meId);
    if (hasMe) {
      return base.map((item) =>
        item.id === meId ? { ...item, name: `${item.name} (Me)` } : item
      );
    }
    return [{ id: meId, name: `${session?.user?.name || 'Me'} (Me)` }, ...base];
  })();

  const normalizeSyncUserIds = (ids: string[]) => {
    const normalized = Array.from(new Set(ids.filter((id) => syncAllowedUserIds.has(id))));
    return normalized;
  };

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState('todo');
  const [priority, setPriority] = useState('high');
  const [timeUsedHours, setTimeUsedHours] = useState('');
  const [timeAutoCalculatedInForm, setTimeAutoCalculatedInForm] = useState(false);
  const [date, setDate] = useState(todayDate);
  const shouldShowTimeUsedField = editingTask ? true : status === 'done';

  // Filter
  const [filterDate, setFilterDate] = useState(todayDate);
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterUserIds, setFilterUserIds] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<'project' | 'member'>('project');

  const fetchTasks = async () => {
    const params = new URLSearchParams();
    if (filterDate) params.set('date', filterDate);
    filterProjectIds.forEach((projectId) => params.append('projectIds', projectId));
    if (isManager) {
      filterUserIds.forEach((userId) => params.append('userIds', userId));
    }
    const res = await fetch(`/api/tasks?${params}`);
    const data = await res.json();
    setTasks(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const fetchProjects = async () => {
    const projectsEndpoint =
      session?.user?.role === 'leader' || session?.user?.role === 'member'
        ? '/api/my-projects'
        : '/api/projects';
    const res = await fetch(projectsEndpoint);
    const data = await res.json();
    setProjects(Array.isArray(data) ? data : []);
  };

  const fetchMembers = async () => {
    if (!isManager) return;
    const res = await fetch('/api/members');
    if (!res.ok) return;
    const data = await res.json();
    setMembers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchProjects();
  }, [session?.user?.role]);

  useEffect(() => {
    const queryDate = searchParams.get('date');
    const queryProjectId = searchParams.get('projectId');
    const queryProjectIds = searchParams.getAll('projectIds');
    const mergedProjectIds = queryProjectIds.length > 0
      ? queryProjectIds
      : (searchParams.get('projectIds')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []);
    const queryUserId = searchParams.get('userId');
    const queryUserIds = searchParams.getAll('userIds');
    const mergedUserIds = queryUserIds.length > 0
      ? queryUserIds
      : (searchParams.get('userIds')?.split(',').map((v) => v.trim()).filter(Boolean) ?? []);

    if (queryDate) setFilterDate(queryDate);
    if (mergedProjectIds.length > 0) setFilterProjectIds(mergedProjectIds);
    else if (queryProjectId) setFilterProjectIds([queryProjectId]);

    if (isManager) {
      if (mergedUserIds.length > 0) setFilterUserIds(mergedUserIds);
      else if (queryUserId) setFilterUserIds([queryUserId]);
    }
  }, [searchParams, isManager]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedProjectId = localStorage.getItem(LAST_PROJECT_KEY);
    if (savedProjectId) {
      setProjectId(savedProjectId);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!projectId) return;
    localStorage.setItem(LAST_PROJECT_KEY, projectId);
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
  }, [filterDate, filterProjectIds, filterUserIds, session?.user?.role]);

  useEffect(() => {
    fetchMembers();
  }, [session?.user?.role]);

  useEffect(() => {
    const loadAiSettings = async () => {
      try {
        const res = await fetch('/api/settings/ai');
        if (!res.ok) return;
        const data = await res.json();
        setAiEnabled(Boolean(data?.aiEnabled && data?.hasApiKey));
      } catch {
        setAiEnabled(false);
      }
    };

    loadAiSettings();
  }, []);

  useEffect(() => {
    if (!isManager) {
      setFilterUserIds([]);
    }
  }, [isManager]);

  const openCreate = () => {
    setEditingTask(null);
    setTitle('');
    setDescription('');
    const currentOrFilteredProjectId = projectId || filterProjectIds[0] || '';
    const preferredProjectId =
      currentOrFilteredProjectId && projects.some((p) => p.id === currentOrFilteredProjectId)
        ? currentOrFilteredProjectId
        : projects[0]?.id || '';
    setProjectId(preferredProjectId);
    const defaultAssigneeId = isManager
      ? (filterUserIds[0] || session?.user?.id || members[0]?.id || '')
      : '';
    setAssigneeId(defaultAssigneeId);
    setStatus('todo');
    setPriority('high');
    setTimeUsedHours('');
    setTimeAutoCalculatedInForm(false);
    setDate(filterDate || todayDate);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || '');
    setProjectId(task.project.id);
    setAssigneeId(task.user.id);
    setStatus(task.status);
    setPriority(task.priority || 'high');
    setTimeUsedHours(formatHoursForInput(task.timeUsedHours));
    setTimeAutoCalculatedInForm(Boolean(task.timeAutoCalculated));
    setDate(toDateInputValue(task.date));
    setModalOpen(true);
  };

  const formatDate = (isoDate: string) => {
    const d = new Date(isoDate);
    return d.toLocaleDateString();
  };

  const formatHoursForInput = (hours?: number | null) => {
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return '';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  const formatHoursForDisplay = (hours?: number | null) => {
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return '-';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };

  const parseTimeToHours = (value: string): number | null => {
    const raw = value.trim();
    if (!raw) return null;

    if (raw.includes(':')) {
      const match = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
      if (!match) return Number.NaN;
      const h = Number(match[1]);
      const m = Number(match[2]);
      if (!Number.isFinite(h) || !Number.isFinite(m) || m < 0 || m > 59) return Number.NaN;
      return Math.round((h + m / 60) * 100) / 100;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
    return Math.round(parsed * 100) / 100;
  };

  const getAutoCalculatedHours = (startIso?: string | null) => {
    if (!startIso) return null;
    const startedAt = new Date(startIso);
    if (Number.isNaN(startedAt.getTime())) return null;
    const diff = (Date.now() - startedAt.getTime()) / 36e5;
    return Math.max(0, Math.round(diff * 100) / 100);
  };

  const handleFormStatusChange = (nextStatus: string) => {
    const previousStatus = editingTask ? editingTask.status : status;
    setStatus(nextStatus);

    if (nextStatus === 'done' && previousStatus === 'in-progress') {
      const autoHours = getAutoCalculatedHours(editingTask?.inProgressStartedAt || null);
      if (autoHours !== null) {
        setTimeUsedHours(formatHoursForInput(autoHours));
        setTimeAutoCalculatedInForm(true);
      }
      return;
    }

    if (nextStatus !== 'done' && !editingTask) {
      setTimeUsedHours('');
      setTimeAutoCalculatedInForm(false);
    }
  };

  const openCompletionModal = (task: Task) => {
    const shouldAuto = task.status === 'in-progress';
    const autoHours = shouldAuto ? getAutoCalculatedHours(task.inProgressStartedAt || null) : null;

    setCompletionTask(task);
    setCompletionTimeUsedHours(formatHoursForInput(autoHours));
    setCompletionTimeAutoCalculated(autoHours !== null);
    setCompletionModalOpen(true);
  };

  const submitCompletion = async () => {
    if (!completionTask) return;

    setSavingCompletion(true);
    try {
      const payload: Record<string, unknown> = { status: 'done' };
      const parsedCompletionHours = parseTimeToHours(completionTimeUsedHours);
      if (Number.isNaN(parsedCompletionHours)) {
        throw new Error('Invalid time format. Use HH:MM (e.g. 1:30) or decimal (e.g. 1.5)');
      }
      if (parsedCompletionHours !== null) {
        payload.timeUsedHours = parsedCompletionHours;
      }

      const res = await fetch(`/api/tasks/${completionTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to update status');
      }

      toast.success('Status updated!');
      setCompletionModalOpen(false);
      setCompletionTask(null);
      setCompletionTimeUsedHours('');
      setCompletionTimeAutoCalculated(false);
      fetchTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status');
    }
    setSavingCompletion(false);
  };

  const fetchSyncCandidates = async () => {
    setSyncLoading(true);
    try {
      const params = new URLSearchParams({ targetDate: filterDate });
      if (isManager) {
        const safeSyncUserIds = normalizeSyncUserIds(syncUserIds);

        if (safeSyncUserIds.length === 0) {
          setSyncCandidates([]);
          setSelectedSyncTaskIds([]);
          setSyncLoading(false);
          return;
        }
        safeSyncUserIds.forEach((userId) => params.append('userIds', userId));
      }
      const res = await fetch(`/api/tasks/sync?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load pending tasks');
      }

      const candidates = Array.isArray(data) ? data : [];
      setSyncCandidates(candidates);
      setSelectedSyncTaskIds(candidates.map((task) => task.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load pending tasks');
      setSyncCandidates([]);
      setSelectedSyncTaskIds([]);
    }
    setSyncLoading(false);
  };

  const openSyncModal = async () => {
    if (isManager) {
      const candidateIds = filterUserIds.length > 0
        ? filterUserIds
        : (isAdmin
            ? syncUserOptions.map((user) => user.id)
            : (memberOptions.length > 0
                ? memberOptions.map((member) => member.id)
                : syncUserOptionsWithMe.map((user) => user.id)));
      const defaultUserIds = normalizeSyncUserIds(candidateIds);
      setSyncUserIds(defaultUserIds);
    }
    setSyncModalOpen(true);
    if (!isManager) {
      await fetchSyncCandidates();
    }
  };

  const handleSyncUserSelectionChange = (selected: MultiValue<SyncUserOption>) => {
    setSyncUserIds(normalizeSyncUserIds(selected.map((item) => item.value)));
  };

  const selectAllMembersForSync = () => {
    setSyncUserIds(normalizeSyncUserIds(memberOptions.map((member) => member.id)));
  };

  const selectAllUsersForSync = () => {
    setSyncUserIds(normalizeSyncUserIds(syncUserOptionsWithMe.map((member) => member.id)));
  };

  const toggleSyncTaskSelection = (taskId: string) => {
    setSelectedSyncTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAllSyncCandidates = () => {
    if (selectedSyncTaskIds.length === syncCandidates.length) {
      setSelectedSyncTaskIds([]);
      return;
    }
    setSelectedSyncTaskIds(syncCandidates.map((task) => task.id));
  };

  const handleSyncTasks = async () => {
    if (selectedSyncTaskIds.length === 0) {
      toast.error('Select at least one task to transfer');
      return;
    }

    setSyncing(true);
    try {
      const safeSyncUserIds = normalizeSyncUserIds(syncUserIds);
      const res = await fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate: filterDate,
          taskIds: selectedSyncTaskIds,
          ...(isManager ? { userIds: safeSyncUserIds } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to transfer tasks');
      }

      toast.success(`Transferred ${data?.transferredCount ?? selectedSyncTaskIds.length} task(s)`);
      setSyncModalOpen(false);
      fetchTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to transfer tasks');
    }
    setSyncing(false);
  };

  useEffect(() => {
    if (!syncModalOpen) return;
    fetchSyncCandidates();
  }, [syncModalOpen, syncUserIds]);

  const rewriteText = async (field: 'title' | 'description') => {
    const currentText = field === 'title' ? title : description;
    if (!currentText.trim()) {
      toast.error(`Enter ${field} first`);
      return;
    }

    setRewritingField(field);
    try {
      const res = await fetch('/api/ai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, text: currentText }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to rewrite text');
      }

      const rewritten = typeof data?.rewritten === 'string' ? data.rewritten : '';
      if (!rewritten) {
        throw new Error('No rewritten text returned');
      }

      if (field === 'title') {
        setTitle(rewritten);
      } else {
        setDescription(rewritten);
      }

      toast.success(`${field === 'title' ? 'Title' : 'Description'} improved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rewrite text');
    }
    setRewritingField(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedTimeUsedHours = parseTimeToHours(timeUsedHours);
      if (Number.isNaN(parsedTimeUsedHours)) {
        throw new Error('Invalid time format. Use HH:MM (e.g. 1:30) or decimal (e.g. 1.5)');
      }

      if (editingTask) {
        const payload = {
          title,
          description,
          projectId,
          status,
          priority,
          timeUsedHours: parsedTimeUsedHours === null ? undefined : parsedTimeUsedHours,
          date,
          ...(isManager && assigneeId ? { userId: assigneeId } : {}),
        };
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to update task');
        }
        toast.success('Task updated!');
      } else {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description,
            projectId,
            status,
            priority,
            timeUsedHours: parsedTimeUsedHours === null ? undefined : parsedTimeUsedHours,
            date,
            ...(isManager && assigneeId ? { userId: assigneeId } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to create task');
        }
        toast.success('Task created!');
      }
      setModalOpen(false);
      fetchTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save task');
    }
  };

  const openBulkModal = () => {
    setBulkPrompt('');
    setBulkDrafts([]);
    setBulkEditingIndex(null);
    setBulkModalOpen(true);
  };

  const generateBulkDrafts = async () => {
    if (!bulkPrompt.trim()) {
      toast.error('Please describe tasks first');
      return;
    }

    setBulkGenerating(true);
    try {
      const defaultProjectId = projectId || filterProjectIds[0] || projects[0]?.id || '';
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          prompt: bulkPrompt,
          defaultProjectId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate bulk task list');
      }

      const drafts = Array.isArray(data?.drafts) ? data.drafts : [];
      setBulkDrafts(drafts);
      toast.success(`Generated ${drafts.length} task(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate bulk task list');
      setBulkDrafts([]);
    }
    setBulkGenerating(false);
  };

  const removeBulkDraftAt = (index: number) => {
    setBulkDrafts((prev) => prev.filter((_, idx) => idx !== index));
    setBulkEditingIndex((prev) => {
      if (prev === null) return prev;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  const updateBulkDraftField = <K extends keyof BulkDraftTask>(
    index: number,
    field: K,
    value: BulkDraftTask[K]
  ) => {
    setBulkDrafts((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  };

  const handleBulkProjectChange = (index: number, nextProjectId: string) => {
    const selected = projects.find((project) => project.id === nextProjectId);
    if (!selected) return;
    setBulkDrafts((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              projectId: selected.id,
              projectName: selected.name,
              projectEmoji: selected.emoji,
            }
          : item
      )
    );
  };

  const handleBulkAssigneeChange = (index: number, nextUserId: string) => {
    const selected = bulkAssigneeOptions.find((member) => member.id === nextUserId);
    if (!selected) return;
    setBulkDrafts((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? {
              ...item,
              userId: selected.id,
              userName: selected.name,
            }
          : item
      )
    );
  };

  const rewriteBulkDraftField = async (index: number, field: 'title' | 'description') => {
    const draft = bulkDrafts[index];
    if (!draft) return;

    const currentText = field === 'title' ? draft.title : (draft.description || '');
    if (!currentText.trim()) {
      toast.error(`Enter ${field} first`);
      return;
    }

    const rewriteKey = `${index}:${field}`;
    setBulkRewritingKey(rewriteKey);
    try {
      const res = await fetch('/api/ai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, text: currentText }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to rewrite text');
      }

      const rewritten = typeof data?.rewritten === 'string' ? data.rewritten : '';
      if (!rewritten.trim()) {
        throw new Error('No rewritten text returned');
      }

      updateBulkDraftField(index, field, rewritten.trim());
      toast.success(`${field === 'title' ? 'Title' : 'Description'} improved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rewrite text');
    }
    setBulkRewritingKey(null);
  };

  const confirmBulkCreate = async () => {
    if (bulkDrafts.length === 0) {
      toast.error('No task left to create');
      return;
    }

    setBulkCreating(true);
    try {
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          date: filterDate,
          tasks: bulkDrafts,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create bulk tasks');
      }

      toast.success(`Created ${data?.createdCount ?? bulkDrafts.length} task(s)`);
      setBulkModalOpen(false);
      setBulkPrompt('');
      setBulkDrafts([]);
      setBulkEditingIndex(null);
      fetchTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create bulk tasks');
    }
    setBulkCreating(false);
  };

  const updateStatus = async (task: Task, newStatus: string) => {
    if (newStatus === 'done' && task.status !== 'done') {
      openCompletionModal(task);
      return;
    }

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success('Status updated!');
      fetchTasks();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingTask(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Task deleted');
      fetchTasks();
      setDeletingTaskId(null);
    } catch {
      toast.error('Failed to delete task');
    }
    setDeletingTask(false);
  };

  // Group tasks by selected mode
  const groupedByProject: Record<string, { project: Project; tasks: Task[] }> = {};
  const groupedByMember: Record<string, { member: Task['user']; tasks: Task[] }> = {};

  for (const task of tasks) {
    if (!groupedByProject[task.project.id]) {
      groupedByProject[task.project.id] = { project: task.project, tasks: [] };
    }
    groupedByProject[task.project.id].tasks.push(task);

    if (!groupedByMember[task.user.id]) {
      groupedByMember[task.user.id] = { member: task.user, tasks: [] };
    }
    groupedByMember[task.user.id].tasks.push(task);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
            <p className="text-gray-500 mt-1">Manage and track your tasks</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <Calendar size={16} className="text-gray-400" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="outline-none text-sm text-gray-700 bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <FolderKanban size={16} className="text-gray-400" />
              <div className="min-w-[220px]">
                <Select
                  isMulti
                  options={projectFilterOptions}
                  value={projectFilterOptions.filter((option) => filterProjectIds.includes(option.value))}
                  onChange={(selected) => setFilterProjectIds(selected.map((item) => item.value))}
                  placeholder="All projects"
                  className="text-sm"
                  classNamePrefix="task-project-filter"
                  styles={boxedMultiSelectStyles}
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <ListTodo size={16} className="text-gray-400" />
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'project' | 'member')}
                className="outline-none text-sm text-gray-700 bg-transparent min-w-[170px]"
              >
                <option value="project">Group by project</option>
                <option value="member">Group by member</option>
              </select>
            </div>
            {isManager && (
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <User size={16} className="text-gray-400" />
                <div className="min-w-[220px]">
                  <Select
                    isMulti
                    options={memberFilterOptionsWithMe}
                    value={memberFilterOptionsWithMe.filter((option) => filterUserIds.includes(option.value))}
                    onChange={(selected) => setFilterUserIds(selected.map((item) => item.value))}
                    placeholder="All members (or Me)"
                    className="text-sm"
                    classNamePrefix="task-member-filter"
                    styles={boxedMultiSelectStyles}
                    menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                  />
                </div>
              </div>
            )}
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
            >
              <Plus size={18} />
              Add Task
            </button>
            {aiEnabled && (
              <button
                onClick={openBulkModal}
                className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
              >
                <Sparkles size={16} />
                Add Bulk Task
              </button>
            )}
            {(session?.user?.role === 'member' || isManager) && (
              <button
                onClick={openSyncModal}
                className="flex items-center gap-2 bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                <RefreshCw size={16} />
                Sync Pending
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <ListTodo size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No tasks for this date.</p>
            <button
              onClick={openCreate}
              className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              Add your first task →
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {(groupBy === 'project'
              ? Object.values(groupedByProject).map((group) => ({
                  key: group.project.id,
                  titleIcon: group.project.emoji,
                  title: group.project.name,
                  tasks: group.tasks,
                  showByMember: true,
                }))
              : Object.values(groupedByMember).map((group) => ({
                  key: group.member.id,
                  titleIcon: '👤',
                  title: group.member.name,
                  tasks: group.tasks,
                  showByMember: false,
                }))
            ).map(({ key, titleIcon, title, tasks: groupTasks, showByMember }) => (
              <div
                key={key}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <span>{titleIcon}</span>
                    {title}
                    <span className="text-xs text-gray-400 font-normal">
                      ({groupTasks.length} task{groupTasks.length !== 1 ? 's' : ''})
                    </span>
                  </h2>
                </div>
                <div className="hidden md:grid grid-cols-[minmax(0,1fr)_140px_190px_170px] gap-3 px-5 py-2 bg-gray-50/70 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <span>Task</span>
                  <span>Priority</span>
                  <span>Completed Time (hours)</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {groupTasks.map((task) => (
                    (() => {
                      const isTransferred = Boolean(task.transferredToDate);
                      return (
                    <div
                      key={task.id}
                      className="px-5 py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_190px_170px] gap-3 items-center hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p
                          className="text-sm font-medium text-gray-900 truncate"
                          title={task.description || task.title}
                        >
                          {task.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {showByMember ? `by ${task.user.name}` : `${task.project.emoji} ${task.project.name}`}
                          {isTransferred && task.transferredToDate
                            ? ` • 🔁 Transferred to ${formatDate(task.transferredToDate)}`
                            : ''}
                        </p>
                      </div>

                      <div className="text-sm text-gray-700 md:text-gray-600">
                        <span className="md:hidden text-xs text-gray-400 mr-1">Priority:</span>
                        {(task.priority || 'high').toUpperCase()}
                      </div>

                      <div className="text-sm text-gray-700 md:text-gray-600">
                        <span className="md:hidden text-xs text-gray-400 mr-1">Completed Time (hours):</span>
                        {formatHoursForDisplay(task.timeUsedHours)}
                        {task.timeAutoCalculated ? <span className="text-[11px] text-blue-600 ml-1">auto</span> : null}
                      </div>

                      <div className="flex items-center gap-2 md:justify-end">
                        <select
                          value={task.status}
                          onChange={(e) => updateStatus(task, e.target.value)}
                          disabled={isTransferred}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary-500 bg-white cursor-pointer"
                        >
                          {task.status === 'todo' && <option value="todo">📋 To Do</option>}
                          <option value="in-progress">🔄 In Progress</option>
                          <option value="pause">⏸️ Pause</option>
                          <option value="done">✅ Done</option>
                        </select>
                        <button
                          onClick={() => openEdit(task)}
                          disabled={isTransferred}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingTaskId(task.id)}
                          disabled={isTransferred}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingTask ? 'Edit Task' : 'Add Task'}
          size="2xl"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Task Title
                </label>
                {aiEnabled && (
                  <button
                    type="button"
                    onClick={() => rewriteText('title')}
                    disabled={rewritingField === 'title'}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                  >
                    <Sparkles size={12} />
                    {rewritingField === 'title' ? 'Improving...' : 'AI Improve'}
                  </button>
                )}
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement login feature"
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Description (optional)
                </label>
                {aiEnabled && (
                  <button
                    type="button"
                    onClick={() => rewriteText('description')}
                    disabled={rewritingField === 'description'}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                  >
                    <Sparkles size={12} />
                    {rewritingField === 'description' ? 'Improving...' : 'AI Improve'}
                  </button>
                )}
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details for this task..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              >
                <option value="">Select project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji} {p.name}
                  </option>
                ))}
              </select>
            </div>

            {isManager && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Assign To
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  <option value="">Select assignee...</option>
                  {session?.user?.role === 'leader' && session?.user?.id && (
                    <option value={session.user.id}>{session.user.name || 'Me'} (Me)</option>
                  )}
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => handleFormStatusChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  {(status === 'todo' || !editingTask || editingTask.status === 'todo') && (
                    <option value="todo">📋 To Do</option>
                  )}
                  <option value="in-progress">🔄 In Progress</option>
                  <option value="pause">⏸️ Pause</option>
                  <option value="done">✅ Done</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  <option value="high">🔴 High</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="low">🟢 Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                />
              </div>
            </div>

            {shouldShowTimeUsedField && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    Time Used (hours)
                  </label>
                  {timeAutoCalculatedInForm && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      Auto-calculated
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={timeUsedHours}
                  onChange={(e) => {
                    setTimeUsedHours(e.target.value);
                    setTimeAutoCalculatedInForm(false);
                  }}
                  placeholder="e.g. 1:30 or 1.5"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  When status changes from In Progress to Done, time is auto-counted. You can still edit it manually.
                </p>
              </div>
            )}

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
                {editingTask ? 'Update' : 'Add'} Task
              </button>
            </div>
          </form>
        </Modal>

        <ConfirmModal
          isOpen={Boolean(deletingTaskId)}
          title="Delete Task"
          message="Delete this task?"
          confirmText="Delete"
          isLoading={deletingTask}
          onClose={() => {
            if (deletingTask) return;
            setDeletingTaskId(null);
          }}
          onConfirm={() => {
            if (!deletingTaskId) return;
            handleDelete(deletingTaskId);
          }}
        />

        <Modal
          isOpen={completionModalOpen}
          onClose={() => {
            if (savingCompletion) return;
            setCompletionModalOpen(false);
          }}
          title={completionTask ? `Complete Task: ${completionTask.title}` : 'Complete Task'}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Mark this task as done. You can set completion time now.
            </p>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Completed Time (hours)</label>
                {completionTimeAutoCalculated && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                    Auto-calculated (In Progress → Done)
                  </span>
                )}
              </div>
              <input
                type="text"
                value={completionTimeUsedHours}
                onChange={(e) => {
                  setCompletionTimeUsedHours(e.target.value);
                  setCompletionTimeAutoCalculated(false);
                }}
                placeholder="e.g. 1:30 or 1.5"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                If task moved from To Do → Done, auto calculation is not applied.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCompletionModalOpen(false)}
                disabled={savingCompletion}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCompletion}
                disabled={savingCompletion}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {savingCompletion ? 'Saving...' : 'Mark Done'}
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={syncModalOpen}
          onClose={() => setSyncModalOpen(false)}
          title={`Sync Pending Tasks to ${formatDate(filterDate)}`}
          size="2xl"
        >
          <div className="space-y-4">
            {isManager && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    Select Member(s)
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={selectAllMembersForSync}
                      className="text-primary-600 hover:text-primary-700 font-medium"
                    >
                      All members
                    </button>
                    <button
                      type="button"
                      onClick={selectAllUsersForSync}
                      className="text-primary-600 hover:text-primary-700 font-medium"
                    >
                      {isAdmin ? 'Include leaders' : 'Include me'}
                    </button>
                  </div>
                </div>
                <Select
                  isMulti
                  closeMenuOnSelect={false}
                  placeholder="Select members..."
                  options={syncUserSelectOptions}
                  value={syncUserSelectOptions.filter((option) => syncUserIds.includes(option.value))}
                  onChange={handleSyncUserSelectionChange}
                  className="text-sm"
                  classNamePrefix="sync-user-select"
                  styles={modalMultiSelectStyles}
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                />
              </div>
            )}

            {syncLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : isManager && syncUserIds.length === 0 ? (
              <div className="text-center py-8">
                <ListTodo size={36} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">Select one or more members to load pending tasks.</p>
              </div>
            ) : syncCandidates.length === 0 ? (
              <div className="text-center py-8">
                <ListTodo size={36} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">No pending todo/in-progress tasks from previous dates.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <p className="text-gray-600">
                    Select tasks to copy into <span className="font-medium text-gray-900">{formatDate(filterDate)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={toggleSelectAllSyncCandidates}
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {selectedSyncTaskIds.length === syncCandidates.length ? 'Unselect all' : 'Select all'}
                  </button>
                </div>

                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {syncCandidates.map((task) => (
                    <label
                      key={task.id}
                      className="flex items-start gap-3 p-3 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSyncTaskIds.includes(task.id)}
                        onChange={() => toggleSyncTaskSelection(task.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{task.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {task.project.emoji} {task.project.name} • {formatDate(task.date)}
                          {task.user?.name ? ` • 👤 ${task.user.name}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-gray-600 bg-gray-100 rounded-full px-2 py-0.5">
                        {task.status === 'in-progress'
                          ? '🔄 In Progress'
                          : task.status === 'pause'
                            ? '⏸️ Pause'
                            : '📋 To Do'}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSyncModalOpen(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                    disabled={syncing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncTasks}
                    disabled={syncing || selectedSyncTaskIds.length === 0}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-60"
                  >
                    {syncing ? 'Transferring...' : `Transfer ${selectedSyncTaskIds.length} Task(s)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>

        <Modal
          isOpen={bulkModalOpen}
          onClose={() => {
            if (bulkGenerating || bulkCreating) return;
            setBulkEditingIndex(null);
            setBulkModalOpen(false);
          }}
          title="Add Bulk Task (AI)"
          size="2xl"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Describe tasks
              </label>
              <textarea
                value={bulkPrompt}
                onChange={(e) => setBulkPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. create app key for NuPath, do login screen for OMD AI, DCN project test"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Leader can mention member name. If name is not under leader, it will assign to self.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={generateBulkDrafts}
                disabled={bulkGenerating || bulkCreating}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {bulkGenerating ? 'Generating...' : 'Generate Task List'}
              </button>
            </div>

            {bulkDrafts.length > 0 && (
              <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1 border border-gray-100 rounded-lg p-2">
                {bulkDrafts.map((draft, index) => (
                  <div key={`${draft.title}-${index}`} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {bulkEditingIndex === index ? (
                          <div className="space-y-2">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-gray-600">Title</span>
                                {aiEnabled && (
                                  <button
                                    type="button"
                                    onClick={() => rewriteBulkDraftField(index, 'title')}
                                    disabled={bulkGenerating || bulkCreating || bulkRewritingKey === `${index}:title`}
                                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                                  >
                                    <Sparkles size={11} />
                                    {bulkRewritingKey === `${index}:title` ? 'Improving...' : 'AI Improve'}
                                  </button>
                                )}
                              </div>
                              <input
                                type="text"
                                value={draft.title}
                                onChange={(e) => updateBulkDraftField(index, 'title', e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-gray-600">Description</span>
                                {aiEnabled && (
                                  <button
                                    type="button"
                                    onClick={() => rewriteBulkDraftField(index, 'description')}
                                    disabled={bulkGenerating || bulkCreating || bulkRewritingKey === `${index}:description`}
                                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                                  >
                                    <Sparkles size={11} />
                                    {bulkRewritingKey === `${index}:description` ? 'Improving...' : 'AI Improve'}
                                  </button>
                                )}
                              </div>
                              <textarea
                                value={draft.description || ''}
                                onChange={(e) => updateBulkDraftField(index, 'description', e.target.value)}
                                rows={2}
                                placeholder="Optional description"
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <select
                                value={draft.projectId}
                                onChange={(e) => handleBulkProjectChange(index, e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              >
                                {projects.map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.emoji} {project.name}
                                  </option>
                                ))}
                              </select>
                              {isManager ? (
                                <select
                                  value={draft.userId}
                                  onChange={(e) => handleBulkAssigneeChange(index, e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                >
                                  {bulkAssigneeOptions.map((member) => (
                                    <option key={member.id} value={member.id}>
                                      {member.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={draft.userName}
                                  disabled
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600"
                                />
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-1 pt-1">
                              <button
                                type="button"
                                onClick={() => setBulkEditingIndex(null)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                                title="Done editing"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeBulkDraftAt(index)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                                title="Delete task from confirmation list"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-gray-900 break-words">{draft.title}</p>
                            {draft.description ? (
                              <p className="text-xs text-gray-500 mt-1 break-words">{draft.description}</p>
                            ) : null}
                            <p className="text-xs text-gray-500 mt-1">
                              {draft.projectEmoji} {draft.projectName} • 👤 {draft.userName}
                            </p>
                          </>
                        )}
                      </div>
                      {bulkEditingIndex !== index && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setBulkEditingIndex(index)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                            title="Edit task"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBulkDraftAt(index)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete task from confirmation list"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                disabled={bulkGenerating || bulkCreating}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkCreate}
                disabled={bulkGenerating || bulkCreating || bulkDrafts.length === 0}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {bulkCreating ? 'Creating...' : `Confirm ${bulkDrafts.length} Task(s)`}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
