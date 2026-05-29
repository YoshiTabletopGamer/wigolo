import type { CategoryDef } from './types.js';

export const agentsCategory: CategoryDef = {
  id: 'agents',
  label: 'MCP Agents',
  description: 'Coding agents to install wigolo into (auto-syncs settings)',
  fields: [
    {
      key: 'WIGOLO_AGENTS',
      settingsPath: 'agents',
      label: 'Installed agents',
      kind: 'multiselect',
      options: [
        { value: 'claude-code', label: 'Claude Code (CLI)' },
        { value: 'vscode', label: 'VS Code' },
        { value: 'zed', label: 'Zed' },
        { value: 'windsurf', label: 'Windsurf' },
        { value: 'cursor', label: 'Cursor' },
      ],
      default: [],
      help: 'Wigolo will be installed and its env block kept in sync with these agents.',
    },
  ],
};
