import { FileText, Tag, MessageSquare, FolderOpen, Puzzle } from 'lucide-react';

export type ActivityView = 'files' | 'sections' | 'entities' | 'chat' | 'extensions';

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
  badges?: Partial<Record<ActivityView, number>>;
}

export function ActivityBar({ activeView, onViewChange, badges }: ActivityBarProps) {
  const tabs = [
    { id: 'files' as const, icon: FolderOpen, label: 'Files' },
    { id: 'sections' as const, icon: FileText, label: 'Sections' },
    { id: 'entities' as const, icon: Tag, label: 'Entities' },
    { id: 'chat' as const, icon: MessageSquare, label: 'Chat' },
    { id: 'extensions' as const, icon: Puzzle, label: 'Extensions' },
  ];

  return (
    <div className="activity-bar">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const badgeValue = badges?.[tab.id] ?? 0;
        return (
          <button
            key={tab.id}
            className={`activity-tab ${activeView === tab.id ? 'active' : ''}`}
            onClick={() => onViewChange(tab.id)}
            title={tab.label}
            aria-label={tab.label}
          >
            <Icon size={24} />
            {badgeValue > 0 && <span className="activity-tab-badge">{badgeValue}</span>}
          </button>
        );
      })}
    </div>
  );
}
