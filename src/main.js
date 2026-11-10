import '@fontsource/press-start-2p/400.css';
import './style.css';
import { loadProfile } from './storage.js';
import { setLanguage } from './i18n.js';

/* Load the profile first so the game starts in the saved language and settings. */
const profile = await loadProfile();
if (profile.settings.lang) setLanguage(profile.settings.lang);
const { boot } = await import('./game.js');
boot();
