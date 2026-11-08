// 짧은 낱말도 조사와 붙여 쓸 수 있게 어미를 덜어 내요.
const particles = /(?:하려면|하려고|하는법|하나요|해요|하기|으로|에서|에게|까지|부터|이랑|하고|은|는|이|가|을|를|에|로|도|만|요)$/u;
function tokens(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).map(word => word.replace(particles, '') || word);
}
export function search(faqArray, query, currentRole = 'common') {
  const words = [...new Set(tokens(query))];
  const ranked = faqArray.filter(item => item.role === 'common' || item.role === currentRole)
    .map((item, index) => {
      const keys = item.keywords.flatMap(tokens);
      const rest = [...item.variants, item.question].flatMap(tokens);
      const score = words.reduce((sum, word) => sum + (keys.includes(word) ? 3 : rest.includes(word) ? 1 : 0), 0);
      return { item, score, index };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked[0]?.score >= 2) return { found: true, item: ranked[0].item };
  return { found: false, suggestions: ranked.slice(0, 3).map(row => row.item) };
}
