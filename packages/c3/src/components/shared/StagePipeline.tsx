/**
 * StagePipeline — C3 Design System v1.0
 *
 * Visual lifecycle progression indicator for contracts.
 * Shows the full ordered sequence of ContractStage values with clear
 * visual differentiation between completed, current, and upcoming stages.
 *
 * Placed in components/shared/ (not components/ui/) because it imports
 * ContractStage from @c3/types. The stage ordering is intrinsic to the
 * component's purpose — it cannot operate without the domain type.
 *
 * Props:
 *   currentStage — the contract's active stage.
 *
 * No business logic, no mutations, no service calls. Pure presentation.
 *
 * Layer: Shared (components/shared) — domain type import permitted.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Text } from '@fluentui/react-components';
import type { ContractStage } from '@c3/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StagePipelineProps {
  /** The contract's current stage. All other stages are derived from this. */
  currentStage: ContractStage;
}

type StageStatus = 'completed' | 'current' | 'upcoming';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical stage order. The pipeline always renders these in sequence. */
const PIPELINE_STAGES: ContractStage[] = [
  'Draft',
  'In Review',
  'Pending Approval',
  'Pending Signature',
  'Signed',
];

/** Circle diameter in px — all stages use the same size. */
const CIRCLE_PX = 28;

/**
 * Connector margin-top = half circle height minus half connector height.
 * Centers the 2px connector line on the circle's vertical midpoint.
 */
const CONNECTOR_TOP = `${CIRCLE_PX / 2 - 1}px`;

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const getStageStatus = (stageIdx: number, currentIdx: number): StageStatus => {
  if (stageIdx < currentIdx) return 'completed';
  if (stageIdx === currentIdx) return 'current';
  return 'upcoming';
};

const circleStyle = (status: StageStatus): CSSProperties => {
  const base: CSSProperties = {
    width: CIRCLE_PX,
    height: CIRCLE_PX,
    borderRadius: 'var(--c3-radius-full)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: [
      `background var(--c3-motion-base) var(--c3-motion-ease)`,
      `box-shadow var(--c3-motion-base) var(--c3-motion-ease)`,
    ].join(', '),
  };

  switch (status) {
    case 'completed':
      return {
        ...base,
        background: 'var(--c3-brand-80)',
        color: 'var(--c3-white)',
      };
    case 'current':
      return {
        ...base,
        background: 'var(--c3-brand-80)',
        color: 'var(--c3-white)',
        boxShadow: '0 0 0 4px var(--c3-brand-140)',
      };
    case 'upcoming':
      return {
        ...base,
        background: 'var(--c3-gray-100)',
        border: '2px solid var(--c3-gray-200)',
        color: 'var(--c3-gray-400)',
        boxSizing: 'border-box',
      };
  }
};

const labelColor = (status: StageStatus): string => {
  switch (status) {
    case 'completed': return 'var(--c3-gray-500)';
    case 'current':   return 'var(--c3-brand-80)';
    case 'upcoming':  return 'var(--c3-gray-400)';
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StagePipeline = ({ currentStage }: StagePipelineProps) => {
  const currentIdx = PIPELINE_STAGES.indexOf(currentStage);

  const items = PIPELINE_STAGES.flatMap<ReactNode>((stage, i) => {
    const status = getStageStatus(i, currentIdx);
    const isLast = i === PIPELINE_STAGES.length - 1;
    const connectorFilled = i < currentIdx;

    const node = (
      <div
        key={stage}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--c3-space-2)',
          flexShrink: 0,
        }}
      >
        {/* Circle */}
        <div style={circleStyle(status)} aria-hidden="true">
          {status === 'completed' && (
            <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>
              ✓
            </span>
          )}
          {status === 'current' && (
            <span style={{ fontSize: '8px', lineHeight: 1 }}>●</span>
          )}
        </div>

        {/* Label */}
        <Text
          size={200}
          weight={status === 'current' ? 'semibold' : 'regular'}
          style={{
            color: labelColor(status),
            textAlign: 'center',
            display: 'block',
            maxWidth: '72px',
            lineHeight: '1.3',
          }}
        >
          {stage}
        </Text>
      </div>
    );

    if (isLast) return [node];

    const connector = (
      <div
        key={`${stage}--connector`}
        aria-hidden="true"
        style={{
          flex: '1 1 0',
          height: '2px',
          marginTop: CONNECTOR_TOP,
          alignSelf: 'flex-start',
          background: connectorFilled
            ? 'var(--c3-brand-80)'
            : 'var(--c3-gray-200)',
          transition: `background var(--c3-motion-base) var(--c3-motion-ease)`,
        }}
      />
    );

    return [node, connector];
  });

  return (
    <div
      role="list"
      aria-label="Contract lifecycle stages"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
        paddingTop: 'var(--c3-space-2)',
        paddingBottom: 'var(--c3-space-1)',
      }}
    >
      {items}
    </div>
  );
};
