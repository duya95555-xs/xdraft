/*
 * mydraft.cc
 *
 * @license
 * Copyright (c) Sebastian Stehle. All rights reserved.
*/

import { en, Texts } from './en';
import { zh } from './zh';

export type { Texts };

export type LanguageKey = 'en' | 'zh';

const LANGUAGE_KEY = 'language';
const DEFAULT_LANGUAGE: LanguageKey = 'zh';

const dictionaries: Record<LanguageKey, Texts> = { en, zh };

// The language names are always shown in their own language.
export const languageNames: Record<LanguageKey, string> = { en: 'English', zh: '中文' };

export function getLanguage(): LanguageKey {
    try {
        const value = localStorage.getItem(LANGUAGE_KEY);

        if (value === 'en' || value === 'zh') {
            return value;
        }
    } catch {
        // Ignore failures e. g. in private mode.
    }

    return DEFAULT_LANGUAGE;
}

export function setLanguage(language: LanguageKey) {
    try {
        localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
        // Ignore failures e. g. in private mode.
    }
}

// Resolve every access at runtime against the current language, so all
// consumers can keep their static `texts.common.xxx` imports. A language
// switch takes effect after a reload of the page.
export const texts: Texts = new Proxy({} as Texts, {
    get(_target, property) {
        if (typeof property !== 'string') {
            return undefined;
        }

        const dictionary = dictionaries[getLanguage()] as any;

        return dictionary[property] ?? (en as any)[property];
    },
});
