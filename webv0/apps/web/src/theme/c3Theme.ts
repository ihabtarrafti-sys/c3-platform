import { webLightTheme, type Theme } from '@fluentui/react-components';

/**
 * C3 Fluent v9 theme — Command Black replaces Fluent's blue in every brand
 * slot, so primary buttons/links/selected states render Command Black, not blue.
 *
 * Signal Red is deliberately NOT mapped to any brand background: it stays a
 * restrained accent applied via the --c3-* tokens / component CSS only (active
 * nav marker, focused-error border). This is the token conflict the design lane
 * flagged — colorBrandBackground must never become red.
 *
 * The base is already near-black, so hover LIGHTENS to charcoal for visible
 * feedback (the opposite of Fluent's darken-on-hover blue ramp).
 *
 * Canonical authority: c3-governance/product/design/A-PRODUCT-FOUNDATION.md.
 */
const COMMAND_BLACK = '#0d0d0d';
const CHARCOAL = '#242424';
const CHARCOAL_LIGHT = '#171717';
const PURE_BLACK = '#000000';

export const c3LightTheme: Theme = {
  ...webLightTheme,

  // application typography (IBM Plex, self-hosted via fonts.css since S45;
  // c3-tokens.css defines the fallback stack for the swap window)
  fontFamilyBase: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace',

  // motion v2 (S46, owner-approved A.8 amendment): 130ms state / 200ms
  // enter-exit / 280ms drawer, one "C3 ease". Mapped onto Fluent's motion
  // slots so Drawer slide, Dialog fade, and hover states all move on the
  // same clock without per-component overrides.
  durationFast: '130ms',
  durationNormal: '200ms',
  durationGentle: '280ms',
  curveEasyEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
  curveDecelerateMid: 'cubic-bezier(0.22, 1, 0.36, 1)',
  curveAccelerateMid: 'cubic-bezier(0.22, 1, 0.36, 1)',

  // brand background (primary Button, selected surfaces)
  colorBrandBackground: COMMAND_BLACK,
  colorBrandBackgroundHover: CHARCOAL,
  colorBrandBackgroundPressed: PURE_BLACK,
  colorBrandBackgroundSelected: CHARCOAL_LIGHT,

  // compound brand (inputs, checkbox/radio, switch active track)
  colorCompoundBrandBackground: COMMAND_BLACK,
  colorCompoundBrandBackgroundHover: CHARCOAL,
  colorCompoundBrandBackgroundPressed: PURE_BLACK,
  colorCompoundBrandForeground1: COMMAND_BLACK,
  colorCompoundBrandForeground1Hover: CHARCOAL,
  colorCompoundBrandForeground1Pressed: PURE_BLACK,
  colorCompoundBrandStroke: COMMAND_BLACK,
  colorCompoundBrandStrokeHover: CHARCOAL,

  // brand foreground + links (IDs, hyperlinks resolve to ink, not blue)
  colorBrandForeground1: COMMAND_BLACK,
  colorBrandForeground2: CHARCOAL,
  colorBrandForegroundLink: COMMAND_BLACK,
  colorBrandForegroundLinkHover: PURE_BLACK,
  colorBrandForegroundLinkPressed: PURE_BLACK,
  colorBrandForegroundLinkSelected: COMMAND_BLACK,

  // brand strokes / focus
  colorBrandStroke1: COMMAND_BLACK,
  colorBrandStroke2: '#c7c3bc',

  // selected navigation / tab foreground
  colorNeutralForeground2BrandHover: COMMAND_BLACK,
  colorNeutralForeground2BrandPressed: PURE_BLACK,
  colorNeutralForeground2BrandSelected: COMMAND_BLACK,
  colorNeutralForeground3BrandHover: COMMAND_BLACK,
  colorNeutralForeground3BrandSelected: COMMAND_BLACK,
};
