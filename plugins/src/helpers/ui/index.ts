/**
 * Shared in-game UI helpers (error banner / Shadow mount / DOM / adopted styles).
 * Import from this barrel only; avoid deep path sprawl.
 */

export { appendAdoptedStyles, applyShadowStyles } from './adopted-styles'
export { clearElement, setInnerHTML } from './dom'
export { getPluginErrors, restorePluginErrors, showPluginError } from './error-banner'
export { isolateEditableKeys } from './keyboard-isolation'
export { adoptTemplateContent, ensureCustomElementHost, mountUiTemplateShell } from './mount'
