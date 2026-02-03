export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(navigator.platform);
}

export function modifierKeyLabel(): string {
  return isMac() ? 'Cmd' : 'Ctrl';
}

export function fileManagerName(): string {
  if (isMac()) return 'Finder';
  if (isWindows()) return 'Explorer';
  return 'File Manager';
}

