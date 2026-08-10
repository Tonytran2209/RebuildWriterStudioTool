import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppLanguage } from '../types';

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  tr: (vi: string, en: string) => string;
  outputInstruction: string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const saved = localStorage.getItem('writer:language');
    return saved === 'en' ? 'en' : 'vi';
  });

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const value = useMemo<LanguageContextValue>(() => {
    const setLanguage = (next: AppLanguage) => {
      localStorage.setItem('writer:language', next);
      document.documentElement.lang = next;
      setLanguageState(next);
    };
    return {
      language,
      setLanguage,
      toggleLanguage: () => setLanguage(language === 'vi' ? 'en' : 'vi'),
      tr: (vi, en) => language === 'vi' ? vi : en,
      outputInstruction: language === 'vi'
        ? 'NGÔN NGỮ OUTPUT: Viết toàn bộ nội dung người dùng nhìn thấy bằng tiếng Việt. Giữ nguyên tên riêng, tên file và quote evidence nguyên văn.'
        : 'OUTPUT LANGUAGE: Write all user-facing generated content in English. Preserve proper nouns, file names, and verbatim evidence quotes in their source language.',
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useI18n must be used inside LanguageProvider');
  return value;
}
