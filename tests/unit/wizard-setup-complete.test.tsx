/**
 * Task 6 — Wizard completion ceremony fed by shared probe.
 *
 * Verifies that SetupComplete renders per-component status lines,
 * including capability-disabling labels (e.g. 'find_similar') from
 * the shared probeSetupStatus output.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { SetupComplete } from '../../src/cli/tui/components/WizardSteps.js';
import type { ComponentStatus } from '../../src/cli/tui/actions/setup-status.js';

afterEach(() => {
  cleanup();
});

const statuses: ComponentStatus[] = [
  { id: 'browser', label: 'browser', required: true, status: 'ok' },
  {
    id: 'embeddings',
    label: 'embeddings',
    required: false,
    status: 'failed',
    detail: 'timeout',
    disables: 'find_similar',
  },
];

describe('SetupComplete', () => {
  it('renders per-component status lines', () => {
    const { lastFrame } = render(<SetupComplete statuses={statuses} onDone={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('browser');
    expect(frame).toContain('find_similar');
  });

  it('shows checkmark for ok component and cross for failed component', () => {
    const { lastFrame } = render(<SetupComplete statuses={statuses} onDone={() => {}} />);
    const frame = lastFrame() ?? '';
    // ok browser → ✓, failed embeddings → ✗
    expect(frame).toContain('✓');
    expect(frame).toContain('✗');
  });

  it('still shows Setup complete heading', () => {
    const { lastFrame } = render(<SetupComplete statuses={statuses} onDone={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Setup complete/i);
  });
});
