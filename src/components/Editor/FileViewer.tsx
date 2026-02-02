import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

interface FileViewerProps {
  content: string;
  fileName: string;
  path: string;
}

export function FileViewer({ content, fileName, path }: FileViewerProps) {
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    setLineCount(content.split('\n').length);
  }, [content]);

  // Simple syntax highlighting helper
  const isCodeFile = /\.(js|jsx|ts|tsx|py|css|html|json|yaml|yml|md|txt)$/.test(fileName);

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <div className="file-info">
          <span className="file-name">{fileName}</span>
          <span className="file-path">{path}</span>
        </div>
        <div className="file-stats">
          <span>{lineCount} lines</span>
          <span>{content.length} chars</span>
        </div>
      </div>

      <div className="file-viewer-content">
        {isCodeFile ? (
          <pre className="code-content">
            <code>{content}</code>
          </pre>
        ) : (
          <div className="binary-warning">
            <AlertCircle size={48} />
            <p>This file type cannot be displayed</p>
            <p className="file-type-hint">{fileName.split('.').pop()?.toUpperCase() || 'UNKNOWN'} file</p>
          </div>
        )}
      </div>
    </div>
  );
}
