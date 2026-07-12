/** Add or replace embed=1 without forcing an absolute URL (safe for SSR and relative paths). */
export function buildEmbedUrl(url: string) {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withEmbed = /([?&])embed=[^&#]*/.test(beforeHash)
    ? beforeHash.replace(/([?&])embed=[^&#]*/, "$1embed=1")
    : `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}embed=1`;
  return `${withEmbed}${hash}`;
}
