// The one default background wash (lib/settings.ts's DEFAULT_BACKGROUND, BackgroundLayer.tsx) —
// built from the active palette's own tokens, so it repaints on palette switch. Not a user-facing
// choice among presets anymore (Settings' Background section dropped that picker: a vivid
// primary/accent combo drew too much attention and "did not work well"). This single soft
// accent-to-secondary blend, shown at low opacity by default, is meant to add a little depth
// without being a design statement anyone notices.
export const DEFAULT_BACKGROUND_GRADIENT = "linear-gradient(135deg, var(--accent), var(--secondary))";
