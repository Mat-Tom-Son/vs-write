import { useState } from 'react';
import { ChevronDown, ChevronRight, Info, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import type { ToolDefinition } from '../../lib/tool-registry';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

interface ToolCardProps {
  tool: ToolDefinition;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get the icon component from lucide-react
  const IconComponent =
    (LucideIcons as unknown as Record<string, LucideIcon>)[tool.icon] ?? LucideIcons.HelpCircle;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border rounded-lg bg-card">
        <CollapsibleTrigger className="w-full p-3 hover:bg-muted/50 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <IconComponent className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="font-mono text-sm font-medium">{tool.name}</span>
            </div>
          </div>
          {!isOpen && (
            <p className="text-xs text-muted-foreground mt-1 text-left ml-10 line-clamp-1">
              {tool.description}
            </p>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-3 pt-0 space-y-3 border-t border-border mt-2">
            {/* Description */}
            <div>
              <p className="text-xs text-foreground">{tool.description}</p>
            </div>

            {/* Documentation */}
            <div className="bg-muted/50 rounded-md p-2">
              <p className="text-xs text-muted-foreground">{tool.documentation}</p>
            </div>

            {/* Parameters */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Parameters</h4>
              <div className="space-y-2">
                {tool.parameters.map((param) => (
                  <div key={param.name} className="bg-muted/30 rounded px-2 py-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-primary">{param.name}</code>
                      <span className="text-xs text-muted-foreground">({param.type})</span>
                      {param.required && (
                        <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded font-medium">
                          required
                        </span>
                      )}
                      {!param.required && param.default !== undefined && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          default: {JSON.stringify(param.default)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{param.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Examples */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Example Prompts</h4>
              <div className="space-y-1">
                {tool.examples.map((example, idx) => (
                  <div key={idx} className="bg-muted/30 rounded px-2 py-1">
                    <p className="text-xs text-foreground italic">&ldquo;{example}&rdquo;</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tips */}
            {tool.tips && tool.tips.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Info className="w-3 h-3 text-primary" />
                  <h4 className="text-xs font-semibold text-foreground">Tips</h4>
                </div>
                <ul className="space-y-1 ml-4">
                  {tool.tips.map((tip, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground list-disc">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
