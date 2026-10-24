// Where a visit came from, in one place: used when a session is written and again when the
// dashboard groups it. Sharing the rules means sessions recorded before a rule existed are
// grouped correctly on read, without rewriting any rows.

// Order matters. gemini.google.com and copilot.microsoft.com must be read as assistants
// before the plain "google" and "bing" rules claim them.
export const HOST_RULES = [
  {
    medium: 'ai',
    label: 'AI-асистенти',
    re: /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|anthropic\.com|gemini\.google\.com|bard\.google\.com|aistudio\.google\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|you\.com|poe\.com|grok\.com|x\.ai|deepseek\.com|chat\.mistral\.ai|mistral\.ai|phind\.com|meta\.ai|huggingface\.co|chat\.qwen\.ai|kimi\.com|genspark\.ai|felo\.ai|iask\.ai|andisearch\.com)$/i
  },
  {
    medium: 'organic',
    label: 'Пошук',
    re: /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.[a-z.]+|ecosia\.org|yandex\.[a-z.]+|baidu\.com|search\.brave\.com|startpage\.com|qwant\.com|seznam\.cz|naver\.com|kagi\.com|ask\.com|aol\.com|mojeek\.com|search\.marcia\.ua|meta\.ua)$/i
  },
  {
    medium: 'messenger',
    label: 'Месенджери',
    re: /(^|\.)(t\.me|telegram\.org|telegram\.me|web\.telegram\.org|viber\.com|invite\.viber\.com|whatsapp\.com|wa\.me|messenger\.com|m\.me|discord\.com|discord\.gg|slack\.com|skype\.com|signal\.org)$/i
  },
  {
    medium: 'social',
    label: 'Соцмережі',
    re: /(^|\.)(facebook\.com|fb\.com|lm\.facebook\.com|l\.facebook\.com|instagram\.com|l\.instagram\.com|tiktok\.com|twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|reddit\.com|out\.reddit\.com|youtube\.com|youtu\.be|threads\.net|threads\.com|snapchat\.com|vk\.com|ok\.ru|tumblr\.com|quora\.com|medium\.com)$/i
  },
  {
    medium: 'email',
    label: 'Розсилка',
    re: /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.com|mail\.yahoo\.com|mail\.ru|e\.mail\.ru|ukr\.net|mail\.ukr\.net|webmail\.[a-z.]+|mailchimp\.com|sendgrid\.net|substack\.com)$/i
  },
  {
    medium: 'aggregator',
    label: 'Прайс-агрегатори',
    re: /(^|\.)(hotline\.ua|price\.ua|e-katalog\.com\.ua|ek\.ua|nadavi\.com\.ua|ceneo\.pl|skapiec\.pl|idealo\.[a-z.]+|heureka\.cz|shopping\.google\.[a-z.]+|prom\.ua|rozetka\.com\.ua)$/i
  }
];

const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|adwords|google_ads|googleads)$/i;
const PAID_SOCIAL = /^(paid_social|paid-social|paidsocial|social_paid|social-paid|cpm|display|retargeting)$/i;
const EMAIL_MEDIUM = /^(email|e-mail|e_mail|newsletter|mail)$/i;
const SOCIAL_MEDIUM = /^(social|social_media|social-media|organic_social)$/i;
const AI_MEDIUM = /^(ai|llm|chatbot|assistant|genai|ai_search|ai-search)$/i;

// Brings the many spellings people put in utm_medium down to the handful the dashboard groups by.
export function normalizeMedium(m = '') {
  const v = String(m || '').trim().toLowerCase();
  if (!v) return '';
  if (PAID_MEDIUM.test(v)) return 'cpc';
  if (PAID_SOCIAL.test(v)) return 'paid_social';
  if (EMAIL_MEDIUM.test(v)) return 'email';
  if (SOCIAL_MEDIUM.test(v)) return 'social';
  if (AI_MEDIUM.test(v)) return 'ai';
  if (v === 'organic') return 'organic';
  if (v === 'referral') return 'referral';
  if (v === 'none' || v === 'direct') return 'none';
  return v.slice(0, 30);
}

// Matches a hostname, or whatever someone typed into utm_source (people write both
// "chatgpt.com" and "chatgpt" there).
export function classifyHost(raw = '') {
  const host = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!host) return null;
  for (const rule of HOST_RULES) {
    if (rule.re.test(host)) return rule.medium;
  }
  // utm_source is often a bare name rather than a domain: "chatgpt", "perplexity", "telegram".
  const bare = host.replace(/\.[a-z.]+$/, '');
  for (const rule of HOST_RULES) {
    if (rule.re.test(bare + '.com')) return rule.medium;
  }
  return null;
}

export const isAiSource = (source) => classifyHost(source) === 'ai';
