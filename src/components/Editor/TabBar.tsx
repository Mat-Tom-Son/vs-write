import { X, FileText, File } from 'lucide-react';

export interface Tab {
  id: string;
  title: string;
  path: string;
  type: 'section' | 'file';
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose }: TabBarProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          <div className="tab-icon">
            {tab.type === 'section' ? (
              <FileText size={14} />
            ) : (
              <File size={14} />
            )}
          </div>
          <span className="tab-title">
            {tab.title}
            {tab.isDirty && ' •'}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
