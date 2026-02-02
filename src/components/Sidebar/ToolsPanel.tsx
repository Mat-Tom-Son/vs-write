import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import {
  TOOL_REGISTRY,
  getCategories,
  getCategoryDisplayName,
  getCategoryIcon,
  searchTools,
  getToolsByCategory,
} from '../../lib/tool-registry';
import type { ToolCategory } from '../../lib/tool-registry';
import { ToolCard } from './ToolCard';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

export function ToolsPanel() {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter tools based on category and search
  const filteredTools = useMemo(() => {
    let tools = TOOL_REGISTRY;

    // Apply category filter
    if (selectedCategory !== 'all') {
      tools = getToolsByCategory(selectedCategory);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      tools = searchTools(searchQuery);
    }

    return tools;
  }, [selectedCategory, searchQuery]);

  const categories = getCategories();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Available Tools</h2>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory('all')}
            className="h-7 text-xs px-2.5"
          >
            All
          </Button>
          {categories.map((category) => {
            const IconComponent = (LucideIcons as Record<string, typeof LucideIcons.Circle>)[getCategoryIcon(category)] || LucideIcons.Circle;
            return (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className="h-7 text-xs px-2.5"
              >
                <IconComponent className="w-3 h-3 mr-1" />
                {getCategoryDisplayName(category).replace(' & ', ' ')}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Tool List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredTools.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No tools found</p>
            {searchQuery && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="mt-2 text-xs"
              >
                Clear search
              </Button>
            )}
          </div>
        ) : (
          filteredTools.map((tool) => <ToolCard key={tool.name} tool={tool} />)
        )}
      </div>

      {/* Footer with helpful info */}
      <div className="p-3 border-t border-border bg-muted/30">
        <p className="text-xs text-muted-foreground">
          Use these tools by describing what you want in natural language.
          The AI agent will automatically choose and use the appropriate tools.
        </p>
      </div>
    </div>
  );
}
