'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import toast from 'react-hot-toast';
import {
  FolderKanban,
  Plus,
  ArrowRight,
  ArrowLeft,
  GripVertical,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  emoji: string;
  totalCount?: number;
  todayCount?: number;
  _count?: { tasks: number };
}

export default function MyProjectsPage() {
  const { data: session } = useSession();
  const isLeader = session?.user?.role === 'leader';

  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectorModalOpen, setSelectorModalOpen] = useState(false);
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([]);
  const [leftActiveProjectId, setLeftActiveProjectId] = useState<string>('');
  const [rightActiveProjectId, setRightActiveProjectId] = useState<string>('');
  const [draggedSelectedProjectId, setDraggedSelectedProjectId] = useState<string | null>(null);
  const [draggedModalSelectedProjectId, setDraggedModalSelectedProjectId] = useState<string | null>(null);
  const [draggedModalProjectId, setDraggedModalProjectId] = useState<string | null>(null);
  const [draggedModalSource, setDraggedModalSource] = useState<'left' | 'right' | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const tempSelectedSet = useMemo(() => new Set(tempSelectedIds), [tempSelectedIds]);

  const selectedProjects = useMemo(
    () => selectedIds
      .map((id) => allProjects.find((project) => project.id === id))
      .filter((project): project is Project => Boolean(project)),
    [allProjects, selectedIds]
  );

  const modalSelectedProjects = useMemo(
    () => tempSelectedIds
      .map((id) => allProjects.find((project) => project.id === id))
      .filter((project): project is Project => Boolean(project)),
    [allProjects, tempSelectedIds]
  );

  const modalUnselectedProjects = useMemo(
    () => allProjects.filter((project) => !tempSelectedSet.has(project.id)),
    [allProjects, tempSelectedSet]
  );

  const fetchData = async () => {
    setLoading(true);
    try {
      const [allRes, mineRes] = await Promise.all([
        fetch('/api/projects?scope=all'),
        fetch('/api/my-projects'),
      ]);

      const [allData, mineData] = await Promise.all([allRes.json(), mineRes.json()]);
      const normalizedAll = Array.isArray(allData) ? allData : [];
      const normalizedMine = Array.isArray(mineData) ? mineData : [];

      setAllProjects(normalizedAll);
      setSelectedIds(normalizedMine.map((p: Project) => p.id));
    } catch {
      setAllProjects([]);
      setSelectedIds([]);
      toast.error('Failed to load projects');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openSelectorModal = () => {
    setTempSelectedIds(selectedIds);
    setLeftActiveProjectId('');
    setRightActiveProjectId('');
    setSelectorModalOpen(true);
  };

  const saveSelection = async (projectIds: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/my-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update my projects');
      }

      toast.success('My projects updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update my projects');
    }
    setSaving(false);
  };

  const addFromLeftToRight = () => {
    if (!leftActiveProjectId) return;
    if (tempSelectedSet.has(leftActiveProjectId)) return;
    setTempSelectedIds((prev) => [...prev, leftActiveProjectId]);
    setRightActiveProjectId(leftActiveProjectId);
    setLeftActiveProjectId('');
  };

  const removeFromRightToLeft = () => {
    if (!rightActiveProjectId) return;
    setTempSelectedIds((prev) => prev.filter((id) => id !== rightActiveProjectId));
    setLeftActiveProjectId(rightActiveProjectId);
    setRightActiveProjectId('');
  };

  const handleModalDragStart = (projectId: string) => {
    setDraggedModalSelectedProjectId(projectId);
    setDraggedModalProjectId(projectId);
    setDraggedModalSource('right');
    setRightActiveProjectId(projectId);
  };

  const handleModalDropOnProject = (targetProjectId: string) => {
    if (!draggedModalSelectedProjectId || draggedModalSelectedProjectId === targetProjectId) return;

    setTempSelectedIds((prev) => {
      const fromIndex = prev.indexOf(draggedModalSelectedProjectId);
      const toIndex = prev.indexOf(targetProjectId);
      if (fromIndex < 0 || toIndex < 0) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });

    setDraggedModalSelectedProjectId(null);
    setDraggedModalProjectId(null);
    setDraggedModalSource(null);
  };

  const handleModalDragStartFromLeft = (projectId: string) => {
    setDraggedModalProjectId(projectId);
    setDraggedModalSource('left');
    setDraggedModalSelectedProjectId(null);
    setLeftActiveProjectId(projectId);
  };

  const handleDropOnSelectedContainer = () => {
    if (!draggedModalProjectId || draggedModalSource !== 'left') return;
    if (tempSelectedSet.has(draggedModalProjectId)) return;

    setTempSelectedIds((prev) => [...prev, draggedModalProjectId]);
    setRightActiveProjectId(draggedModalProjectId);
    setLeftActiveProjectId('');
    setDraggedModalProjectId(null);
    setDraggedModalSource(null);
  };

  const handleDropOnUnselectedContainer = () => {
    if (!draggedModalProjectId || draggedModalSource !== 'right') return;
    if (!tempSelectedSet.has(draggedModalProjectId)) return;

    setTempSelectedIds((prev) => prev.filter((id) => id !== draggedModalProjectId));
    setLeftActiveProjectId(draggedModalProjectId);
    setRightActiveProjectId('');
    setDraggedModalSelectedProjectId(null);
    setDraggedModalProjectId(null);
    setDraggedModalSource(null);
  };

  const handleModalDragEnd = () => {
    setDraggedModalSelectedProjectId(null);
    setDraggedModalProjectId(null);
    setDraggedModalSource(null);
  };

  const applySelectionFromModal = async () => {
    setSelectedIds(tempSelectedIds);
    setSelectorModalOpen(false);
    await saveSelection(tempSelectedIds);
  };

  const handleDragStart = (projectId: string) => {
    setDraggedSelectedProjectId(projectId);
  };

  const handleDropOnProject = (targetProjectId: string) => {
    if (!draggedSelectedProjectId || draggedSelectedProjectId === targetProjectId) return;

    const fromIndex = selectedIds.findIndex((id) => id === draggedSelectedProjectId);
    const toIndex = selectedIds.findIndex((id) => id === targetProjectId);
    if (fromIndex < 0 || toIndex < 0) return;

    const next = [...selectedIds];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSelectedIds(next);
    setDraggedSelectedProjectId(null);
    saveSelection(next);
  };

  if (!isLeader) {
    return (
      <DashboardLayout>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
          <p className="text-gray-600">Only leaders can access My Project.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Project</h1>
            <p className="text-gray-500 mt-1">Set your selected projects. Priority auto-saves when you drag.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openSelectorModal}
              disabled={loading}
              className="flex items-center gap-2 bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60 text-sm font-medium"
            >
              <Plus size={16} />
              Select Project
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : allProjects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <FolderKanban size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No projects available.</p>
          </div>
        ) : selectedProjects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <FolderKanban size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No selected projects yet.</p>
            <button
              onClick={openSelectorModal}
              className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              Select projects →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              Selected: <span className="font-semibold text-gray-900">{selectedIds.length}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedProjects.map((project, index) => (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={() => handleDragStart(project.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOnProject(project.id)}
                  onDragEnd={() => setDraggedSelectedProjectId(null)}
                  className={`bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow cursor-move ${draggedSelectedProjectId === project.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <GripVertical size={16} className="text-gray-300 mt-1" />
                      <span className="text-2xl">{project.emoji}</span>
                      <div>
                        <h3 className="font-semibold text-gray-900">{project.name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {(project.totalCount ?? project._count?.tasks ?? 0)} total • {(project.todayCount ?? 0)} today
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                      #{index + 1}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Modal
          isOpen={selectorModalOpen}
          onClose={() => setSelectorModalOpen(false)}
          title="Select Projects for My Project"
          size="3xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
              <div
                className="border border-gray-200 rounded-xl overflow-hidden"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropOnUnselectedContainer}
              >
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-sm font-medium text-gray-700">
                  Unselected Projects ({modalUnselectedProjects.length})
                </div>
                <div className="max-h-[48vh] overflow-y-auto divide-y divide-gray-100">
                  {modalUnselectedProjects.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-gray-500 text-center">All projects selected</p>
                  ) : (
                    modalUnselectedProjects.map((project) => (
                      <button
                        key={`left-${project.id}`}
                        type="button"
                        draggable
                        onDragStart={() => handleModalDragStartFromLeft(project.id)}
                        onDragEnd={handleModalDragEnd}
                        onClick={() => setLeftActiveProjectId(project.id)}
                        onDoubleClick={addFromLeftToRight}
                        className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 ${leftActiveProjectId === project.id ? 'bg-primary-50' : ''}`}
                      >
                        <span>{project.emoji}</span>
                        <span className="text-sm text-gray-800">{project.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-row lg:flex-col justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={addFromLeftToRight}
                  disabled={!leftActiveProjectId}
                  className="w-10 h-10 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center"
                >
                  <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={removeFromRightToLeft}
                  disabled={!rightActiveProjectId}
                  className="w-10 h-10 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center"
                >
                  <ArrowLeft size={16} />
                </button>
              </div>

              <div
                className="border border-gray-200 rounded-xl overflow-hidden"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropOnSelectedContainer}
              >
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-sm font-medium text-gray-700">
                  Selected Projects (Priority)
                </div>
                <div className="max-h-[48vh] overflow-y-auto divide-y divide-gray-100">
                  {modalSelectedProjects.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-gray-500 text-center">No selected projects</p>
                  ) : (
                    modalSelectedProjects.map((project, index) => (
                      <button
                        key={`right-${project.id}`}
                        type="button"
                        draggable
                        onDragStart={() => handleModalDragStart(project.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleModalDropOnProject(project.id)}
                        onDragEnd={handleModalDragEnd}
                        onClick={() => setRightActiveProjectId(project.id)}
                        onDoubleClick={removeFromRightToLeft}
                        className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2 cursor-move ${rightActiveProjectId === project.id ? 'bg-primary-50' : ''} ${draggedModalSelectedProjectId === project.id ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-primary-700 bg-primary-100 rounded-full px-2 py-0.5">
                            #{index + 1}
                          </span>
                          <span>{project.emoji}</span>
                          <span className="text-sm text-gray-800 truncate">{project.name}</span>
                        </div>
                        <GripVertical size={14} className="text-gray-300" />
                      </button>
                    ))
                  )}
                </div>
                <div className="p-2 border-t border-gray-100 bg-gray-50 text-right text-xs text-gray-500">
                  Drag selected projects to reorder priority
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectorModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applySelectionFromModal}
                disabled={saving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm font-medium"
              >
                {saving ? 'Saving...' : 'Apply Selection'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
