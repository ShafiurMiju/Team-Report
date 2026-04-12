'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Select, { StylesConfig } from 'react-select';
import DashboardLayout from '@/components/DashboardLayout';
import Modal from '@/components/Modal';
import ConfirmModal from '@/components/ConfirmModal';
import StatusBadge from '@/components/StatusBadge';
import toast from 'react-hot-toast';
import { Plus, Trash2, Users, Shield, User, Calendar, FolderKanban, ListTodo, Pencil } from 'lucide-react';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'leader' | 'member';
  leaderId?: string | null;
  createdAt: string;
  totalCount?: number;
  todayCount?: number;
  _count: { tasks: number };
}

interface Project {
  id: string;
  name: string;
  emoji: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  project: { id: string; name: string; emoji: string };
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

export default function TeamPage() {
  const { data: session } = useSession();
  const isLeader = session?.user?.role === 'leader';
  const isAdmin = session?.user?.role === 'admin';
  const isManager = isLeader || isAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberTasks, setMemberTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskFilterProjectIds, setTaskFilterProjectIds] = useState<string[]>([]);
    const projectFilterOptions: FilterOption[] = projects.map((project) => ({
      value: project.id,
      label: `${project.emoji} ${project.name}`,
    }));

  const [taskFilterDate, setTaskFilterDate] = useState(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<'leader' | 'member'>('member');
  const [selectedLeaderId, setSelectedLeaderId] = useState('');
  const [leaderFilterIds, setLeaderFilterIds] = useState<string[]>([]);

  const leaders = members.filter((m) => m.role === 'leader');
  const leaderFilterOptions: FilterOption[] = leaders.map((leader) => ({
    value: leader.id,
    label: leader.name,
  }));
  const filteredMembers = isAdmin && leaderFilterIds.length > 0
    ? members.filter(
        (member) => leaderFilterIds.includes(member.id) || (member.leaderId ? leaderFilterIds.includes(member.leaderId) : false)
      )
    : members;

  const fetchMembers = async () => {
    const res = await fetch('/api/members');
    const data = await res.json();
    setMembers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const fetchProjects = async () => {
    const res = await fetch('/api/projects');
    if (!res.ok) return;
    const data = await res.json();
    setProjects(Array.isArray(data) ? data : []);
  };

  const fetchMemberTasks = async (memberId: string, date: string, projectIds?: string[]) => {
    setTasksLoading(true);

    const params = new URLSearchParams({
      userId: memberId,
      date,
    });
    if (projectIds && projectIds.length > 0) {
      projectIds.forEach((projectId) => params.append('projectIds', projectId));
    }

    try {
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      setMemberTasks(Array.isArray(data) ? data : []);
    } catch {
      setMemberTasks([]);
      toast.error('Failed to load member tasks');
    }

    setTasksLoading(false);
  };

  const openMemberTasks = (member: Member) => {
    if (member.role === 'leader') return;
    setSelectedMember(member);
    setTaskFilterProjectIds([]);
    setTasksModalOpen(true);
    fetchMemberTasks(member.id, taskFilterDate);
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!tasksModalOpen || !selectedMember) return;
    fetchMemberTasks(selectedMember.id, taskFilterDate, taskFilterProjectIds);
  }, [taskFilterDate, taskFilterProjectIds, tasksModalOpen, selectedMember]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const shouldPickLeader = isAdmin && ((editingMember?.role === 'member') || (!editingMember && selectedRole === 'member'));
    if (shouldPickLeader && !selectedLeaderId) {
      toast.error('Please select a leader for this member');
      return;
    }

    try {
      const endpoint = editingMember ? `/api/members/${editingMember.id}` : '/api/members';
      const method = editingMember ? 'PUT' : 'POST';
      const payload = editingMember
        ? {
            name,
            email,
            ...(password ? { password } : {}),
            ...(isAdmin && editingMember.role === 'member' ? { leaderId: selectedLeaderId } : {}),
          }
        : {
            name,
            email,
            password,
            ...(isAdmin
              ? (selectedRole === 'member'
                  ? { role: 'member', leaderId: selectedLeaderId }
                  : { role: 'leader' })
              : {}),
          };

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(
        editingMember
          ? 'User updated!'
          : isAdmin
            ? selectedRole === 'member'
              ? 'Member added!'
              : 'Leader added!'
            : 'Team member added!'
      );
      setModalOpen(false);
      setEditingMember(null);
      setName('');
      setEmail('');
      setPassword('');
      setSelectedRole('member');
      setSelectedLeaderId('');
      fetchMembers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save member');
    }
  };

  const openCreate = () => {
    setEditingMember(null);
    setName('');
    setEmail('');
    setPassword('');
    setSelectedRole('member');
    setSelectedLeaderId('');
    setModalOpen(true);
  };

  const openEdit = (member: Member) => {
    setEditingMember(member);
    setName(member.name);
    setEmail(member.email);
    setPassword('');
    setSelectedRole(member.role === 'member' ? 'member' : 'leader');
    setSelectedLeaderId(member.leaderId || '');
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    setDeletingMember(true);
    try {
      const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Member removed');
      fetchMembers();
      setDeletingMemberId(null);
    } catch {
      toast.error('Failed to remove member');
    }
    setDeletingMember(false);
  };

  const treeLeaders: Member[] = isAdmin
    ? filteredMembers.filter((member) => member.role === 'leader')
    : isLeader && session?.user
      ? [{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          role: 'leader',
          createdAt: '',
          _count: { tasks: 0 },
          totalCount: 0,
          todayCount: 0,
        }]
      : [];

  const membersByLeader = filteredMembers
    .filter((member) => member.role === 'member')
    .reduce<Record<string, Member[]>>((acc, member) => {
      const key = member.leaderId || '__unassigned__';
      if (!acc[key]) acc[key] = [];
      acc[key].push(member);
      return acc;
    }, {});

  const unassignedMembers = isAdmin
    ? filteredMembers.filter(
        (member) =>
          member.role === 'member' &&
          (!member.leaderId || !treeLeaders.some((leader) => leader.id === member.leaderId))
      )
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
            <p className="text-gray-500 mt-1">Manage your team</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <div className="min-w-[260px] border border-gray-200 rounded-lg px-2 py-1 bg-white">
                <Select
                  isMulti
                  options={leaderFilterOptions}
                  value={leaderFilterOptions.filter((option) => leaderFilterIds.includes(option.value))}
                  onChange={(selected) => setLeaderFilterIds(selected.map((item) => item.value))}
                  placeholder="Filter by leaders"
                  className="text-sm"
                  classNamePrefix="team-leader-filter"
                  styles={boxedMultiSelectStyles}
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                />
              </div>
            )}

            {isManager && (
              <button
                onClick={openCreate}
                className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
              >
                <Plus size={18} />
                {isAdmin ? 'Add User' : 'Add Member'}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <Users size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No team members for selected leader.</p>
          </div>
        ) : isLeader ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tasks
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredMembers.map((member) => (
                  <tr
                    key={member.id}
                    role={member.role === 'member' ? 'button' : undefined}
                    tabIndex={member.role === 'member' ? 0 : -1}
                    onClick={() => openMemberTasks(member)}
                    onKeyDown={(e) => {
                      if (member.role === 'member' && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        openMemberTasks(member);
                      }
                    }}
                    className={`hover:bg-gray-50 transition-colors ${member.role === 'member' ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                          {member.role === 'leader' ? (
                            <Shield size={16} className="text-primary-600" />
                          ) : (
                            <User size={16} className="text-primary-600" />
                          )}
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {member.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {member.email}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          member.role === 'leader'
                            ? 'bg-purple-50 text-purple-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {member.role === 'leader' ? '👑 Leader' : '👤 Member'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {(member.totalCount ?? member._count.tasks)} total • {(member.todayCount ?? 0)} today
                    </td>
                    <td className="px-5 py-3 text-right">
                      {((isLeader && member.role === 'member') || isAdmin) && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(member);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingMemberId(member.id);
                            }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            {treeLeaders.map((leader) => {
              const leaderMembers = membersByLeader[leader.id] || [];
              return (
                <div key={leader.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-purple-50/40 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                        <Shield size={16} className="text-purple-700" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{leader.name}</p>
                        <p className="text-xs text-gray-600 truncate">{leader.email}</p>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(leader)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingMemberId(leader.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>

                  {leaderMembers.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-gray-500">No members under this leader.</p>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {leaderMembers.map((member) => (
                        <div
                          key={member.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openMemberTasks(member)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openMemberTasks(member);
                            }
                          }}
                          className="px-5 py-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 pl-4">
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                              <User size={14} className="text-blue-700" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
                              <p className="text-xs text-gray-600 truncate">{member.email}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {(member.totalCount ?? member._count.tasks)} total • {(member.todayCount ?? 0)} today
                              </p>
                            </div>
                          </div>

                          {((isLeader && member.role === 'member') || isAdmin) && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(member);
                                }}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingMemberId(member.id);
                                }}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {isAdmin && unassignedMembers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-900">Unassigned Members</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {unassignedMembers.map((member) => (
                    <div key={member.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                          <User size={14} className="text-blue-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
                          <p className="text-xs text-gray-600 truncate">{member.email}</p>
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(member)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingMemberId(member.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add Member Modal */}
        <Modal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditingMember(null);
            setSelectedRole('member');
            setSelectedLeaderId('');
          }}
          title={
            editingMember
              ? 'Edit User'
              : isAdmin
                ? 'Add User'
                : 'Add Team Member'
          }
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {isAdmin && !editingMember && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  User Role
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as 'leader' | 'member';
                    setSelectedRole(nextRole);
                    if (nextRole !== 'member') {
                      setSelectedLeaderId('');
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  <option value="member">Member</option>
                  <option value="leader">Leader</option>
                </select>
              </div>
            )}

            {isAdmin && ((editingMember?.role === 'member') || (!editingMember && selectedRole === 'member')) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Leader
                </label>
                <select
                  value={selectedLeaderId}
                  onChange={(e) => setSelectedLeaderId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                >
                  <option value="">Select a leader</option>
                  {leaders.map((leader) => (
                    <option key={leader.id} value={leader.id}>
                      {leader.name} ({leader.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. John Doe"
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAdmin ? 'leader@team.com' : 'member@team.com'}
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editingMember ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
                required={!editingMember}
                minLength={editingMember ? undefined : 6}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditingMember(null);
                  setSelectedRole('member');
                  setSelectedLeaderId('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
              >
                {editingMember ? 'Update User' : isAdmin ? 'Add User' : 'Add Member'}
              </button>
            </div>
          </form>
        </Modal>

        <ConfirmModal
          isOpen={Boolean(deletingMemberId)}
          title="Remove Team Member"
          message="Remove this user? Their tasks will also be deleted."
          confirmText="Remove"
          isLoading={deletingMember}
          onClose={() => {
            if (deletingMember) return;
            setDeletingMemberId(null);
          }}
          onConfirm={() => {
            if (!deletingMemberId) return;
            handleDelete(deletingMemberId);
          }}
        />

        <Modal
          isOpen={tasksModalOpen}
          onClose={() => setTasksModalOpen(false)}
          title={selectedMember ? `👤 ${selectedMember.name} • Tasks` : 'Member Tasks'}
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

              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <FolderKanban size={16} className="text-gray-400" />
                <div className="w-full">
                  <Select
                    isMulti
                    options={projectFilterOptions}
                    value={projectFilterOptions.filter((option) => taskFilterProjectIds.includes(option.value))}
                    onChange={(selected) => setTaskFilterProjectIds(selected.map((item) => item.value))}
                    placeholder="All projects"
                    className="text-sm"
                    classNamePrefix="team-project-filter"
                    styles={boxedMultiSelectStyles}
                    menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                  />
                </div>
              </div>
            </div>

            {tasksLoading ? (
              <div className="flex items-center justify-center h-28">
                <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : memberTasks.length === 0 ? (
              <div className="text-center py-8">
                <ListTodo size={36} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">No tasks for selected filters.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {memberTasks.map((task) => (
                  <div
                    key={task.id}
                    className="border border-gray-100 rounded-lg p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-words">{task.title}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {task.project.emoji} {task.project.name}
                      </p>
                    </div>
                    <StatusBadge status={task.status} size="sm" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}
