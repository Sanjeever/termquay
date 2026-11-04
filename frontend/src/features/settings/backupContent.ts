export const workflowBackupOptions = [
  { field: 'tasks', key: 'command_tasks', label: '多主机任务' },
  { field: 'workspaces', key: 'workspace_sets', label: '命名工作集' },
  { field: 'tunnels', key: 'tunnel_presets', label: '隧道预设' },
  { field: 'sync', key: 'sync_presets', label: '目录同步预设' },
  { field: 'preferences', key: 'connection_preferences', label: '书签与连接偏好' },
] as const;

export const backupSettingNames: Record<string, string> = {
  snippets: '命令片段', appearance: '外观', shortcuts: '快捷键',
  ...Object.fromEntries(workflowBackupOptions.map(option => [option.key, option.label])),
};

export function workflowBackupSelection(data: FormData) {
  return { tasks: data.get('tasks') === 'on', workspaces: data.get('workspaces') === 'on', tunnels: data.get('tunnels') === 'on', sync: data.get('sync') === 'on', preferences: data.get('preferences') === 'on' };
}
