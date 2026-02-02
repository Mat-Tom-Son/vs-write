import { useMemo, useState } from 'react';
import type { Section, Diagnostic } from '../../lib/schemas';
import { useStoryStore } from '../../lib/store';
import { useAppSettings } from '../../lib/app-settings';
import { PromptResolver } from '../../lib/prompt-resolver';
import { AgentService, OpenAIProvider, OllamaProvider, ClaudeProvider } from '../../services/AgentService';

interface Props {
  section: Section;
}

export function DiagnosticsPanel({ section }: Props) {
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const { project, setDiagnostics, getNarrativeContext } = useStoryStore();
  const appSettings = useAppSettings((state) => state.settings);

  // Create agent service with prompt resolver
  const agent = useMemo(() => {
    const promptResolver = new PromptResolver(
      appSettings.systemPrompts,
      project.settings
    );

    let provider;
    switch (appSettings.llm.provider) {
      case 'openai':
        provider = new OpenAIProvider(
          appSettings.llm.openai.apiKey,
          appSettings.llm.openai.baseUrl,
          appSettings.llm.openai.model
        );
        break;
      case 'claude':
        provider = new ClaudeProvider(
          appSettings.llm.anthropic.apiKey,
          appSettings.llm.anthropic.model
        );
        break;
      case 'ollama':
      default:
        provider = new OllamaProvider(
          appSettings.llm.ollama.model,
          appSettings.llm.ollama.baseUrl
        );
        break;
    }

    return new AgentService(provider, promptResolver);
  }, [appSettings, project.settings]);
  const entities = useMemo(
    () => project.entities.filter((e) => section.entityIds.includes(e.id)),
    [project.entities, section.entityIds],
  );

  const runConsistencyCheck = async () => {
    if (entities.length === 0) {
      alert('Link at least one entity to this section to run consistency checks.');
      return;
    }

    setIsChecking(true);
    const allDiagnostics: Diagnostic[] = [];
    try {
      for (const entity of entities) {
        const context = getNarrativeContext(entity.id);
        if (!context) continue;
        const history = context.chronologicalSections.filter((s) => s.order < section.order);
        const diagnostics = await agent.checkConsistency(entity, section, history);
        allDiagnostics.push(...diagnostics.map((d) => ({ ...d, entityId: entity.id })));
      }
      setDiagnostics(section.id, allDiagnostics);
      setLastChecked(new Date());
    } catch (err) {
      console.error('Consistency check failed:', err);
      alert('Consistency check failed. Check console for details.');
    } finally {
      setIsChecking(false);
    }
  };

  const getSeverityIcon = (severity: Diagnostic['severity']) => {
    switch (severity) {
      case 'critical':
        return '⛔';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  const getEntityName = (entityId?: string) => {
    if (!entityId) return null;
    return project.entities.find((e) => e.id === entityId)?.name;
  };

  return (
    <div className="diagnostics-panel">
      <div className="check-controls">
        <button onClick={runConsistencyCheck} disabled={isChecking || entities.length === 0} className="check-button">
          {isChecking ? 'Checking...' : 'Check Consistency'}
        </button>
        {lastChecked && <span className="last-checked">Last: {lastChecked.toLocaleTimeString()}</span>}
      </div>

      {entities.length === 0 && <p className="hint">Link entities to enable consistency checks</p>}
      {section.diagnostics.length === 0 && entities.length > 0 && lastChecked && (
        <p className="all-clear">✓ No issues detected</p>
      )}

      <div className="diagnostic-list">
        {section.diagnostics.map((d) => (
          <div key={d.id} className={`diagnostic-item ${d.severity}`}>
            <div className="diagnostic-header">
              <span className="severity-icon">{getSeverityIcon(d.severity)}</span>
              {d.entityId && <span className="entity-tag">{getEntityName(d.entityId)}</span>}
            </div>
            <p className="diagnostic-message">{d.message}</p>
            {d.suggestion && <p className="diagnostic-suggestion">{d.suggestion}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
