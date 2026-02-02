import { useState, useEffect, useCallback } from 'react';
import { X, Save, RotateCcw } from 'lucide-react';
import type { ExtensionManifest, JSONSchemaProperty } from '../lib/extension-api';

interface ExtensionSettingsDialogProps {
  extension: ExtensionManifest;
  onClose: () => void;
}

/**
 * Get settings value from localStorage
 */
function getSettingValue<T>(extensionId: string, key: string, defaultValue?: T): T {
  const storageKey = `extension_${extensionId}_${key}`;
  const stored = localStorage.getItem(storageKey);
  if (stored === null) return defaultValue as T;
  try {
    return JSON.parse(stored);
  } catch {
    return defaultValue as T;
  }
}

/**
 * Set settings value in localStorage
 */
function setSettingValue<T>(extensionId: string, key: string, value: T): void {
  const storageKey = `extension_${extensionId}_${key}`;
  localStorage.setItem(storageKey, JSON.stringify(value));
}

/**
 * Dialog for editing extension settings
 */
export function ExtensionSettingsDialog({ extension, onClose }: ExtensionSettingsDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const schema = extension.settings?.schema;
  const properties = schema?.properties || {};

  // Load current values on mount
  useEffect(() => {
    const loaded: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      loaded[key] = getSettingValue(
        extension.id,
        key,
        (prop as JSONSchemaProperty).default
      );
    }
    setValues(loaded);
  }, [extension.id, properties]);

  // Validate a single field
  const validateField = useCallback((key: string, value: unknown, prop: JSONSchemaProperty): string | null => {
    if (prop.type === 'integer' || prop.type === 'number') {
      const num = value as number;
      if (prop.minimum !== undefined && num < prop.minimum) {
        return `Must be at least ${prop.minimum}`;
      }
      if (prop.maximum !== undefined && num > prop.maximum) {
        return `Must be at most ${prop.maximum}`;
      }
    }
    if (prop.type === 'string' && !prop.enum) {
      const str = value as string;
      if (str === '' && prop.default !== '') {
        return null; // Allow empty strings
      }
    }
    return null;
  }, []);

  const handleChange = useCallback((key: string, value: unknown, prop: JSONSchemaProperty) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);

    // Validate and update errors
    const error = validateField(key, value, prop);
    setErrors(prev => {
      if (error) {
        return { ...prev, [key]: error };
      }
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, [validateField]);

  const handleSave = useCallback(() => {
    // Check for validation errors before saving
    if (Object.keys(errors).length > 0) {
      return;
    }

    for (const [key, value] of Object.entries(values)) {
      setSettingValue(extension.id, key, value);
    }
    setIsDirty(false);
    onClose();
  }, [extension.id, values, errors, onClose]);

  const handleReset = useCallback(() => {
    const defaults: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const defaultVal = (prop as JSONSchemaProperty).default;
      defaults[key] = defaultVal;
      // Also reset in localStorage
      const storageKey = `extension_${extension.id}_${key}`;
      if (defaultVal !== undefined) {
        localStorage.setItem(storageKey, JSON.stringify(defaultVal));
      } else {
        localStorage.removeItem(storageKey);
      }
    }
    setValues(defaults);
    setErrors({});
    setIsDirty(false);
  }, [extension.id, properties]);

  // Render input based on property type
  const renderInput = (key: string, prop: JSONSchemaProperty) => {
    const value = values[key];
    const error = errors[key];
    const inputClasses = `w-full px-3 py-2 text-sm bg-[#2a2a2a] border rounded text-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
      error ? 'border-red-500' : 'border-[#404040]'
    }`;

    switch (prop.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => handleChange(key, e.target.checked, prop)}
              className="w-4 h-4 rounded border-[#404040] bg-[#2a2a2a] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
              aria-describedby={prop.description ? `${key}-description` : undefined}
            />
            <span className="text-sm" id={`${key}-description`}>{prop.description || key}</span>
          </label>
        );

      case 'integer':
      case 'number':
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor={key}>
              {prop.description || key}
              {prop.minimum !== undefined && prop.maximum !== undefined && (
                <span className="ml-1 text-gray-500">({prop.minimum}-{prop.maximum})</span>
              )}
            </label>
            <input
              id={key}
              type="number"
              value={value as number ?? ''}
              min={prop.minimum}
              max={prop.maximum}
              step={prop.type === 'integer' ? 1 : undefined}
              onChange={(e) => handleChange(key, prop.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value), prop)}
              className={inputClasses}
              aria-invalid={!!error}
              aria-describedby={error ? `${key}-error` : undefined}
            />
            {error && (
              <p id={`${key}-error`} className="mt-1 text-xs text-red-400">{error}</p>
            )}
          </div>
        );

      case 'string':
        if (prop.enum) {
          return (
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor={key}>
                {prop.description || key}
              </label>
              <select
                id={key}
                value={value as string ?? ''}
                onChange={(e) => handleChange(key, e.target.value, prop)}
                className={inputClasses}
              >
                {prop.enum.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor={key}>
              {prop.description || key}
            </label>
            <input
              id={key}
              type="text"
              value={value as string ?? ''}
              onChange={(e) => handleChange(key, e.target.value, prop)}
              className={inputClasses}
            />
          </div>
        );

      case 'array':
        // Render as comma-separated values for simple arrays
        const arrayValue = Array.isArray(value) ? value : [];
        return (
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor={key}>
              {prop.description || key} <span className="text-gray-500">(comma-separated)</span>
            </label>
            <input
              id={key}
              type="text"
              value={arrayValue.join(', ')}
              onChange={(e) => handleChange(key, e.target.value.split(',').map(s => s.trim()).filter(Boolean), prop)}
              className={inputClasses}
            />
          </div>
        );

      default:
        return (
          <div className="text-xs text-gray-500">
            Unsupported setting type: {prop.type}
          </div>
        );
    }
  };

  const hasSettings = Object.keys(properties).length > 0;
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
      <div className="bg-[#1a1a1a] rounded-lg border border-[#333] w-full max-w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#333]">
          <div>
            <h3 id="settings-dialog-title" className="m-0 text-base font-medium">
              {extension.displayName || extension.name} Settings
            </h3>
            <p className="mt-1 mb-0 text-xs text-gray-500">
              v{extension.version}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-transparent border-none cursor-pointer text-gray-500 hover:text-white transition-colors rounded"
            aria-label="Close settings dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!hasSettings ? (
            <div className="text-center py-6 text-gray-500">
              <p className="mb-2">This extension has no configurable settings.</p>
              <p className="text-xs">
                Extension developers can add settings by defining a <code className="bg-[#2a2a2a] px-1 rounded">settings</code> schema in their manifest.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(properties).map(([key, prop]) => (
                <div key={key}>
                  {renderInput(key, prop as JSONSchemaProperty)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasSettings && (
          <div className="flex items-center justify-between p-4 border-t border-[#333]">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-transparent text-gray-500 border border-[#404040] rounded cursor-pointer hover:text-white hover:border-[#606060] transition-colors"
            >
              <RotateCcw size={14} />
              Reset to Defaults
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || hasErrors}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm text-white border-none rounded transition-colors ${
                isDirty && !hasErrors
                  ? 'bg-blue-600 cursor-pointer hover:bg-blue-700'
                  : 'bg-[#404040] cursor-default opacity-50'
              }`}
              aria-disabled={!isDirty || hasErrors}
            >
              <Save size={14} />
              Save Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
