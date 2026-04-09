/**
 * Count syllables in a word using a simple heuristic.
 */
export function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;

  // Remove trailing silent e
  word = word.replace(/e$/, '');

  // Count vowel groups
  const matches = word.match(/[aeiouy]+/g);
  const count = matches ? matches.length : 0;
  return Math.max(1, count);
}

function splitSentences(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length || 1;
}

function splitWords(text) {
  return text.split(/\s+/).filter(w => w.replace(/[^a-zA-Z0-9]/g, '').length > 0);
}

function getTextStats(text) {
  if (!text || !text.trim()) return { wordCount: 0, sentenceCount: 1, syllableCount: 0 };
  const words = splitWords(text);
  const wordCount = words.length;
  const sentenceCount = splitSentences(text);
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return { wordCount, sentenceCount, syllableCount };
}

/**
 * Compute Flesch-Kincaid Grade Level.
 * Formula: 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
 */
export function fleschKincaidGradeLevel(text) {
  const { wordCount, sentenceCount, syllableCount } = getTextStats(text);
  if (wordCount === 0) return 0;
  if (sentenceCount === 0) return 0;
  return 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
}

/**
 * Compute Flesch Reading Ease score.
 * Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
 */
export function fleschReadingEase(text) {
  const { wordCount, sentenceCount, syllableCount } = getTextStats(text);
  if (wordCount === 0) return 0;
  if (sentenceCount === 0) return 0;
  return 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount);
}

function computeGradeAndEase(stats) {
  if (stats.wordCount === 0 || stats.sentenceCount === 0) return { grade: 0, ease: 0 };
  const wps = stats.wordCount / stats.sentenceCount;
  const spw = stats.syllableCount / stats.wordCount;
  return {
    grade: 0.39 * wps + 11.8 * spw - 15.59,
    ease: 206.835 - 1.015 * wps - 84.6 * spw
  };
}

/**
 * Compute readability metrics for original and renarrated text, plus deltas.
 */
export function computeReadabilityMetrics(originalText, renaratedText) {
  const origStats = getTextStats(originalText || '');
  const renarStats = getTextStats(renaratedText || '');
  const origScores = computeGradeAndEase(origStats);
  const renarScores = computeGradeAndEase(renarStats);

  const original = {
    grade: origScores.grade,
    ease: origScores.ease,
    wordCount: origStats.wordCount,
    sentenceCount: origStats.sentenceCount
  };

  const renarrated = {
    grade: renarScores.grade,
    ease: renarScores.ease,
    wordCount: renarStats.wordCount,
    sentenceCount: renarStats.sentenceCount
  };

  const delta = {
    grade: renarrated.grade - original.grade,
    ease: renarrated.ease - original.ease,
    wordCount: renarrated.wordCount - original.wordCount
  };

  return { original, renarrated, delta };
}
