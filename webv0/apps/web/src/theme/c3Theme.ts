import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

/**
 * C3 Fluent v9 themes — re-skin chapter: every overridden slot references a
 * LOCKED brand token (theme/brand/c3.tokens.css, The Long Table · Afterglow +
 * Blue Hour v1.2.0) via var(), so Fluent components follow
 * [data-c3-theme="cozy-dark"|"fresh-light"] from the single token source —
 * no literal colors live here. Blue is life/action; warm accents are people's.
 *
 * Fluent theme values become CSS custom properties on the FluentProvider, so
 * var() references are legal and resolve against the brand cascade at
 * use-time. The web(Dark|Light)Theme bases still supply every slot we don't
 * override, which is why the dark/light split remains.
 */

const type = {
  fontFamilyBase: 'var(--c3-font-family-human)',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
} as const;

// Motion settles into place (brand motion tokens; reduced-motion collapses them).
const motion = {
  durationFast: 'var(--c3-motion-duration-fast)',
  durationNormal: 'var(--c3-motion-duration-base)',
  durationGentle: 'var(--c3-motion-duration-settle)',
  curveEasyEase: 'var(--c3-motion-ease-signature)',
  curveDecelerateMid: 'var(--c3-motion-ease-signature)',
  curveAccelerateMid: 'var(--c3-motion-ease-signature)',
} as const;

/** Brand-token slot map shared by both themes; the tokens flip per data-c3-theme. */
const brandSlots = {
  // surfaces — tactile opaque brand surfaces
  colorNeutralBackground1: 'var(--c3-surface-base)',
  colorNeutralBackground1Hover: 'var(--c3-surface-subtle)',
  colorNeutralBackground1Pressed: 'var(--c3-ground-sunken)',
  colorNeutralBackground2: 'var(--c3-surface-subtle)',
  colorNeutralBackground3: 'var(--c3-ground-sunken)',
  colorNeutralBackground4: 'var(--c3-ground-canvas)',
  colorNeutralBackground6: 'var(--c3-surface-elevated)',
  colorSubtleBackgroundHover: 'color-mix(in srgb, var(--c3-ink-default) 6%, transparent)',
  colorSubtleBackgroundPressed: 'color-mix(in srgb, var(--c3-ink-default) 10%, transparent)',

  // ink — warm, softly stepped (Polish wave #6: Foreground2 back to the
  // brand's middle step, restoring the three-step text hierarchy)
  colorNeutralForeground1: 'var(--c3-ink-default)',
  colorNeutralForeground2: 'var(--c3-ink-muted)',
  colorNeutralForeground3: 'var(--c3-ink-quiet)',
  colorNeutralForeground4: 'var(--c3-ink-quiet)',
  colorNeutralForegroundDisabled: 'var(--c3-ink-quiet)',

  // disabled controls read as PROPER quiet controls, not dead near-ground
  // rectangles (Polish wave #6: standard secondary affordance)
  colorNeutralBackgroundDisabled: 'var(--c3-surface-subtle)',
  colorNeutralStrokeDisabled: 'var(--c3-border-subtle)',

  // strokes
  colorNeutralStroke1: 'var(--c3-border-strong)',
  colorNeutralStroke2: 'var(--c3-border-subtle)',
  colorNeutralStroke3: 'var(--c3-border-subtle)',
  colorNeutralStrokeAccessible: 'var(--c3-ink-quiet)',

  // brand = the blue-as-life action tokens (never a warm people accent)
  colorBrandBackground: 'var(--c3-action-primary)',
  colorBrandBackgroundHover: 'var(--c3-action-primary-hover)',
  colorBrandBackgroundPressed: 'var(--c3-action-primary-hover)',
  colorBrandBackgroundSelected: 'var(--c3-action-primary)',
  colorCompoundBrandBackground: 'var(--c3-action-primary)',
  colorCompoundBrandBackgroundHover: 'var(--c3-action-primary-hover)',
  colorCompoundBrandBackgroundPressed: 'var(--c3-action-primary-hover)',
  colorCompoundBrandForeground1: 'var(--c3-accent-blue)',
  colorCompoundBrandForeground1Hover: 'var(--c3-accent-sky)',
  colorCompoundBrandForeground1Pressed: 'var(--c3-accent-blue)',
  colorCompoundBrandStroke: 'var(--c3-action-primary)',
  colorCompoundBrandStrokeHover: 'var(--c3-action-primary-hover)',
  colorBrandForeground1: 'var(--c3-accent-blue)',
  colorBrandForeground2: 'var(--c3-accent-sky)',
  colorBrandForegroundLink: 'var(--c3-accent-blue)',
  colorBrandForegroundLinkHover: 'var(--c3-accent-sky)',
  colorBrandForegroundLinkPressed: 'var(--c3-accent-blue)',
  colorBrandForegroundLinkSelected: 'var(--c3-accent-blue)',
  colorBrandStroke1: 'var(--c3-action-primary)',
  colorBrandStroke2: 'var(--c3-border-strong)',
  colorNeutralForegroundOnBrand: 'var(--c3-action-ink)',
  colorNeutralForeground2BrandHover: 'var(--c3-accent-blue)',
  colorNeutralForeground2BrandPressed: 'var(--c3-accent-blue)',
  colorNeutralForeground2BrandSelected: 'var(--c3-accent-blue)',
  colorNeutralForeground3BrandHover: 'var(--c3-accent-blue)',
  colorNeutralForeground3BrandSelected: 'var(--c3-accent-blue)',

  // focus follows the brand focus token
  colorStrokeFocus2: 'var(--c3-action-focus)',
} as const;

export const c3DarkTheme: Theme = {
  ...webDarkTheme,
  ...type,
  ...motion,
  ...brandSlots,
};

export const c3LightTheme: Theme = {
  ...webLightTheme,
  ...type,
  ...motion,
  ...brandSlots,
};
