// Launch settings in one place. Each is public: anyone using the app can see it.

// Where "Send feedback" goes. Empty hides the button.
export const FEEDBACK_EMAIL = 'feedback@fumblerooski.app';

// Cloudflare Web Analytics token (dash.cloudflare.com > Analytics & Logs > Web Analytics > Add a site > the token in the
// JS snippet). Counts visits with no cookies. Empty means no analytics.
export const CF_BEACON_TOKEN = '';

export const APP_VERSION = '1.0';

// Web push: the public half of the alert key (the private half is a Cloudflare secret, VAPID_PRIVATE_KEY).
export const VAPID_PUBLIC_KEY = 'BG04-5jJnWbQASvipJuJW8aireFJlJJ9xckgLVsyXyeyy7TAj64iDh5KtipSKNl_vbrDZHhFW5MUbLz1fwN4zpk';
