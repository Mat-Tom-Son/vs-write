import { useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { ChevronDown, ChevronRight, RotateCcw, Info } from 'lucide-react';

interface PromptEditorProps {
  label: string;
  value: string;
  defaultValue: string;
  templateVariables: string[];
  onChange: (value: string) => void;
  onReset: () => void;
  saveAsProjectOverride?: boolean;
  onToggleProjectOverride?: (checked: boolean) => void;
  description?: string;
}

export function PromptEditor({
  label,
  value,
  defaultValue,
  templateVariables,
  onChange,
  onReset,
  saveAsProjectOverride = false,
  onToggleProjectOverride,
  description,
}: PromptEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isModified = value !== defaultValue;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border rounded-lg">
        <CollapsibleTrigger className="w-full p-4 hover:bg-muted/50 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{label}</span>
              {isModified && (
                <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                  Modified
                </span>
              )}
            </div>
          </div>
          {description && !isOpen && (
            <p className="text-xs text-muted-foreground mt-1 text-left ml-6">
              {description}
            </p>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4 pt-0 space-y-3">
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}

            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="font-mono text-xs min-h-[200px] resize-y"
              placeholder="Enter your custom prompt..."
            />

            {/* Template Variables Help */}
            <div className="bg-muted/50 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Info className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Available Template Variables
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {templateVariables.map((variable) => (
                  <code
                    key={variable}
                    className="text-xs bg-background px-2 py-0.5 rounded border border-border"
                  >
                    {variable}
                  </code>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onReset}
                disabled={!isModified}
                className="text-xs"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset to Default
              </Button>

              {onToggleProjectOverride && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsProjectOverride}
                    onChange={(e) => onToggleProjectOverride(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="text-muted-foreground">
                    Save as project override
                  </span>
                </label>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
