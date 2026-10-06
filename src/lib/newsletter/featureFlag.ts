/**
 * Single switch gating the entire newsletter feature end to end (signup
 * form visibility, subscribe/send API routes, footer link, privacy-page
 * paragraph) — deliberately one flag, not several, so there is exactly one
 * place to flip for launch and no way for part of the feature to go live
 * while another part stays hidden. Unset (the default on every existing
 * deployment, since this env var doesn't exist yet) means fully disabled:
 * the task's explicit "keep new functionality safely disabled until
 * configuration and compliance checks are complete" requirement, satisfied
 * without any new infrastructure — just an env var nobody has set.
 */
export function isNewsletterEnabled(): boolean {
  return process.env.NEWSLETTER_SIGNUP_ENABLED === "true";
}
