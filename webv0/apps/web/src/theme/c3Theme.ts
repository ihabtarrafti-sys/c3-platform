import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

/**
 * C3 Fluent v9 themes — Direction E (S47, forward identity): indigo carries
 * the brand in every Fluent slot; red is reserved for attention and is NEVER
 * a brand slot. Dark-first; the light set is the same system inverted.
 *
 * Neutrals are aligned to the E ground/surface tokens so Fluent components
 * (inputs, dialogs, dropdowns, menus) sit natively on the E surfaces instead
 * of Fluent's own grays. Canonical: docs/design/S47-direction-e-adoption.md.
 */

const type = {
  fontFamilyBase: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
} as const;

// Motion v2 (S46 clock): one C3 ease on Fluent's slots.
const motion = {
  durationFast: '130ms',
  durationNormal: '200ms',
  durationGentle: '280ms',
  curveEasyEase: 'cubic-bezier(0.22, 1, 0.36, 1)',
  curveDecelerateMid: 'cubic-bezier(0.22, 1, 0.36, 1)',
  curveAccelerateMid: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export const c3DarkTheme: Theme = {
  ...webDarkTheme,
  ...type,
  ...motion,

  // surfaces aligned to E ground/surface
  colorNeutralBackground1: '#13151e',
  colorNeutralBackground1Hover: '#191c28',
  colorNeutralBackground1Pressed: '#0f111a',
  colorNeutralBackground2: '#191c28',
  colorNeutralBackground3: '#0f111a',
  colorNeutralBackground4: '#0a0c14',
  colorNeutralBackground6: '#191c28',
  colorSubtleBackgroundHover: 'rgba(255, 255, 255, 0.05)',
  colorSubtleBackgroundPressed: 'rgba(255, 255, 255, 0.08)',

  // ink
  colorNeutralForeground1: '#eef0f6',
  colorNeutralForeground2: '#c2c7d4',
  colorNeutralForeground3: '#868d9e',
  colorNeutralForeground4: '#5a6070',
  colorNeutralForegroundDisabled: '#5a6070',

  // strokes
  colorNeutralStroke1: '#2b2e3a',
  colorNeutralStroke2: '#232633',
  colorNeutralStroke3: '#232633',
  colorNeutralStrokeAccessible: '#868d9e',

  // brand = indigo (never red)
  colorBrandBackground: '#5666f0',
  colorBrandBackgroundHover: '#6875f2',
  colorBrandBackgroundPressed: '#4553d8',
  colorBrandBackgroundSelected: '#5666f0',
  colorCompoundBrandBackground: '#5666f0',
  colorCompoundBrandBackgroundHover: '#6875f2',
  colorCompoundBrandBackgroundPressed: '#4553d8',
  colorCompoundBrandForeground1: '#a6b0ff',
  colorCompoundBrandForeground1Hover: '#bcc4ff',
  colorCompoundBrandForeground1Pressed: '#8f9bff',
  colorCompoundBrandStroke: '#5666f0',
  colorCompoundBrandStrokeHover: '#6875f2',
  colorBrandForeground1: '#a6b0ff',
  colorBrandForeground2: '#8f9bff',
  colorBrandForegroundLink: '#a6b0ff',
  colorBrandForegroundLinkHover: '#bcc4ff',
  colorBrandForegroundLinkPressed: '#8f9bff',
  colorBrandForegroundLinkSelected: '#a6b0ff',
  colorBrandStroke1: '#5666f0',
  colorBrandStroke2: '#2b2e3a',
  colorNeutralForeground2BrandHover: '#a6b0ff',
  colorNeutralForeground2BrandPressed: '#8f9bff',
  colorNeutralForeground2BrandSelected: '#a6b0ff',
  colorNeutralForeground3BrandHover: '#a6b0ff',
  colorNeutralForeground3BrandSelected: '#a6b0ff',
};

export const c3LightTheme: Theme = {
  ...webLightTheme,
  ...type,
  ...motion,

  colorNeutralStroke1: '#e2e4ee',
  colorNeutralStroke2: '#e9ebf3',

  colorBrandBackground: '#4b57db',
  colorBrandBackgroundHover: '#5a66e8',
  colorBrandBackgroundPressed: '#3a44c4',
  colorBrandBackgroundSelected: '#4b57db',
  colorCompoundBrandBackground: '#4b57db',
  colorCompoundBrandBackgroundHover: '#5a66e8',
  colorCompoundBrandBackgroundPressed: '#3a44c4',
  colorCompoundBrandForeground1: '#3a44c4',
  colorCompoundBrandForeground1Hover: '#4b57db',
  colorCompoundBrandForeground1Pressed: '#2f38a8',
  colorCompoundBrandStroke: '#4b57db',
  colorCompoundBrandStrokeHover: '#5a66e8',
  colorBrandForeground1: '#3a44c4',
  colorBrandForeground2: '#4b57db',
  colorBrandForegroundLink: '#3a44c4',
  colorBrandForegroundLinkHover: '#2f38a8',
  colorBrandForegroundLinkPressed: '#2f38a8',
  colorBrandForegroundLinkSelected: '#3a44c4',
  colorBrandStroke1: '#4b57db',
  colorBrandStroke2: '#e2e4ee',
  colorNeutralForeground2BrandHover: '#3a44c4',
  colorNeutralForeground2BrandPressed: '#2f38a8',
  colorNeutralForeground2BrandSelected: '#3a44c4',
  colorNeutralForeground3BrandHover: '#3a44c4',
  colorNeutralForeground3BrandSelected: '#3a44c4',
};
