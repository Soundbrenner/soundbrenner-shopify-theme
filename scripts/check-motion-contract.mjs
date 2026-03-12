import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const scanDirs = ['sections', 'snippets', 'templates', 'layout', 'assets'];
const allowedMotionFiles = new Set([
  'sections/large-feature.liquid',
  'sections/quote-section.liquid',
  'sections/text-section.liquid',
  'sections/value-breakdown.liquid',
  'sections/top-feature-highlights.liquid',
  'sections/hero-video.liquid',
  'sections/press-ticker.liquid',
  'sections/collection-overview.liquid',
  'sections/target-audience-carousel.liquid',
  'sections/feature-carousel.liquid',
  'sections/trust-indicators.liquid',
  'sections/see-it-in-action-carousel.liquid',
  'sections/accordion.liquid',
  'sections/compare.liquid',
  'sections/footer.liquid',
  'sections/reviews-heading.liquid',
  'sections/expert-testimonials.liquid',
  'sections/hero-card.liquid',
  'assets/motion.css',
  'assets/section-motion.js',
]);
const legacyPatterns = [
  { label: 'legacy reveal root', regex: /\bdata-sb-reveal\b/g },
  { label: 'legacy reveal item', regex: /\bdata-sb-reveal-item\b/g },
  { label: 'legacy reveal delay', regex: /\b--sb-reveal-delay\b/g },
];
const invalidCarouselMotionRootPattern = /<[^>]*\bdata-sb-carousel\b[^>]*\bdata-sb-motion-item\b[^>]*>|<[^>]*\bdata-sb-motion-item\b[^>]*\bdata-sb-carousel\b[^>]*>/g;
const motionPattern = /\bdata-sb-motion(?:-item)?(?:=|(?=[\s>]))/g;
const failures = [];

const collectFiles = (relativeDir) => {
  const directory = path.join(rootDir, relativeDir);
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath);
    return [relativePath];
  });
};

const getLineNumbers = (source, regex) => {
  const matches = [];
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    regex.lastIndex = 0;
    if (regex.test(line)) matches.push(index + 1);
  });
  return matches;
};

const filesToScan = scanDirs.flatMap((dir) => collectFiles(dir));

filesToScan.forEach((relativePath) => {
  const absolutePath = path.join(rootDir, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');

  legacyPatterns.forEach(({ label, regex }) => {
    const lineNumbers = getLineNumbers(source, regex);
    if (!lineNumbers.length) return;
    failures.push(`${relativePath}: ${label} on line ${lineNumbers.join(', ')}`);
  });

  if (!allowedMotionFiles.has(relativePath)) {
    const lineNumbers = getLineNumbers(source, motionPattern);
    if (lineNumbers.length) {
      failures.push(`${relativePath}: unexpected motion API usage on line ${lineNumbers.join(', ')}`);
    }
  }

  invalidCarouselMotionRootPattern.lastIndex = 0;
  const invalidCarouselMotionRootMatch = invalidCarouselMotionRootPattern.exec(source);
  if (invalidCarouselMotionRootMatch) {
    const lineNumber = source.slice(0, invalidCarouselMotionRootMatch.index).split('\n').length;
    failures.push(`${relativePath}: carousel root cannot also be the motion item near line ${lineNumber}`);
  }
});

if (failures.length) {
  console.error('Motion contract check failed:\n');
  failures.forEach((failure) => {
    console.error(`- ${failure}`);
  });
  process.exit(1);
}

console.log('Motion contract check passed.');
