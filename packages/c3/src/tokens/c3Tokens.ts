/**
 * C3 Design System v1.0 — Token Registry
 *
 * Single source of truth for all design tokens in C3.
 * All CSS custom properties are injected at the FluentProvider root in App.tsx
 * via the `style` prop, making them available to every component.
 *
 * Rules:
 *   - No component file may use a hex literal or raw px value for a property
 *     that belongs to the token system (color, spacing, radius, shadow, motion).
 *   - To add a new token: add it here first, then use it in components.
 *   - Legacy aliases (marked below) are preserved until all consuming
 *     components migrate to canonical names.
 *
 * Reference: docs/C3 Design System v1.0.md
 */

import { createLightTheme, type BrandVariants } from '@fluentui/react-components';
import type React from 'react';

// ---------------------------------------------------------------------------
// Fluent UI Brand Theme
// ---------------------------------------------------------------------------

const c3Brand: BrandVariants = {
  10: '#020812',
  20: '#060d1f',
  30: '#0a1530',
  40: '#0d1b3e',
  50: '#162d6e',
  60: '#1a3a8f',
  70: '#1d47b4',
  80: '#2563EB',
  90: '#3b7ef0',
  100: '#5c95f3',
  110: '#7facf6',
  120: '#a3c4f9',
  130: '#c7dbfc',
  140: '#deeafe',
  150: '#f0f5ff',
  160: '#f8fbff',
};

export const c3Theme = createLightTheme(c3Brand);

// ---------------------------------------------------------------------------
// CSS Custom Property Token Set
// ---------------------------------------------------------------------------

export const c3CSSVars = {

  // ── Brand Palette ──────────────────────────────────────────────────────────
  '--c3-brand-40':  '#0D1B3E',  // nav background
  '--c3-brand-50':  '#162d6e',  // nav hover state
  '--c3-brand-60':  '#1a3a8f',  // nav active indicator fill
  '--c3-brand-80':  '#2563EB',  // primary accent / interactive
  '--c3-brand-90':  '#3b7ef0',  // accent hover
  '--c3-brand-120': '#a3c4f9',  // accent tint (chips, light badges)
  '--c3-brand-140': '#deeafe',  // subtle accent background
  '--c3-brand-150': '#f0f5ff',  // accent page wash

  // ── Semantic — Critical ────────────────────────────────────────────────────
  '--c3-critical':        '#DC2626', // expired, terminated, system error
  '--c3-critical-bg':     '#FEF2F2', // critical surface background
  '--c3-critical-border': '#FECACA', // critical surface border

  // ── Semantic — Warning ─────────────────────────────────────────────────────
  '--c3-warning':        '#D97706', // expiring, pending, overdue
  '--c3-warning-bg':     '#FFFBEB', // warning surface background
  '--c3-warning-border': '#FDE68A', // warning surface border

  // ── Semantic — Success ─────────────────────────────────────────────────────
  '--c3-success':        '#16A34A', // active, signed, healthy
  '--c3-success-bg':     '#F0FDF4', // success surface background
  '--c3-success-border': '#BBF7D0', // success surface border

  // ── Semantic — Info ────────────────────────────────────────────────────────
  '--c3-info':        '#0284C7', // in-progress, renewing, informational
  '--c3-info-bg':     '#F0F9FF', // info surface background
  '--c3-info-border': '#BAE6FD', // info surface border

  // ── Semantic — Intelligence ────────────────────────────────────────────────
  '--c3-purple':    '#7C3AED', // intelligence/analytics accents only
  '--c3-purple-bg': '#F5F3FF', // intelligence surface background

  // ── Neutral Palette ────────────────────────────────────────────────────────
  '--c3-gray-950': '#0F172A', // primary text
  '--c3-gray-800': '#1E293B', // secondary headings
  '--c3-gray-700': '#334155', // body text
  '--c3-gray-500': '#64748B', // muted text, labels, placeholders
  '--c3-gray-400': '#94A3B8', // disabled text, decorative
  '--c3-gray-200': '#E2E8F0', // borders, dividers, separators
  '--c3-gray-100': '#F1F5F9', // subtle backgrounds, hover tint
  '--c3-gray-50':  '#F8FAFC', // page canvas background
  '--c3-white':    '#FFFFFF', // card surface, inputs

  // ── Spacing Scale (4px grid) ───────────────────────────────────────────────
  '--c3-space-1':  '4px',
  '--c3-space-2':  '8px',
  '--c3-space-3':  '12px',
  '--c3-space-4':  '16px',
  '--c3-space-5':  '20px',
  '--c3-space-6':  '24px',
  '--c3-space-8':  '32px',
  '--c3-space-10': '40px',
  '--c3-space-12': '48px',
  '--c3-space-16': '64px',

  // ── Border Radius ──────────────────────────────────────────────────────────
  '--c3-radius-sm':   '4px',    // badges, pills, chips
  '--c3-radius-md':   '8px',    // cards, inputs, rows, tooltips
  '--c3-radius-lg':   '12px',   // modal panels, large cards
  '--c3-radius-xl':   '16px',   // full-screen panels (future)
  '--c3-radius-full': '9999px', // avatars, progress indicators, tags

  // ── Elevation / Shadows ────────────────────────────────────────────────────
  '--c3-shadow-0': 'none',
  '--c3-shadow-1': '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
  '--c3-shadow-2': '0 4px 6px rgba(15,23,42,0.07), 0 2px 4px rgba(15,23,42,0.06)',
  '--c3-shadow-3': '0 10px 15px rgba(15,23,42,0.10), 0 4px 6px rgba(15,23,42,0.05)',
  '--c3-shadow-4': '0 20px 30px rgba(15,23,42,0.14), 0 8px 12px rgba(15,23,42,0.08)',

  // ── Motion / Transitions ───────────────────────────────────────────────────
  '--c3-motion-fast':         '120ms',
  '--c3-motion-base':         '200ms',
  '--c3-motion-slow':         '300ms',
  '--c3-motion-spring':       '400ms',
  '--c3-motion-ease':         'ease-in-out',
  '--c3-motion-ease-out':     'ease-out',
  '--c3-motion-spring-curve': 'cubic-bezier(0.34, 1.56, 0.64, 1)',

  // ── Layout ────────────────────────────────────────────────────────────────
  '--c3-nav-w': '220px',

  // ── Legacy Aliases ────────────────────────────────────────────────────────
  // Retained until all consuming components migrate to canonical names above.
  // Do not use these aliases in new components.
  '--c3-navy':   '#0D1B3E', // → --c3-brand-40
  '--c3-accent': '#2563EB', // → --c3-brand-80
  '--c3-green':  '#16A34A', // → --c3-success
  '--c3-amber':  '#D97706', // → --c3-warning
  '--c3-red':    '#DC2626', // → --c3-critical
  '--c3-radius': '8px',     // → --c3-radius-md

} as React.CSSProperties;
