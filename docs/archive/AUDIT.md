# File Watcher & Save System Audit

> **Last Updated**: January 2026
> 
> **Status**: ✅ Most critical issues have been resolved. Remaining work is optimization.

## Critical Issues Found

### 1. ✅ FIXED: Missing File Tracking
**Issue**: Only sections were being tracked, not project.yaml or entities
**Impact**: File watcher would always trigger on project.yaml and entity saves
**Status**: FIXED - All files now tracked via `markFileAsWritten()` (ProjectService.ts)

### 2. ✅ FIXED: Entity Hash-Based Change Detection
**Location**: `ProjectService.ts:259-273`
**Previous Issue**: Entities were rewritten on every save
**Status**: FIXED - Now uses `computeEntityHash()` to detect actual changes
- Hash computed before write (line 259)
- Only writes if hash differs from original (line 263)
- Original hash updated after successful write (line 272)

### 3. ✅ FIXED: project.yaml Hash-Based Change Detection
**Location**: `ProjectService.ts:207-231`
**Previous Issue**: project.yaml always rewritten
**Status**: FIXED - Now uses `computeProjectHash()` to detect actual changes
- Hash computed before write (line 207)
- Only writes if hash differs from original (line 211)
- Original hash updated after successful write (line 230)

### 4. ✅ GOOD: Section Hash-Based Change Detection
**Location**: `ProjectService.ts:294-308`
**Status**: Correctly implemented
- Only writes sections when content hash changes
- Updates original hash after write
- Properly tracked after write

### 5. ⚠️ MINOR: Store Marks All Items Dirty
**Location**: `store.ts:167-170`
**Issue**: Store still marks ALL entities/sections as dirty when syncing to ProjectService
**Impact**: Low - ProjectService hash detection prevents unnecessary writes
**Why It Exists**: Store and ProjectService have separate state; full sync avoids missed changes
**Future Optimization**: Could track granular dirty state in store and pass only changed items


## Architecture Issues

### 6. ✅ FIXED: timer Cleanup on Project Close
**Location**: `ProjectService.ts:36,602-608,638-641`
**Previous Issue**: setTimeout creates timer that persists even if project closed
**Status**: FIXED
- Active timers tracked in `activeTimers` Set (line 36)
- Timer added to set when created (line 607-608)
- All timers cleared in `close()` method (lines 638-641)

### 7. ⚠️ MINOR: Path Format Consistency
**Location**: Multiple files
**Issue**: Mixed path formats between Windows backslashes and forward slashes
**Current Mitigation**: Path normalization in `wasRecentlyWritten()` and `markFileAsWritten()` (lines 598, 616)
**Status**: Working but could be cleaner with centralized normalization

## Performance Issues

### 8. ✅ FIXED: Parallel File Writes
**Location**: `ProjectService.ts:255,284,290,325`
**Previous Issue**: Entity and section saves were sequential
**Status**: FIXED - Now uses `Promise.all()` for parallel writes
```typescript
// Entities saved in parallel (lines 255-284)
const entitySavePromises = Array.from(this.dirtyEntities).map(async (entityId) => {...});
await Promise.all(entitySavePromises);

// Sections saved in parallel (lines 290-325)  
const sectionSavePromises = Array.from(this.dirtySections).map(async (sectionId) => {...});
await Promise.all(sectionSavePromises);
```

## Security/Safety Issues

### 9. ✅ GOOD: Deep Copy Prevents Immer Issues
**Location**: `store.ts:162`
**Status**: Correctly implemented to avoid readonly errors

### 10. ✅ FIXED: Error Handling for File Operations
**Location**: `ProjectService.ts:199,244-250,276-282,317-323,329-335`
**Previous Issue**: No try/catch around file operations
**Status**: FIXED
- Error array tracks failures (line 199)
- Each file type wrapped in try/catch
- Successful saves preserved, only failed items remain dirty
- Collected errors thrown at end with detailed message (lines 329-335)


## Recommendations Priority

### COMPLETED ✅
1. ✅ **Track all files** - FIXED
2. ✅ **Add error handling to save operations** - FIXED
3. ✅ **Entity/project.yaml hash detection** - FIXED
4. ✅ **Clear timers on project close** - FIXED
5. ✅ **Parallelize file writes** - FIXED

### REMAINING (Low Priority):
6. **Optimize store dirty tracking** - Minor efficiency improvement
7. **Centralize path normalization** - Cleaner architecture
8. **Add save transaction/rollback** - Advanced safety feature

## Test Coverage Gaps

### Missing Tests:
- File watcher behavior with rapid saves
- Multiple file changes detected simultaneously
- Project close while file watcher active
- Save failure recovery (now has error handling, needs tests)
- Concurrent saves

## Summary

**What Works** ✅:
- ✅ All file types have hash-based change detection (sections, entities, project.yaml)
- ✅ All files properly tracked for file watcher
- ✅ Parallel writes for entities and sections
- ✅ Error handling with partial save preservation
- ✅ Timer cleanup on project close
- ✅ Path normalization handles Windows/Unix differences
- ✅ Deep copy prevents Immer readonly issues

**Remaining Optimization**:
- ⚠️ Store marks all items dirty before save (mitigated by hash detection)
- ⚠️ Could centralize path normalization for cleaner code

**Overall Status**: The save system is now robust and efficient. The remaining issues are minor optimizations that don't affect correctness or user experience.
