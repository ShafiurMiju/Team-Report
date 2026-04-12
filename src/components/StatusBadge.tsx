interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config: Record<string, { bg: string; text: string; label: string; icon: string }> = {
    todo: {
      bg: 'bg-gray-100',
      text: 'text-gray-700',
      label: 'To Do',
      icon: '📋',
    },
    'in-progress': {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      label: 'In Progress',
      icon: '🔄',
    },
    pause: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-700',
      label: 'Pause',
      icon: '⏸️',
    },
    done: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      label: 'Done',
      icon: '✅',
    },
  };

  const c = config[status] || config.todo;
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${c.bg} ${c.text} ${sizeClasses}`}
    >
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}
