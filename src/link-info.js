import { getDomain } from 'tldts';

// Markdown otherwise interprets bare "file.js:12" as a URL scheme.
export function isFileLineLink(href) {
  return typeof href === 'string' && /^\/?(?:[^:/?#\s]+\/)*[^:/?#\s]+\.[a-z\d]+:\d+(?::\d+)?(?:#L\d+)?$/i.test(href);
}

export function websiteInfo(href) {
  if (typeof href !== 'string' || !/^(?:https?:\/\/|\/\/)/i.test(href)) return null;
  try {
    const url = new URL(href, 'https://localhost');
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { hostname: url.hostname, domain: getDomain(url.hostname, { allowPrivateDomains: true }) || url.hostname };
  } catch { return null; }
}
