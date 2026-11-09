import { t } from '../../i18n/index.ts';
export const workflowBackupOptions = [
  { field: 'tasks', key: 'command_tasks', get label() { return t('settings:multiHostTasks'); } },
  { field: 'workspaces', key: 'workspace_sets', get label() { return t('settings:namedWorkingSets'); } },
  { field: 'tunnels', key: 'tunnel_presets', get label() { return t('settings:tunnelPresets'); } },
  { field: 'sync', key: 'sync_presets', get label() { return t('settings:directorySyncPresets'); } },
  { field: 'preferences', key: 'connection_preferences', get label() { return t('settings:bookmarksAndConnectionPreferences'); } },
  { field: 'log_rules', key: 'log_view_presets', get label() { return t('settings:logFiltersAndHighlightingRules'); } },
] as const;

export function backupSettingNames(): Record<string, string> { return {
  get snippets() { return t('settings:commandSnippets'); }, get appearance() { return t('settings:appearance'); }, get shortcuts() { return t('settings:keyboardShortcuts'); },
  ...Object.fromEntries(workflowBackupOptions.map(option => [option.key, option.label])),
}; }

export function workflowBackupSelection(data: FormData) {
  return { tasks: data.get('tasks') === 'on', workspaces: data.get('workspaces') === 'on', tunnels: data.get('tunnels') === 'on', sync: data.get('sync') === 'on', preferences: data.get('preferences') === 'on', log_rules: data.get('log_rules') === 'on' };
}
